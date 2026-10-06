import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAssistantMessage,
  addUserMessage,
  createBackgroundAudioSession,
  getBackgroundAudioAction,
  getConversationPrompt,
  markRecommendationDeclined,
  recommendBackgroundAudio,
  requestsBackgroundAudio,
  shouldSoftRecommendBackgroundAudio,
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

test('recognizes affirmative ambience requests but ignores negative mentions', () => {
  assert.equal(requestsBackgroundAudio('请放一点雨声陪我'), true);
  assert.equal(requestsBackgroundAudio('不要背景音，只陪我聊聊天'), false);
});

test('softly recommends only when the mood and memory preference match', () => {
  assert.equal(shouldSoftRecommendBackgroundAudio('overthinking', ['rain'], false, '今天脑子停不下来'), true);
  assert.equal(shouldSoftRecommendBackgroundAudio('calm', ['rain'], false, '今晚想聊聊天'), false);
  assert.equal(shouldSoftRecommendBackgroundAudio('overthinking', [], false, '今天脑子停不下来'), false);
  assert.equal(shouldSoftRecommendBackgroundAudio('overthinking', ['rain'], true, '今天脑子停不下来'), false);
});

test('marks a recommendation as declined for the current session', () => {
  let session = createBackgroundAudioSession();
  assert.equal(session.recommendationCooldown, false);
  session = markRecommendationDeclined(session);
  assert.equal(session.recommendationCooldown, true);
});
