/**
 * このゲームの最重要仕様のテスト:
 * TikTok のイベントが 1 件も来なくても、ゲームが回り続けること。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers.js');

/** 60fps で ms 秒ぶん回す。 */
function run(harness, ms, withDemo) {
  const frames = Math.round(ms / 16.7);
  harness.advance(ms, { steps: frames, withDemo });
}

test('イベント 0 件でも敵は出続け、動き続ける', () => {
  const harness = setup();
  const { engine, config } = harness;

  const spawnsBefore = engine.stats.spawned;
  run(harness, 60_000, false);

  assert.ok(engine.stats.spawned > spawnsBefore, '敵が自動生成されていない');
  assert.ok(engine.enemies.length >= config.enemies.spawn.minAlive, '敵が減ったまま補充されていない');
  assert.ok(engine.enemies.length <= config.enemies.spawn.maxAlive, '敵が増えすぎている');
});

test('イベント 0 件でも戦闘が起きて敵が倒れる (デモ視聴者)', () => {
  const harness = setup();
  const { engine, leaderboard } = harness;

  run(harness, 60_000, true);

  assert.ok(engine.circles.length > 0, '視聴者円が 1 つも出ていない');
  assert.ok(engine.stats.defeated > 0, '敵が 1 体も倒れていない');
  assert.ok(leaderboard.count() > 0, 'ランキングが空のまま');
  assert.ok(leaderboard.top()[0].kills > 0 || leaderboard.top()[0].score > 0);
});

test('本物の視聴者が現れたらデモは止まり、記録も消える', () => {
  const harness = setup();
  const { engine, leaderboard, demo, send } = harness;

  run(harness, 20_000, true);
  assert.ok(leaderboard.count() > 0, 'デモの記録が作られていない');
  assert.ok(leaderboard.top().every((r) => r.demo), 'デモ以外が混ざっている');

  send({ type: 'like', user: { id: 'real-1', uniqueId: 'realviewer' }, count: 10 });

  assert.strictEqual(demo.active, false, 'デモが止まっていない');
  assert.strictEqual(leaderboard.count(), 1, 'デモの記録が残っている');
  assert.strictEqual(leaderboard.top()[0].userName, 'realviewer');

  // 引き上げは 1 つずつ。LIKE した瞬間に画面の円が全部消えてはいけない。
  assert.ok(engine.circles.filter((c) => c.demo).length > 1,
    'デモの円が一斉に消えている (画面がリセットされたように見える)');

  run(harness, 30_000, true);
  assert.strictEqual(engine.circles.filter((c) => c.demo).length, 0, 'デモの円が引き上げられていない');
  assert.ok(leaderboard.top().every((r) => !r.demo), 'デモの記録が復活している');
});

test('デモの円は少しずつ引き上げられる (画面が一度に空にならない)', () => {
  const harness = setup();
  const { engine, config, send } = harness;

  run(harness, 20_000, true);
  const before = engine.circles.filter((c) => c.demo).length;
  assert.ok(before >= 5, 'デモの円が足りない');

  send({ type: 'like', user: { id: 'real-1', uniqueId: 'realviewer' }, count: 10 });

  // 引き上げ間隔 2 回ぶん進めても、消えるのは 2〜3 個まで
  run(harness, config.demo.retireIntervalMs * 2, true);
  const after = engine.circles.filter((c) => c.demo).length;
  assert.ok(after < before, '引き上げが始まっていない');
  assert.ok(before - after <= 3, `${before - after} 個まとめて消えている`);
});

test('引き上げ中のデモの円が敵を倒しても、ランキングには戻らない', () => {
  const harness = setup();
  const { engine, leaderboard, send } = harness;

  run(harness, 20_000, true);
  send({ type: 'like', user: { id: 'real-1', uniqueId: 'realviewer' }, count: 10 });

  const killsBefore = engine.stats.defeated;
  run(harness, 5_000, true);

  assert.ok(engine.stats.defeated > killsBefore, '引き上げ中に戦闘が起きていない');
  assert.ok(leaderboard.top().every((r) => !r.demo), 'デモの名前がランキングに戻っている');
});

test('デモは設定で止められる', () => {
  const harness = setup({ config: { demo: { enabled: false } } });
  run(harness, 20_000, true);

  assert.strictEqual(harness.engine.circles.length, 0);
  assert.strictEqual(harness.leaderboard.count(), 0);
  assert.ok(harness.engine.enemies.length > 0, 'デモが無くても敵は出る');
});

test('長時間回しても円と敵の数は上限内に収まる', () => {
  const harness = setup();
  const { engine, config } = harness;

  for (let i = 0; i < 50; i += 1) {
    harness.send({ type: 'like', user: { id: 'u' + i, uniqueId: 'u' + i }, count: 500 });
  }
  run(harness, 120_000, false);

  assert.ok(engine.circles.length <= config.viewers.limits.maxCircles);
  assert.ok(engine.enemies.length <= config.enemies.spawn.maxAlive);
  assert.ok(engine.stats.defeated > 0);
});
