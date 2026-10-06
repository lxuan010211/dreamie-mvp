import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioPlaybackController } from '../audio-player.js';

class FakeAudio {
  static instances = [];

  constructor(src) {
    this.src = src;
    this.loop = false;
    this.volume = 1;
    this.paused = true;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.listeners = new Map();
    FakeAudio.instances.push(this);
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    if (this.rejectPlay) return Promise.reject(new Error('autoplay blocked'));
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  load() {}
}

test('plays a voice layer and returns to idle when stopped', async () => {
  FakeAudio.instances = [];
  const player = createAudioPlaybackController({ AudioCtor: FakeAudio });

  player.loadVoice('data:audio/mpeg;base64,AAE=');
  await player.play();
  assert.equal(player.getState(), 'playing');

  player.stop();
  assert.equal(player.getState(), 'idle');
  assert.equal(FakeAudio.instances[0].pauseCalls, 1);
});

test('plays and stops voice plus background layers together', async () => {
  FakeAudio.instances = [];
  const player = createAudioPlaybackController({ AudioCtor: FakeAudio });

  player.loadVoice('voice', { mode: 'voice_with_background' });
  player.loadBackground('/api/audio/spring-rain', { preserveVoice: true, mode: 'voice_with_background' });
  await player.play();

  assert.equal(FakeAudio.instances[0].playCalls, 1);
  assert.equal(FakeAudio.instances[1].playCalls, 1);
  assert.equal(FakeAudio.instances[1].volume, 0.18);

  player.stop();
  assert.equal(FakeAudio.instances[0].pauseCalls, 1);
  assert.equal(FakeAudio.instances[1].pauseCalls, 1);
});

test('keeps a manual play state when autoplay is blocked', async () => {
  FakeAudio.instances = [];
  const player = createAudioPlaybackController({ AudioCtor: FakeAudio });
  player.loadVoice('voice');
  FakeAudio.instances[0].rejectPlay = true;

  await assert.rejects(() => player.play(), /autoplay blocked/);
  assert.equal(player.getState(), 'ready');
});

test('replaces the previous voice layer when loading background-only audio', async () => {
  FakeAudio.instances = [];
  const player = createAudioPlaybackController({ AudioCtor: FakeAudio });
  player.loadVoice('old-voice');
  player.stop();
  player.loadBackground('/api/audio/rain');
  await player.play();
  assert.equal(FakeAudio.instances[0].playCalls, 0);
  assert.equal(FakeAudio.instances[1].playCalls, 1);
});

test('stops the successful layer when a mixed playback layer rejects', async () => {
  FakeAudio.instances = [];
  const player = createAudioPlaybackController({ AudioCtor: FakeAudio });
  player.loadVoice('voice', { mode: 'voice_with_background' });
  player.loadBackground('/api/audio/rain', { preserveVoice: true, mode: 'voice_with_background' });
  FakeAudio.instances[1].rejectPlay = true;
  await assert.rejects(() => player.play(), /autoplay blocked/);
  assert.equal(FakeAudio.instances[0].paused, true);
  assert.equal(FakeAudio.instances[1].paused, true);
  assert.equal(player.getState(), 'ready');
});
