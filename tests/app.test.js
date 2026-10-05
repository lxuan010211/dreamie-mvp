import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatState } from '../app.js';

test('keeps send disabled for whitespace-only drafts', () => {
  const chat = createChatState();

  chat.setDraft('   ');

  assert.equal(chat.send(), false);
  assert.deepEqual(chat.getSnapshot().messages, []);
});

test('fills but does not send a quick prompt', () => {
  const chat = createChatState();

  chat.choosePrompt('陪我聊聊今天的心情');

  assert.equal(chat.getSnapshot().draft, '陪我聊聊今天的心情');
  assert.equal(chat.getSnapshot().messages.length, 0);
});
