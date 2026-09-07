const test = require('node:test');
const assert = require('node:assert');
const { EventRouter, readUser } = require('../js/event-router.js');
const { makeConfig } = require('./helpers.js');

function router(overrides) {
  return new EventRouter({ config: makeConfig(overrides), now: () => 1000 });
}

test('LIKE / FOLLOW / SHARE / COMMENT をゲームイベントへ翻訳する', () => {
  const r = router();

  assert.deepStrictEqual(r.translate({ type: 'like', user: { uniqueId: 'a' }, count: 25 }).type, 'LIKE');
  assert.strictEqual(r.translate({ type: 'like', user: { uniqueId: 'a' }, count: 25 }).count, 25);
  assert.strictEqual(r.translate({ type: 'follow', user: { uniqueId: 'a' } }).type, 'FOLLOW');
  assert.strictEqual(r.translate({ type: 'share', user: { uniqueId: 'a' } }).type, 'SHARE');
  assert.strictEqual(r.translate({ type: 'chat', user: { uniqueId: 'a' }, comment: 'hi' }).text, 'hi');
});

test('ゲームで使わない種類は落とす', () => {
  const r = router();
  assert.strictEqual(r.translate({ type: 'viewer', viewerCount: 10 }), null);
  assert.strictEqual(r.translate({ type: 'chat', user: { uniqueId: 'a' }, comment: '' }), null);
  assert.strictEqual(r.translate({ type: 'unknown', user: { uniqueId: 'a' } }), null);
});

test('入室は JOIN として届く (呼び名が違っても)', () => {
  const r = router();
  ['member', 'join', 'enter'].forEach((type) => {
    const event = r.translate({ type: type, user: { uniqueId: 'a' } });
    assert.ok(event, type + ' が落ちている');
    assert.strictEqual(event.type, 'JOIN');
    assert.strictEqual(event.user.uniqueId, 'a');
  });
});

test('LIKE の数が無ければ 1 件として扱う', () => {
  const r = router();
  assert.strictEqual(r.translate({ type: 'like', user: { uniqueId: 'a' } }).count, 1);
});

test('ギフトのコイン価値: ダイヤ数 x 連打数', () => {
  const r = router();
  const event = r.translate({ type: 'gift', user: { uniqueId: 'a' }, diamondCount: 5, repeatCount: 3 });
  assert.strictEqual(event.type, 'GIFT');
  assert.strictEqual(event.value, 15);
});

test('ギフトの価値は giftId / 名前で上書きできる', () => {
  const byId = router({ gifts: { byId: { 5655: 99 } } });
  assert.strictEqual(byId.translate({ type: 'gift', user: {}, giftId: 5655, diamondCount: 1 }).value, 99);

  const byName = router({ gifts: { byName: { rose: 7 } } });
  assert.strictEqual(byName.translate({ type: 'gift', user: {}, giftName: 'Rose', diamondCount: 1 }).value, 7);
});

test('ダイヤ数が取れないギフトは既定値になる', () => {
  const r = router({ gifts: { defaultCoins: 4 } });
  assert.strictEqual(r.translate({ type: 'gift', user: {}, giftName: 'unknown gift' }).value, 4);
});

test('連打の途中経過 (finished:false) は数えない', () => {
  const r = router();
  assert.strictEqual(r.translate({ type: 'gift', user: {}, diamondCount: 1, finished: false }), null);
  assert.ok(r.translate({ type: 'gift', user: {}, diamondCount: 1, finished: true }));
});

test('ユーザー情報を 4 つに均す', () => {
  const user = readUser({ user: { id: '42', uniqueId: 'taro', nickname: 'たろう' } });
  assert.strictEqual(user.id, '42');
  assert.strictEqual(user.uniqueId, 'taro');
  assert.strictEqual(user.displayName, 'たろう');
});

test('userId が無ければユーザー名を鍵にする', () => {
  const user = readUser({ user: { uniqueId: 'taro' } });
  assert.strictEqual(user.id, 'taro');
});

test('プロフィール画像は正規化済み / 簡易 / protobuf のどれからでも取れる', () => {
  assert.strictEqual(readUser({ user: { uniqueId: 'a', profileImageUrl: 'https://x/a.webp' } }).profileImageUrl,
                     'https://x/a.webp');
  assert.strictEqual(readUser({ user: { uniqueId: 'a', profilePictureUrl: 'https://x/b.webp' } }).profileImageUrl,
                     'https://x/b.webp');

  // protobuf の User は avatarThumb.urlList[]。100x100 があればそれを選ぶ。
  const raw = {
    user: {
      uniqueId: 'a',
      avatarThumb: { urlList: ['https://x/huge.jpeg', 'https://x/100x100/pic.webp'] }
    }
  };
  assert.strictEqual(readUser(raw).profileImageUrl, 'https://x/100x100/pic.webp');
});

test('プロフィール画像が無ければ null (画面側で既定アイコンにする)', () => {
  assert.strictEqual(readUser({ user: { uniqueId: 'a' } }).profileImageUrl, null);
});

test('attach したセッションにだけ流す', () => {
  const r = router();
  const seen = [];
  r.attach('live-1', { handle: (e) => seen.push(e) });

  r.dispatch('live-1', { type: 'follow', user: { uniqueId: 'a' } });
  r.dispatch('live-2', { type: 'follow', user: { uniqueId: 'a' } });

  assert.strictEqual(seen.length, 1);
  assert.strictEqual(r.stats.routed, 1);
  assert.strictEqual(r.stats.dropped, 1);
});
