import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { findSleepAudioById, listDefaultSleepAudio } from '../src/audio-catalog.js';

test('finds the ocean track by its stable catalog id', () => {
  const track = findSleepAudioById('ocean-waves');

  assert.equal(track?.title, '大海的声音和有节奏的海浪声');
  assert.equal(track?.kind, 'ocean');
  assert.equal(existsSync(track?.filePath ?? ''), true);
});

test('only exposes gentle tracks in the default sleep recommendations', () => {
  const tracks = listDefaultSleepAudio();

  assert.equal(tracks.some((track) => track.id === 'asmr-microphone-biting'), false);
  assert.equal(tracks.some((track) => track.id === 'spring-rain'), true);
  assert.equal(tracks.some((track) => track.id === 'ocean-waves'), true);
});
