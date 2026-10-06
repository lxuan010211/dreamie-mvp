export function createChatState() {
  let draft = '';
  const messages = [];
  let status = 'Dreamie 正在静静等你开口';
  let hasStarted = false;

  const getSnapshot = () => ({
    draft,
    messages: messages.map((message) => ({ ...message })),
    status,
    hasStarted,
  });

  const setDraft = (value) => {
    draft = String(value);
    if (draft.trim()) hasStarted = true;
  };

  const choosePrompt = (prompt) => {
    draft = String(prompt);
    hasStarted = true;
  };

  const send = () => {
    const text = draft.trim();

    if (!text) return false;

    messages.push({ role: 'user', text });
    hasStarted = true;
    draft = '';
    status = 'Dreamie 收到了，正在陪你慢慢想。';
    return true;
  };

  const addAssistantMessage = (text) => {
    messages.push({ role: 'assistant', text: `Dreamie：${text}` });
    status = 'Dreamie 正在陪着你。';
  };

  const setStatus = (value) => { status = value; };

  return { getSnapshot, setDraft, choosePrompt, send, addAssistantMessage, setStatus };
}

export function shouldStartVoiceHold(target) {
  const tagName = typeof target === 'string' ? target : target?.tagName;
  const isInsideInteractiveControl = target?.closest?.('button, textarea, input, select, a, [contenteditable="true"]');
  return !isInsideInteractiveControl && !['TEXTAREA', 'BUTTON', 'INPUT', 'SELECT', 'A'].includes(String(tagName).toUpperCase());
}

export function getAudioFormat(mimeType) {
  const type = String(mimeType).toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

export function getOrCreateAnonymousUserId(storage = localStorage, createUuid = () => crypto.randomUUID()) {
  const existing = storage.getItem('dreamie-user-id');
  if (existing) return existing;
  const userId = createUuid();
  storage.setItem('dreamie-user-id', userId);
  return userId;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('录音读取失败。'));
    reader.readAsDataURL(blob);
  });
}

export function mountChat(root = document) {
  const composer = root.querySelector('[data-composer]');
  const sendButton = root.querySelector('[data-send]');
  const messages = root.querySelector('[data-messages]');
  const status = root.querySelector('[data-status]');
  const promptButtons = root.querySelectorAll('[data-prompt]');
  const voiceButton = root.querySelector('[data-voice]');
  const welcome = root.querySelector('[data-welcome]');
  const listenBubble = root.querySelector('[data-listen-bubble]');
  const listenLabel = root.querySelector('[data-listen-label]');

  if (!composer || !sendButton || !messages || !status) return;

  const chat = createChatState();
  let sessionId = localStorage.getItem('dreamie-session-id') || '';
  const userId = getOrCreateAnonymousUserId();
  let pendingAudio = null;

  const updateComposer = () => {
    const snapshot = chat.getSnapshot();
    composer.value = snapshot.draft;
    sendButton.disabled = !snapshot.draft.trim();
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 112)}px`;
  };

  const render = () => {
    const snapshot = chat.getSnapshot();
    messages.replaceChildren();

    for (const message of snapshot.messages) {
      const item = document.createElement('li');
      item.className = `message message--${message.role}`;
      item.textContent = message.text;
      messages.append(item);
    }

    status.textContent = snapshot.status;
    welcome?.classList.toggle('is-hidden', snapshot.hasStarted);
    updateComposer();
  };

  const sendMessage = async () => {
    chat.setDraft(composer.value);
    const text = chat.getSnapshot().draft.trim();
    if (!chat.send()) return;
    if (pendingAudio && /^(好|好的|好啊|可以|可以的|播放|开始|行|嗯|yes|y)$/i.test(text)) {
      pendingAudio.play().catch(() => chat.setStatus('轻触页面后再试一次播放。'));
    }
    render();
    chat.setStatus('Dreamie 正在想一想…');
    render();
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, sessionId, message: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '连接失败');
      sessionId = data.sessionId;
      localStorage.setItem('dreamie-session-id', sessionId);
      chat.addAssistantMessage(data.reply);
      if (data.audio?.url) { pendingAudio = new Audio(data.audio.url); if (data.audio.state === 'playing') pendingAudio.play().catch(() => {}); }
    } catch (error) {
      chat.setStatus(error instanceof Error ? `Dreamie 暂时无法回应：${error.message}` : 'Dreamie 暂时无法回应。');
    }
    render();
  };

  composer.addEventListener('input', () => {
    chat.setDraft(composer.value);
    render();
  });

  composer.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  sendButton.addEventListener('click', sendMessage);

  for (const button of promptButtons) {
    button.addEventListener('click', () => {
      chat.choosePrompt(button.dataset.prompt || button.textContent.trim());
      render();
      composer.focus();
    });
  }

  let recorder;
  let stream;
  let listening = false;
  let pressing = false;
  let audioChunks = [];
  const setListening = (value) => {
    listening = value;
    composer.classList.toggle('composer--listening', value);
    if (listenBubble) listenBubble.hidden = !value;
    if (listenLabel) listenLabel.textContent = value ? '我在听' : '';
    voiceButton?.setAttribute('aria-pressed', String(value));
    if (value) { chat.setStatus('按住说话，松开后发送。'); chat.setDraft(composer.value || ' '); }
    render();
  };
  const stopRecording = () => {
    pressing = false;
    if (listening && recorder?.state !== 'inactive') recorder.stop();
  };

  if (window.MediaRecorder && navigator.mediaDevices?.getUserMedia && voiceButton) {
    const beginRecording = async (event) => {
      event.preventDefault();
      if (listening || pressing) return;
      pressing = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!pressing) { stream.getTracks().forEach((track) => track.stop()); return; }
        const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
        audioChunks = [];
        recorder.addEventListener('dataavailable', (recording) => { if (recording.data.size) audioChunks.push(recording.data); });
        recorder.addEventListener('stop', async () => {
          stream?.getTracks().forEach((track) => track.stop());
          setListening(false);
          if (!audioChunks.length) { chat.setStatus('没有收到录音，请再试一次。'); render(); return; }
          try {
            chat.setStatus('正在把你的声音变成文字…'); render();
            const blob = new Blob(audioChunks, { type: recorder.mimeType || preferredType || 'audio/webm' });
            const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: await blobToDataUrl(blob), format: getAudioFormat(blob.type) }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '语音识别失败。');
            composer.value = data.text;
            chat.setDraft(data.text);
            chat.setStatus('识别完成，正在发送给 Dreamie…');
            render();
            await sendMessage();
          } catch (error) {
            chat.setStatus(error instanceof Error ? error.message : '语音识别暂时不可用。');
            render();
          }
        });
        recorder.start();
        setListening(true);
        composer.setPointerCapture?.(event.pointerId);
      } catch (error) {
        pressing = false;
        chat.setStatus('无法使用麦克风，请检查 HTTPS 与浏览器麦克风权限。');
        render();
      }
    };
    voiceButton.addEventListener('pointerdown', beginRecording);
    composer.addEventListener('pointerdown', (event) => {
      if (shouldStartVoiceHold(event.target)) beginRecording(event);
    });
    composer.addEventListener('pointerup', stopRecording);
    composer.addEventListener('pointercancel', stopRecording);
  } else if (voiceButton) {
    voiceButton.disabled = true;
    voiceButton.title = '当前浏览器不支持录音';
  }

  render();
}

if (typeof document !== 'undefined' && document.querySelector('[data-chat-app]')) {
  mountChat(document);
}
