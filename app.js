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
