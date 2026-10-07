export function readCompanionProfile(storage = localStorage) {
  let saved = {};
  try { saved = JSON.parse(storage.getItem('dreamie-companion-profile') || '{}') || {}; } catch {}
  return { username: typeof saved.username === 'string' && saved.username.trim() ? saved.username.trim().slice(0, 20) : '小宝', persona: ['gentle', 'friend', 'calm'].includes(saved.persona) ? saved.persona : 'gentle', voiceId: ['female-chengshu', 'female-tianmei', 'male-qn-qingse', 'audiobook_female_1', 'male-qn-jingying', 'Chinese (Mandarin)_Radio_Host', 'Chinese (Mandarin)_News_Anchor'].includes(saved.voiceId) ? saved.voiceId : 'female-chengshu' };
}

export async function mountSettings(root = document, { stopChatAudio = () => {} } = {}) {
  const page = root.querySelector('[data-settings-page]');
  const open = root.querySelector('[data-open-settings]');
  const dialog = root.querySelector('[data-settings-dialog]');
  if (!page || !open || !dialog) return;
  const chat = root.querySelector('[data-chat-app]');
  let options;
  let editing;
  let preview;
  let previewControl;
  let previewGeneration = 0;
  const profile = readCompanionProfile();
  const status = root.querySelector('[data-preview-status]');
  const previewButton = root.querySelector('[data-voice-preview]');
  const stopPreview = () => {
    previewGeneration++; preview?.pause(); preview = undefined;
    page.classList.remove('is-previewing');
    if (previewControl) {
      previewControl.classList.remove('is-playing'); previewControl.disabled = false;
      previewControl.setAttribute('aria-pressed', 'false');
      previewControl.setAttribute('aria-busy', 'false');
      if (previewControl === previewButton) previewControl.textContent = '试听';
    }
    previewControl = undefined;
    status.textContent = '';
    root.querySelector('[data-dialog-preview-status]').textContent = '';
  };
  const playPreview = async (voiceId, control) => {
    if (previewControl === control) { stopPreview(); return; }
    stopPreview();
    const generation = ++previewGeneration; previewControl = control;
    control.disabled = true; control.setAttribute('aria-busy', 'true');
    const feedback = dialog.open ? root.querySelector('[data-dialog-preview-status]') : status;
    feedback.textContent = '正在准备这个声音…';
    if (control === previewButton) control.textContent = '准备中';
    try {
      const r = await fetch('/api/voice-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...profile, voiceId }) });
      const data = await r.json(); if (!r.ok || !data.dataUrl) throw new Error();
      if (generation !== previewGeneration) return;
      preview = new Audio(data.dataUrl); preview.addEventListener('ended', stopPreview);
      await preview.play();
      if (generation !== previewGeneration) return;
      control.classList.add('is-playing'); control.disabled = false;
      control.setAttribute('aria-pressed', 'true');
      if (control === previewButton) { page.classList.add('is-previewing'); control.textContent = '停止'; }
      feedback.textContent = '正在试听，点击声波可停止';
    } catch {
      if (generation !== previewGeneration) return;
      stopPreview(); feedback.textContent = '试听暂时不可用，请稍后再试。';
    } finally { control.setAttribute('aria-busy', 'false'); }
  };
  const render = () => {
    root.querySelector('[data-setting-username]').textContent = profile.username;
    root.querySelector('[data-setting-persona]').textContent = options?.personas.find((x) => x.id === profile.persona)?.label || '温柔治愈型';
    root.querySelector('[data-persona-description]').textContent = options?.personas.find((x) => x.id === profile.persona)?.description || '温柔、耐心、善解人意，认真听你说话，陪你整理心情，慢慢放松。';
    root.querySelector('[data-setting-voice]').textContent = options?.voices.find((x) => x.id === profile.voiceId)?.label || '温暖治愈音';
  };
  open.addEventListener('click', async () => {
    stopChatAudio(); chat.hidden = true; page.hidden = false; window.scrollTo(0, 0);
    root.querySelector('[data-close-settings]').focus(); render();
    if (!options) {
      try { const r = await fetch('/api/settings/options'); if (!r.ok) throw new Error(); options = await r.json(); render(); }
      catch { status.textContent = '设置暂时未加载，稍后重新打开试试。'; }
    }
  });
  root.querySelector('[data-close-settings]').addEventListener('click', () => { stopPreview(); page.hidden = true; chat.hidden = false; open.focus(); });
  for (const button of root.querySelectorAll('[data-edit-setting]')) button.addEventListener('click', () => {
    editing = button.dataset.editSetting;
    if (editing !== 'username' && !options) { status.textContent = '请稍等，设置选项正在加载。'; return; }
    stopPreview();
    dialog.classList.toggle('settings-dialog--voice', editing === 'voiceId');
    root.querySelector('[data-dialog-preview-status]').textContent = '';
    root.querySelector('#settings-dialog-title').textContent = { username: 'Dreamie 怎么称呼你？', persona: '选择伙伴人设', voiceId: '选择伙伴音色' }[editing];
    const container = root.querySelector('[data-setting-options]'); container.replaceChildren();
    if (editing === 'username') {
      const input = document.createElement('input'); input.name = 'selection'; input.value = profile.username; input.maxLength = 20; input.required = true; input.placeholder = '输入你的昵称'; input.setAttribute('aria-label', '用户名'); input.className = 'settings-name-input'; container.append(input);
    } else if (editing === 'voiceId') for (const item of options.voices) {
      const row = document.createElement('div'); row.className = 'voice-option';
      const label = document.createElement('label'); label.textContent = item.label; label.htmlFor = `voice-${item.id}`;
      const audition = document.createElement('button'); audition.type = 'button'; audition.className = 'voice-option-preview'; audition.setAttribute('aria-label', `试听${item.label}`); audition.setAttribute('aria-pressed', 'false');
      const wave = document.createElement('span'); wave.className = 'settings-wave'; wave.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 15; i++) wave.append(document.createElement('i'));
      audition.append(wave); audition.addEventListener('click', () => playPreview(item.id, audition));
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'selection'; input.id = label.htmlFor; input.value = item.id; input.checked = profile.voiceId === item.id; input.required = true; input.setAttribute('aria-label', `选择${item.label}`);
      row.append(label, audition, input); container.append(row);
    } else for (const item of options.personas) {
      const label = document.createElement('label'); label.className = 'settings-option';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'selection'; input.value = item.id; input.checked = profile[editing] === item.id; input.required = true;
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = item.label; const detail = document.createElement('small'); detail.textContent = item.description; copy.append(title, detail); label.append(input, copy); container.append(label);
    }
    dialog.showModal();
  });
  root.querySelector('[data-dismiss-setting]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stopPreview);
  dialog.addEventListener('cancel', stopPreview);
  root.querySelector('[data-settings-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('selection') || '').trim();
    if (!value) return;
    const updated = { ...profile, [editing]: value };
    try { localStorage.setItem('dreamie-companion-profile', JSON.stringify(updated)); }
    catch { status.textContent = '无法保存设置，请检查浏览器存储权限。'; return; }
    Object.assign(profile, updated); render(); dialog.close(); root.querySelector('[data-settings-saved]').textContent = '已保存';
  });
  previewButton.addEventListener('click', () => playPreview(profile.voiceId, previewButton));
  render();
}
