/**
 * ラウンドと特殊イベントのテスト。
 *
 * ここで一番大事なのは 2 つです:
 *
 *   1. **時間が来るまでは、視聴者の積み上げを消さない**
 *      途中で消えるなら、育てる意味がなくなります。
 *   2. **時間が来たら知らせるだけで、自分では消さない**
 *      何を消すかを知っているのは組み立てた側 (app.js) です。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers.js');

/** 必ず特殊イベントを起こす director を作る。 */
function always(director = {}) {
  return setup({
    config: {
      director: {
        enabled: true, roundMs: 60_000, resultMs: 5_000,
        eventEveryMs: 10_000, eventChance: 1, ...director
      },
      enemies: { spawn: { intervalMs: 999_999, initialCount: 0, maxAlive: 200 } },
      demo: { enabled: false }
    },
    directorRandom: () => 0            // いつも先頭のイベントを引く
  });
}

/** 時間を進めながら director を回す。 */
function tick(s, ms, step = 500) {
  for (let t = 0; t < ms; t += step) {
    s.advance(step);
    s.director.update(s.now());
  }
}

// ------------------------------------------------------------ ラウンド

test('残り時間は減っていく', () => {
  const s = always();
  s.director.update(s.now());
  assert.strictEqual(s.director.remainingMs(s.now()), 60_000);

  tick(s, 20_000);
  assert.strictEqual(s.director.remainingMs(s.now()), 40_000);
});

test('時間が来ると結果 → リセットの順で知らせる', () => {
  const s = always();
  const ended = [];
  const resets = [];
  s.director.on('round:end', (event) => ended.push(event));
  s.director.on('round:reset', (event) => resets.push(event));

  s.director.update(s.now());
  tick(s, 59_000);
  assert.strictEqual(ended.length, 0, '時間前に終わっている');

  tick(s, 2_000);
  assert.strictEqual(ended.length, 1, '時間が来ても終わらない');
  assert.strictEqual(resets.length, 0, '結果を出す前にリセットしている');
  assert.strictEqual(s.director.phase, 'result');
  assert.strictEqual(s.director.remainingMs(s.now()), 0);

  tick(s, 6_000);
  assert.strictEqual(resets.length, 1, 'リセットが来ない');
  assert.strictEqual(s.director.phase, 'playing');
  assert.strictEqual(s.director.round, 2, 'ラウンドが数えられていない');
});

test('director 自身は円もランキングも消さない (知らせるだけ)', () => {
  const s = always();
  s.send({ type: 'like', count: 100, user: { id: 'u1', uniqueId: 'yui' } });
  const before = { circles: s.engine.circles.length, players: s.leaderboard.count() };
  assert.ok(before.circles > 0, '円が出ていない');

  tick(s, 70_000);                     // 結果もリセットも通り過ぎる

  assert.strictEqual(s.engine.circles.length, before.circles, '円を消している');
  assert.strictEqual(s.leaderboard.count(), before.players, 'ランキングを消している');
});

test('次のラウンドはまた丸ごと 1 本ぶん', () => {
  const s = always();
  tick(s, 66_000);                     // 1 ラウンド + 結果
  assert.strictEqual(s.director.round, 2);

  const left = s.director.remainingMs(s.now());
  assert.ok(left > 55_000, `次のラウンドが短い (${left}ms)`);
});

test('roundMs: 0 なら終わらない', () => {
  const s = always({ roundMs: 0 });
  const ended = [];
  s.director.on('round:end', (event) => ended.push(event));

  tick(s, 300_000);
  assert.strictEqual(ended.length, 0, '終わらない設定なのに終わっている');
  assert.strictEqual(s.director.remainingMs(s.now()), Infinity);
});

test('リセットすると 1 ラウンド目に戻る', () => {
  const s = always();
  tick(s, 66_000);
  s.director.reset();

  assert.strictEqual(s.director.round, 1);
  assert.strictEqual(s.director.phase, 'playing');
  assert.strictEqual(s.director.remainingMs(s.now()), 60_000);
});

// -------------------------------------------------------- 特殊イベント

test('特殊イベントは敵だけを増やす', () => {
  const s = always();
  const events = [];
  s.director.on('event', (event) => events.push(event));

  const before = s.engine.enemies.length;
  s.director.update(s.now());
  s.advance(11_000);
  s.director.update(s.now());

  assert.strictEqual(events.length, 1, 'イベントが起きていない');
  assert.ok(events[0].label, '画面に出す文字がない');
  assert.ok(s.engine.enemies.length > before, '敵が増えていない');
});

test('特殊イベントはラウンドとは別の間隔で起きる', () => {
  const s = always();
  const events = [];
  s.director.on('event', (event) => events.push(event));

  s.director.update(s.now());
  tick(s, 45_000);                     // 10 秒ごとなので 4 回ぶん

  assert.ok(events.length >= 4, `イベントが ${events.length} 回しか起きていない`);
});

test('確率 0 なら特殊イベントは起きない', () => {
  const s = always({ eventChance: 0 });
  const events = [];
  s.director.on('event', (event) => events.push(event));

  s.director.update(s.now());
  tick(s, 45_000);

  assert.strictEqual(events.length, 0);
});

test('結果を出している間は特殊イベントを起こさない', () => {
  const s = always();
  s.director.update(s.now());
  tick(s, 61_000);                     // 結果表示に入る

  const before = s.engine.enemies.length;
  s.director.update(s.now());
  assert.strictEqual(s.engine.enemies.length, before, '結果の裏で敵が増えている');
});

test('名前を指定して手で起こせる (テストパネル用)', () => {
  const s = always();
  const before = s.engine.enemies.length;

  const spawned = s.director.trigger('boss');
  assert.ok(spawned && spawned.length > 0, 'BOSS が出ていない');
  assert.ok(s.engine.enemies.length > before);
  assert.ok(spawned.every((enemy) => enemy.typeId === 'boss'));
});

test('無効にしていれば何も起きない', () => {
  const s = always({ enabled: false });
  const ended = [];
  s.director.on('round:end', (event) => ended.push(event));

  s.director.update(s.now());
  tick(s, 120_000);

  assert.strictEqual(s.director.update(s.now()), null);
  assert.strictEqual(s.director.round, 1);
  assert.strictEqual(ended.length, 0);
});
