/**
 * ウェーブと特殊イベントのテスト。
 *
 * ここで一番大事なのは「**視聴者の積み上げを消さない**」ことです。
 * 区切りが入るたびに円やランキングが消えるなら、育てる意味がなくなります。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers.js');

/** 必ず特殊イベントを起こす director を作る。 */
function always(director = {}) {
  return setup({
    config: {
      director: { enabled: true, waveMs: 10_000, eventChance: 1, ...director },
      enemies: { spawn: { intervalMs: 999_999, initialCount: 0, maxAlive: 200 } },
      demo: { enabled: false }
    },
    directorRandom: () => 0            // いつも先頭のイベントを引く
  });
}

test('ウェーブは時間で進む', () => {
  const s = always();
  assert.strictEqual(s.director.wave, 1);

  s.director.update(s.now());          // 1 回目は次の時刻を決めるだけ
  s.advance(9_000);
  assert.strictEqual(s.director.update(s.now()), null, 'まだ進んではいけない');
  assert.strictEqual(s.director.wave, 1);

  s.advance(2_000);
  s.director.update(s.now());
  assert.strictEqual(s.director.wave, 2);
});

test('ウェーブが進んでも円とランキングは消えない', () => {
  const s = always();
  s.send({ type: 'like', count: 100, user: { id: 'u1', uniqueId: 'yui' } });

  const before = {
    circles: s.engine.circles.length,
    level: s.engine.circles[0].level,
    players: s.leaderboard.count()
  };
  assert.ok(before.circles > 0, '円が出ていない');

  s.director.update(s.now());
  for (let i = 0; i < 5; i += 1) {
    s.advance(11_000);
    s.director.update(s.now());
  }

  assert.ok(s.director.wave >= 5, 'ウェーブが進んでいない');
  assert.strictEqual(s.engine.circles.length, before.circles, '円が消えた');
  assert.strictEqual(s.engine.circles[0].level, before.level, 'レベルが下がった');
  assert.strictEqual(s.leaderboard.count(), before.players, 'ランキングが消えた');
});

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

test('確率 0 なら特殊イベントは起きない (ウェーブだけ進む)', () => {
  const s = always({ eventChance: 0 });
  const events = [];
  s.director.on('event', (event) => events.push(event));

  s.director.update(s.now());
  s.advance(11_000);
  s.director.update(s.now());

  assert.strictEqual(events.length, 0);
  assert.strictEqual(s.director.wave, 2);
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
  s.director.update(s.now());
  s.advance(60_000);

  assert.strictEqual(s.director.update(s.now()), null);
  assert.strictEqual(s.director.wave, 1);
});
