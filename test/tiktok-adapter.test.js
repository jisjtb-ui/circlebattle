/**
 * 中継サーバー (tikhub) をどこに探しにいくかのテスト。
 *
 * 実際の接続はブラウザでしかできないので、ここでは URL の決め方だけを見ます。
 */
const test = require('node:test');
const assert = require('node:assert');
const { TikTokAdapter } = require('../js/tiktok-adapter.js');

const loc = (url) => {
  const parsed = new URL(url);
  return { protocol: parsed.protocol, origin: parsed.origin, search: parsed.search };
};

test('tikhub がゲームごと配信しているときは、その場所を見る', () => {
  const urls = TikTokAdapter.resolveBridgeUrls(loc('http://127.0.0.1:8787/circlebattle/'));
  assert.strictEqual(urls[0], 'http://127.0.0.1:8787/events');
});

test('別の場所から開いても tikhub の既定の待ち受け先を試す', () => {
  // VS Code の Live Server、社内サーバー、GitHub Pages などを想定
  const urls = TikTokAdapter.resolveBridgeUrls(loc('http://127.0.0.1:5500/index.html'));
  assert.strictEqual(urls[0], 'http://127.0.0.1:5500/events', 'まず自分の場所を見る');
  assert.ok(urls.indexOf('http://127.0.0.1:8787/events') !== -1,
    '同じ PC の tikhub を探しにいかない');
});

test('https のサイトから開いた場合も 127.0.0.1 を試す', () => {
  const urls = TikTokAdapter.resolveBridgeUrls(loc('https://example.com/game/'));
  assert.strictEqual(urls[0], 'https://example.com/events');
  assert.ok(urls.indexOf('http://127.0.0.1:8787/events') !== -1);
});

test('index.html を直接開いた (file://) ときは既定の待ち受け先', () => {
  const urls = TikTokAdapter.resolveBridgeUrls({ protocol: 'file:', origin: 'null', search: '' });
  assert.strictEqual(urls[0], 'http://127.0.0.1:8787/events');
});

test('?bridge= を付けたらそれだけを使う', () => {
  const urls = TikTokAdapter.resolveBridgeUrls(loc('http://127.0.0.1:5500/?bridge=http://192.168.0.5:8787/events'));
  assert.deepStrictEqual(urls, ['http://192.168.0.5:8787/events']);
});

test('同じ URL を二度試さない', () => {
  const urls = TikTokAdapter.resolveBridgeUrls(loc('http://127.0.0.1:8787/'));
  assert.strictEqual(urls.length, new Set(urls).size);
});

test('昔の呼び出し方 (1 つだけ返す) も動く', () => {
  assert.strictEqual(TikTokAdapter.resolveBridgeUrl(loc('http://127.0.0.1:8787/')),
    'http://127.0.0.1:8787/events');
});
