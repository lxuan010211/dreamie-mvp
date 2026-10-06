import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatState, getAudioControlMode, getAudioFormat, getOrCreateAnonymousUserId, shouldStartVoiceHold, tryCapturePointer } from '../app.js';

test('keeps one anonymous user ID in browser storage', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(getOrCreateAnonymousUserId(storage, () => '11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
  assert.equal(getOrCreateAnonymousUserId(storage, () => '22222222-2222-4222-8222-222222222222'), '11111111-1111-4111-8111-111111111111');
});

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

test('hides the welcome state after the user starts an interaction', () => {
  const chat = createChatState();

  assert.equal(chat.getSnapshot().hasStarted, false);
  chat.setDraft('我想说点什么');

  assert.equal(chat.getSnapshot().hasStarted, true);
});

test('starts voice hold only from the conversation box background', () => {
  assert.equal(shouldStartVoiceHold('FORM'), true);
  assert.equal(shouldStartVoiceHold('TEXTAREA'), false);
  assert.equal(shouldStartVoiceHold('BUTTON'), false);
});

test('maps browser recording MIME types to DashScope audio formats', () => {
  assert.equal(getAudioFormat('audio/webm;codecs=opus'), 'webm');
  assert.equal(getAudioFormat('audio/mp4'), 'mp4');
});

test('does not fail recording when a browser rejects pointer capture', () => {
  const target = {
    setPointerCapture: () => {
      throw new Error('pointer capture is unavailable');
    },
  };

  assert.doesNotThrow(() => tryCapturePointer(target, 3));
});

test('switches the composer button between send, play, and stop modes', () => {
  assert.equal(getAudioControlMode({ hasAudio: false, isSpeaking: false }), 'send');
  assert.equal(getAudioControlMode({ hasAudio: true, isSpeaking: false }), 'play');
  assert.equal(getAudioControlMode({ hasAudio: true, isSpeaking: true }), 'stop');
});
