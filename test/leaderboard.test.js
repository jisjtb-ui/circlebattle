const test = require('node:test');
const assert = require('node:assert');
const { Leaderboard } = require('../js/leaderboard.js');
const { makeConfig } = require('./helpers.js');

function board(overrides) {
  return new Leaderboard({ config: makeConfig(overrides), now: () => 1000 });
}

const user = (name, extra = {}) => Object.assign({ id: name, uniqueId: name }, extra);

test('ユーザーを登録して撃破とダメージを記録する', () => {
  const lb = board();
  lb.addKill(user('taro'), 5, 1, 1000);
  lb.addDamage(user('taro'), 40, 1100);

  const record = lb.get('taro');
  assert.strictEqual(record.userName, 'taro');
  assert.strictEqual(record.kills, 1);
  assert.strictEqual(record.score, 5);
  assert.strictEqual(record.damage, 40);
  assert.strictEqual(record.lastActivity, 1100);
});

test('プロフィール画像は新しい値だけで上書きする', () => {
  const lb = board();
  lb.touch(user('taro', { profileImageUrl: 'https://x/a.webp' }));
  lb.touch(user('taro'));                                   // 画像の無いイベント
  assert.strictEqual(lb.get('taro').profileImageUrl, 'https://x/a.webp');

  lb.touch(user('taro', { profileImageUrl: 'https://x/b.webp' }));
  assert.strictEqual(lb.get('taro').profileImageUrl, 'https://x/b.webp');
});

test('初期設定は score の降順', () => {
  const lb = board();
  lb.addKill(user('a'), 10);
  lb.addKill(user('b'), 30);
  lb.addKill(user('c'), 20);

  assert.deepStrictEqual(lb.top().map((r) => r.userName), ['b', 'c', 'a']);
});

test('11 位以下は返さない', () => {
  const lb = board();
  for (let i = 1; i <= 25; i += 1) lb.addKill(user('p' + i), i);

  const top = lb.top();
  assert.strictEqual(top.length, 10);
  assert.strictEqual(top[0].userName, 'p25');
  assert.strictEqual(top[9].userName, 'p16');
});

test('kills / damage でも並べ替えられる', () => {
  const lb = board();
  lb.addKill(user('a'), 100, 1);       // score 100 / kills 1
  lb.addKill(user('b'), 10, 1);
  lb.addKill(user('b'), 10, 1);
  lb.addKill(user('b'), 10, 1);        // score 30 / kills 3
  lb.addDamage(user('a'), 50);
  lb.addDamage(user('b'), 999);

  assert.strictEqual(lb.top()[0].userName, 'a');            // score
  lb.setSort('kills');
  assert.strictEqual(lb.top()[0].userName, 'b');
  lb.setSort('damage');
  assert.strictEqual(lb.top()[0].userName, 'b');
  lb.setSort('score', 'asc');
  assert.strictEqual(lb.top()[0].userName, 'b');
});

test('設定でランキングの基準を変えられる', () => {
  const lb = board({ ranking: { sortBy: 'kills', size: 3 } });
  assert.strictEqual(lb.sortBy, 'kills');
  for (let i = 1; i <= 5; i += 1) lb.addKill(user('p' + i), 0, i);
  assert.deepStrictEqual(lb.top().map((r) => r.userName), ['p5', 'p4', 'p3']);
});

test('同点なら先に到達した人が上', () => {
  const lb = board();
  lb.addKill(user('early'), 10, 1, 1000);
  lb.addKill(user('late'), 10, 1, 5000);
  assert.deepStrictEqual(lb.top().map((r) => r.userName), ['early', 'late']);
});

test('変化するたびに version が上がる (描画の更新判定用)', () => {
  const lb = board();
  const before = lb.version;
  lb.addKill(user('a'), 1);
  assert.ok(lb.version > before);
});

test('デモ視聴者だけを消せる', () => {
  const lb = board();
  lb.addKill(user('real'), 1);
  lb.addKill(user('guest01', { demo: true }), 1);

  assert.strictEqual(lb.removeWhere((r) => r.demo), 1);
  assert.strictEqual(lb.count(), 1);
  assert.strictEqual(lb.top()[0].userName, 'real');
});

// ------------------------------------------------------- 圏外の人の順位

test('ランキング外の人でも順位が分かる', () => {
  const lb = board();
  for (let i = 1; i <= 25; i += 1) {
    lb.addScore({ id: 'u' + i, uniqueId: 'v' + i }, i * 10);
  }

  assert.strictEqual(lb.rankOf('u25'), 1, '一番点が高い人が 1 位でない');
  assert.strictEqual(lb.rankOf('u3'), 23);
  assert.strictEqual(lb.rankOf('nobody'), 0, '居ない人は 0');
});

test('直近に動いた本物の視聴者を覚えている', () => {
  const lb = board();

  lb.addScore({ id: 'u1', uniqueId: 'yui' }, 10);
  lb.addScore({ id: 'u2', uniqueId: 'ren' }, 10);
  assert.strictEqual(lb.mostRecent().userId, 'u2');

  // 仮の視聴者は「自分ごと」ではないので選ばない
  lb.addScore({ id: 'd1', uniqueId: 'demo1', demo: true }, 10);
  assert.strictEqual(lb.mostRecent().userId, 'u2');
});

test('消えた人は覚えたままにしない', () => {
  const lb = board();
  lb.addScore({ id: 'u1', uniqueId: 'yui' }, 10);

  lb.removeWhere((record) => record.userId === 'u1');
  assert.strictEqual(lb.mostRecent(), null);
});
