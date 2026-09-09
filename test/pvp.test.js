/**
 * 視聴者どうしの戦いと、行動ごとの力のテスト。
 *
 * 一番大事なのは「**タダでも戦える道が残っている**」ことです。
 * ギフトを贈った人だけが強いなら、他の全員の行動は飾りになります。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup, makeConfig } = require('./helpers.js');

/**
 * 2 つの円を重ねて置く場を作る。敵は湧かず、円も動きません。
 * 削り合いだけを見ます。
 */
function ring(aPoints, bPoints, tweak = {}) {
  const s = setup({
    config: {
      demo: { enabled: false },
      enemies: { spawn: { intervalMs: 999_999, initialCount: 0, minAlive: 0, maxAlive: 0 } },
      ...tweak
    }
  });
  s.engine.enemies.length = 0;

  const make = (id, points, x) => {
    const circle = s.engine.spawnCircle({ ownerId: id, ownerName: id, points: points, x: x, y: 500 });
    circle.velocity.x = 0;
    circle.velocity.y = 0;
    return circle;
  };
  // 半径ぶんだけずらして、必ず触れている状態にします
  const a = make('a', aPoints, 500);
  const b = make('b', bPoints, 500 + a.radius);
  return { ...s, a, b };
}

/** 押し離されても触れ続けるように、毎フレーム重ね直しながら進める。 */
function grind(r, ms, step = 50) {
  for (let t = 0; t < ms; t += step) {
    r.b.position.x = r.a.position.x + r.a.radius;
    r.b.position.y = r.a.position.y;
    r.advance(step);
  }
}

// ------------------------------------------------------------ PvP

test('触れている円どうしは削り合う', () => {
  const r = ring({ attack: 60 }, { attack: 60 });
  const before = { a: r.a.hp, b: r.b.hp };

  grind(r, 2000);

  assert.ok(r.a.hp < before.a, '自分が削られていない');
  assert.ok(r.b.hp < before.b, '相手を削っていない');
});

test('同じ人の円どうしは戦わない', () => {
  const r = ring({ attack: 60 }, { attack: 60 });
  r.b.ownerId = 'a';
  const before = r.b.hp;

  grind(r, 2000);
  assert.strictEqual(r.b.hp, before, '自分の円を殴っている');
});

test('PvP を切れば削り合わない', () => {
  const r = ring({ attack: 60 }, { attack: 60 }, { viewers: { pvp: { enabled: false } } });
  const before = r.b.hp;

  grind(r, 2000);
  assert.strictEqual(r.b.hp, before);
});

test('PvP は敵と殴り合うより弱い (一瞬で溶けない)', () => {
  const config = makeConfig();
  assert.ok(config.viewers.pvp.damageRatio < 1,
    '視聴者どうしが敵と同じ威力で殴り合っている');
  assert.ok(config.viewers.pvp.intervalMs >= config.viewers.base.attackIntervalMs,
    'PvP のほうが速く殴れてしまう');
});

test('倒した人にポイントが入る (相手の積み上げに比例)', () => {
  const r = ring({ attack: 150 }, { hp: 1 });
  const kos = [];
  r.session.on('ko', (event) => kos.push(event));
  // 名前をセッションに知らせておく (本番はイベント経由で入ります)
  r.session.users.a = { id: 'a', uniqueId: 'a' };
  r.session.users.b = { id: 'b', uniqueId: 'b' };

  grind(r, 20_000);

  assert.strictEqual(kos.length, 1, '撃破が記録されていない');
  assert.strictEqual(kos[0].killer.id, 'a');
  assert.ok(kos[0].points > 0);
  assert.ok(r.leaderboard.get('a').score > 0, 'スコアに入っていない');
});

test('育っていない円を倒しても、ほとんど点にならない', () => {
  // 倒す側は、殴り返されても落ちないように硬くしておきます
  const big = ring({ attack: 150, hp: 128 }, { hp: 60, attack: 60 });
  const small = ring({ attack: 150, hp: 128 }, { hp: 1 });
  const points = [];
  big.session.users.a = small.session.users.a = { id: 'a', uniqueId: 'a' };
  big.session.on('ko', (e) => points.push(['big', e.points]));
  small.session.on('ko', (e) => points.push(['small', e.points]));

  grind(big, 60_000);
  grind(small, 60_000);

  const bigPoints = (points.find((p) => p[0] === 'big') || [])[1];
  const smallPoints = (points.find((p) => p[0] === 'small') || [])[1];
  assert.ok(bigPoints > smallPoints * 5,
    `育った相手 ${bigPoints} と入りたて ${smallPoints} で差が付いていない`);
});

// ---------------------------------------------------------- スパイク

test('棘は触れてきた相手を刺す (殴らなくても)', () => {
  // 攻撃力は base のまま、棘だけ持たせる
  const r = ring({ spike: 6, hp: 40 }, {});
  const before = r.b.hp;

  grind(r, 2000);
  assert.ok(r.b.hp < before, '触れているのに刺していない');
});

test('棘が無ければ刺さらない', () => {
  const r = ring({}, {});
  const damageWithSpikes = (() => {
    const spiked = ring({ spike: 6, hp: 40 }, {});
    const before = spiked.b.hp;
    grind(spiked, 2000);
    return before - spiked.b.hp;
  })();

  const before = r.b.hp;
  grind(r, 2000);
  const plain = before - r.b.hp;

  assert.ok(damageWithSpikes > plain, '棘のあるなしで差が出ていない');
});

test('棘は敵にも刺さる (いいねとフォローだけでも戦える)', () => {
  const s = setup({
    config: {
      demo: { enabled: false },
      enemies: { spawn: { intervalMs: 999_999, initialCount: 0, minAlive: 0, maxAlive: 0 } },
      weapons: { enabled: false }               // 武器を切って棘だけを見る
    }
  });
  s.engine.enemies.length = 0;

  const circle = s.engine.spawnCircle({
    ownerId: 'u1', ownerName: 'yui', points: { spike: 8, hp: 60 }, x: 500, y: 500
  });
  circle.velocity.x = 0;
  circle.velocity.y = 0;
  circle.attackIntervalMs = 10_000_000;         // 本体の殴りも止める

  const enemy = s.engine.spawnEnemy('boss');
  enemy.hp = enemy.maxHp = 5_000_000;
  const before = enemy.hp;

  for (let t = 0; t < 3000; t += 50) {
    enemy.position.x = circle.position.x;
    enemy.position.y = circle.position.y;
    enemy.velocity.x = 0;
    enemy.velocity.y = 0;
    s.advance(50);
  }

  assert.ok(enemy.hp < before, '棘で敵を削れていない');
});

// ------------------------------------------------------------ ドレイン

test('ドレインは与えたダメージのぶん回復する', () => {
  const r = ring({ attack: 150, drain: 10 }, { hp: 200 });
  r.a.hp = Math.round(r.a.maxHp / 2);
  const before = r.a.hp;

  grind(r, 3000);

  assert.ok(r.a.hp > before, '削ったのに回復していない');
});

test('ドレインでも最大 HP は超えない', () => {
  const r = ring({ attack: 150, drain: 10 }, { hp: 200 });
  grind(r, 5000);
  assert.ok(r.a.hp <= r.a.maxHp);
});

test('ドレインが無ければ回復しない', () => {
  const r = ring({ attack: 150 }, { hp: 200 });
  r.a.hp = Math.round(r.a.maxHp / 2);
  const before = r.a.hp;

  grind(r, 3000);
  assert.ok(r.a.hp <= before, 'ドレインが無いのに回復している');
});
