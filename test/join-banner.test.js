/**
 * 入室した人の名前を中央に出す係のテスト。
 *
 * 大事なのは 3 つです:
 *
 *   1. 受け取った瞬間に動く   … 円 (大砲) を待たない
 *   2. 重ならない             … 1 度に 1 人だけ
 *   3. 大量入室で詰まらない   … 短くする / あふれたら数える
 */
const test = require('node:test');
const assert = require('node:assert');
const { JoinBanner } = require('../js/join-banner.js');
const { setup, makeConfig } = require('./helpers.js');

function banner(overrides = {}) {
  return new JoinBanner({ config: makeConfig({ ui: { join: { banner: overrides } } }) });
}

function user(name) {
  return { id: name, uniqueId: name, displayName: name };
}

// ------------------------------------------------------ 受け取った瞬間

test('入室を受け取ると、その場で名前が出る', () => {
  const b = banner();
  b.push(user('yui'), 1000);

  const shown = b.update(1000);
  assert.ok(shown, '受け取ったのに何も出ていない');
  assert.strictEqual(shown.name, 'yui');
});

test('時間が来ると消える', () => {
  const b = banner({ holdMs: 1100 });
  b.push(user('yui'), 0);
  b.update(0);

  assert.ok(b.active(1000), '1.1 秒より前に消えている');
  assert.strictEqual(b.active(1101), null, '時間を過ぎても出たまま');
});

test('enabled: false なら何も出さない', () => {
  const b = banner({ enabled: false });
  assert.strictEqual(b.push(user('yui'), 0), false);
  assert.strictEqual(b.update(0), null);
});

// -------------------------------------------------------------- 順番

test('2 人同時に入っても重ねず、順番に出す', () => {
  const b = banner({ holdMs: 1000, gapMs: 100, rushFrom: 9 });
  b.push(user('yui'), 0);
  b.push(user('rin'), 0);

  assert.strictEqual(b.update(0).name, 'yui');
  assert.strictEqual(b.update(500).name, 'yui', '途中で入れ替わっている');
  assert.strictEqual(b.update(1000), null, '間を置かずに次が出ている');
  assert.strictEqual(b.update(1100).name, 'rin');
});

test('出し直しのたびに通し番号が増える (描き直しの合図)', () => {
  const b = banner({ holdMs: 100, gapMs: 0, rushFrom: 9 });
  b.push(user('yui'), 0);
  b.push(user('rin'), 0);

  const first = b.update(0).serial;
  b.update(100);
  const second = b.update(100).serial;
  assert.ok(second > first, '同じ番号だと画面が更新されない');
});

// ---------------------------------------------------------- 混んだとき

test('待ちが増えたら 1 人ぶんを短くする', () => {
  const b = banner({ holdMs: 1100, rushHoldMs: 520, rushFrom: 3 });
  for (const name of ['a', 'b', 'c', 'd']) b.push(user(name), 0);

  const shown = b.update(0);
  assert.strictEqual(shown.until - shown.shownAt, 520, '混んでいるのに長いまま');
});

test('待ちがはけたら元の長さに戻る', () => {
  const b = banner({ holdMs: 1100, rushHoldMs: 520, rushFrom: 3, gapMs: 0 });
  b.push(user('a'), 0);

  const shown = b.update(0);
  assert.strictEqual(shown.until - shown.shownAt, 1100);
});

test('上限を超えたぶんは数だけ数える (誰も落とさない)', () => {
  const b = banner({ maxQueue: 3 });
  for (let i = 0; i < 10; i += 1) b.push(user('u' + i), 0);

  assert.strictEqual(b.queue.length, 3, '待ちが上限を超えている');
  assert.strictEqual(b.overflow, 7, 'あふれたぶんが数えられていない');
});

test('あふれた人数は次の 1 人に添えて、1 度だけ出す', () => {
  const b = banner({ maxQueue: 2, holdMs: 100, gapMs: 0, rushFrom: 9 });
  for (let i = 0; i < 5; i += 1) b.push(user('u' + i), 0);

  assert.strictEqual(b.update(0).more, 3, '人数が添えられていない');
  b.update(100);
  assert.strictEqual(b.update(100).more, 0, '同じ人数が 2 回出ている');
});

test('大量入室でも必ず順番がはける (詰まらない)', () => {
  const b = banner({ holdMs: 1100, rushHoldMs: 520, rushFrom: 3, gapMs: 90, maxQueue: 5 });
  for (let i = 0; i < 50; i += 1) b.push(user('u' + i), 0);

  let clock = 0;
  while (clock < 20000 && (b.queue.length || b.current)) {
    clock += 20;
    b.update(clock);
  }
  assert.strictEqual(b.queue.length, 0, '20 秒たっても順番待ちが残っている');
  assert.ok(clock < 5000, `はけるまで ${clock}ms もかかっている`);
});

test('reset で全部消える', () => {
  const b = banner();
  b.push(user('yui'), 0);
  b.update(0);
  b.reset();

  assert.strictEqual(b.current, null);
  assert.strictEqual(b.queue.length, 0);
  assert.strictEqual(b.overflow, 0);
});

// ------------------------------------------------- セッションからの経路

test("入室を受け取った瞬間に 'join' が流れる (円より先)", () => {
  const s = setup({ config: { demo: { enabled: false } } });
  const joins = [];
  const spawns = [];
  s.session.on('join', (join) => joins.push(join));
  s.session.on('spawn', (spawn) => spawns.push(spawn));

  s.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });

  assert.strictEqual(joins.length, 1, '入室が流れていない');
  assert.strictEqual(joins[0].user.uniqueId, 'yui');
  assert.strictEqual(spawns.length, 1);
});

test('大砲が詰まっていても入室はその場で流れる', () => {
  const s = setup({ config: { demo: { enabled: false } } });
  // 大砲の代わりに「受け取るだけで撃たない」ものを繋いで、円を止めます
  s.session.launcher = {
    enqueue: () => true,
    pendingCount: () => 0,
    pendingFor: () => null
  };

  const joins = [];
  const spawns = [];
  s.session.on('join', (join) => joins.push(join));
  s.session.on('spawn', (spawn) => spawns.push(spawn));

  s.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });

  assert.strictEqual(joins.length, 1, '円が出るまで名前が出ない');
  assert.strictEqual(spawns.length, 0, '円のほうは大砲待ちのはず');
});

test('2 回目以降の入室では名前を出さない', () => {
  const s = setup({ config: { demo: { enabled: false } } });
  const joins = [];
  s.session.on('join', (join) => joins.push(join));

  s.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });
  s.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });
  s.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });

  assert.strictEqual(joins.length, 1, '出入りするだけで何度も名前が出る');
});
