import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWatchLink, createWatchState, getWatchInputFeedback } from '../watch-together.js';

test('keeps the minimal link form quiet except when entered content is invalid', () => {
  assert.equal(getWatchInputFeedback(''), '');
  assert.equal(getWatchInputFeedback('https://www.bilibili.com/video/BV1B7411m7LV'), '');
  assert.equal(getWatchInputFeedback('https://v.douyin.com/AbCd12/'), '');
  assert.match(getWatchInputFeedback('not a link'), /链接/);
});

test('builds a Bilibili official player without autoplay or tracking parameters', () => {
  const link = parseWatchLink('https://www.bilibili.com/video/BV1B7411m7LV/?p=2&share_source=copy');
  assert.equal(link.valid, true);
  assert.equal(link.platform, 'bilibili');
  assert.equal(link.mode, 'embed');
  assert.equal(link.url, 'https://www.bilibili.com/video/BV1B7411m7LV/?p=2');
  const player = new URL(link.embedUrl);
  assert.equal(player.origin, 'https://player.bilibili.com');
  assert.equal(player.searchParams.get('bvid'), 'BV1B7411m7LV');
  assert.equal(player.searchParams.get('p'), '2');
  assert.equal(player.searchParams.get('autoplay'), '0');
  assert.equal(player.searchParams.get('danmaku'), '0');
});

test('extracts a link from mobile share text and recognizes the source', () => {
  const link = parseWatchLink('分享一个视频，复制链接打开 https://v.douyin.com/AbCd12/ 来看。');
  assert.equal(link.valid, true);
  assert.equal(link.platform, 'douyin');
  assert.equal(link.mode, 'external');
  assert.equal(link.url, 'https://v.douyin.com/AbCd12/');
});

test('accepts podcast episodes and short Bilibili links without pretending to embed them', () => {
  const podcast = parseWatchLink('https://www.xiaoyuzhoufm.com/episode/650000000000000000000001');
  assert.equal(podcast.valid, true);
  assert.equal(podcast.platform, 'xiaoyuzhou');
  assert.equal(podcast.mode, 'external');
  assert.equal(parseWatchLink('https://b23.tv/abc123').mode, 'external');
});

test('normalizes a copied bare URL and supports Bilibili AV identifiers', () => {
  assert.equal(parseWatchLink('www.bilibili.com/video/BV1B7411m7LV').mode, 'embed');
  const legacy = new URL(parseWatchLink('https://www.bilibili.com/video/av170001/?p=-1').embedUrl);
  assert.equal(legacy.searchParams.get('aid'), '170001');
  assert.equal(legacy.searchParams.get('p'), '1');
});

test('rejects unsafe, misleading, unsupported and multiple links', () => {
  for (const input of ['', 'javascript:alert(1)', 'http://www.bilibili.com/video/BV1B7411m7LV',
    'https://bilibili.com.evil.example/video/BV1B7411m7LV',
    'https://user:password@www.bilibili.com/video/BV1B7411m7LV',
    'https://www.bilibili.com:8443/video/BV1B7411m7LV',
    'https://127.0.0.1/video/BV1B7411m7LV', 'https://example.com/',
    'https://www.bilibili.com/video/BV1B7411m7LV https://v.douyin.com/abc/',
    'https://www.bilibili.com/']) {
    assert.equal(parseWatchLink(input).valid, false, input);
  }
});

test('does not replace an active selection on bad input and can edit or clear it', () => {
  const state = createWatchState();
  assert.equal(state.getSnapshot().view, 'input');
  state.setDraft('https://www.bilibili.com/video/BV1B7411m7LV');
  assert.equal(state.start(), true);
  assert.equal(state.getSnapshot().view, 'watch');
  state.edit();
  state.setDraft('not a link');
  assert.equal(state.start(), false);
  assert.equal(state.getSnapshot().selected.platform, 'bilibili');
  state.clear();
  assert.equal(state.getSnapshot().selected, null);
  assert.equal(state.getSnapshot().draft, '');
});
