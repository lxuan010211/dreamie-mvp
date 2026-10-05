export function createChatState() {
  let draft = '';
  const messages = [];
  let status = 'Dreamie 正在静静等你开口';

  const getSnapshot = () => ({
    draft,
    messages: messages.map((message) => ({ ...message })),
    status,
  });

  const setDraft = (value) => {
    draft = String(value);
  };

  const choosePrompt = (prompt) => {
    draft = String(prompt);
  };

  const send = () => {
    const text = draft.trim();

    if (!text) return false;

    messages.push({ role: 'user', text });
    draft = '';
    status = 'Dreamie 收到了，正在陪你慢慢想。';
    return true;
  };

  return { getSnapshot, setDraft, choosePrompt, send };
}

export function mountChat(root = document) {
  const composer = root.querySelector('[data-composer]');
  const sendButton = root.querySelector('[data-send]');
  const messages = root.querySelector('[data-messages]');
  const status = root.querySelector('[data-status]');
  const promptButtons = root.querySelectorAll('[data-prompt]');

  if (!composer || !sendButton || !messages || !status) return;

  const chat = createChatState();

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
    updateComposer();
  };

  const sendMessage = () => {
    chat.setDraft(composer.value);
    if (chat.send()) render();
  };

  composer.addEventListener('input', () => {
    chat.setDraft(composer.value);
    updateComposer();
  });

  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  sendButton.addEventListener('click', sendMessage);

  for (const button of promptButtons) {
    button.addEventListener('click', () => {
      chat.choosePrompt(button.dataset.prompt || button.textContent.trim());
      updateComposer();
      composer.focus();
    });
  }

  render();
}

if (typeof document !== 'undefined' && document.querySelector('[data-chat-app]')) {
  mountChat(document);
}
