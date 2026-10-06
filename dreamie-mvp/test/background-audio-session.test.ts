import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAssistantMessage,
  addUserMessage,
  createBackgroundAudioSession,
  getBackgroundAudioAction,
  getConversationPrompt,
  recommendBackgroundAudio,
} from '../src/background-audio-session.js';

test('keeps recent dialogue when preparing the next model prompt', () => {
  let session = createBackgroundAudioSession();
  session = addUserMessage(session, '今天开会很多，脑子还停不下来。');
  session = addAssistantMessage(session, '辛苦了，我们先把注意力放回呼吸。');
  session = addUserMessage(session, '我平时很喜欢下雨的声音。');

  const prompt = getConversationPrompt(session);

  assert.match(prompt, /今天开会很多/);
  assert.match(prompt, /很喜欢下雨/);
  assert.match(prompt, /用户：/);
  assert.match(prompt, /Dreamie：/);
});

test('recommends a gentle matching track and switches after the user asks for another', () => {
  const firstTrack = recommendBackgroundAudio('tired', []);
  const nextTrack = recommendBackgroundAudio('tired', [firstTrack.id]);

  assert.equal(firstTrack.id, 'spring-rain');
  assert.notEqual(nextTrack.id, firstTrack.id);
});

test('only treats clear consent as permission to play audio', () => {
  assert.equal(getBackgroundAudioAction('好'), 'play');
  assert.equal(getBackgroundAudioAction('换一个'), 'change');
  assert.equal(getBackgroundAudioAction('我其实更想听雨声'), 'continue');
});

test('prefers rain when it matches the user memory and current mood', () => {
  const track = recommendBackgroundAudio('stressed', [], ['rain']);

  assert.equal(track.kind, 'rain');
});

test('recognizes explicit like and dislike feedback', () => {
  assert.equal(getBackgroundAudioAction('喜欢'), 'like');
  assert.equal(getBackgroundAudioAction('不要再推荐'), 'dislike');
});
