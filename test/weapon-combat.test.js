/**
 * 武器の当たり判定と特殊能力のテスト。
 *
 * 大事なのは「**見えている刃と当たる場所が同じ**」ことです。角度は engine が
 * 1 つだけ持ち (circle.weaponAngle)、描画はそれを読むだけなので、
 * ここで角度の扱いが正しければ画面ともずれません。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup, makeConfig } = require('./helpers.js');
const { weaponTierFor } = require('../js/game.js');

/** 敵を 1 体だけ、円から見て角度 angle・距離 distance のところに置く。 */
function place(s, circle, angle, distance, typeId = 'boss') {
  const enemy = s.engine.spawnEnemy(typeId);
  enemy.position.x = circle.position.x + Math.cos(angle) * distance;
  enemy.position.y = circle.position.y + Math.sin(angle) * distance;
  enemy.velocity.x = 0;
  enemy.velocity.y = 0;
  enemy.hp = enemy.maxHp = 5_000_000;      // 1 回では倒れないようにする
  return enemy;
}

/**
 * 武器だけを試せる場を作る。
 *   - 敵は自動で湧かない
 *   - 武器は回らない (spin 0)。角度を固定して当たり方だけを見る
 *   - 円は動かない
 */
function arena(level, tweak = {}) {
  const config = {
    demo: { enabled: false },
    enemies: { spawn: { intervalMs: 999_999, initialCount: 0, minAlive: 0, maxAlive: 99 } },
    weapons: { tiers: makeConfig().weapons.tiers.map((t) => ({ ...t, spin: 0 })) },
    ...tweak
  };
  const s = setup({ config });

  const circle = s.engine.spawnCircle({ ownerId: 'u1', ownerName: 'yui', level, x: 500, y: 500 });
  circle.velocity.x = 0;
  circle.velocity.y = 0;
  circle.weaponAngle = 0;
  s.engine.enemies.length = 0;

  const hits = [];
  s.engine.on('damage', (d) => hits.push(d));
  return { ...s, circle, hits, tier: s.engine.weaponTier(level) };
}

/** 円に触れない距離 (武器でしか届かない)。 */
function outside(circle, enemy) {
  return circle.radius + enemy.radius + 1;
}

// ----------------------------------------------------------- 当たり判定

test('武器は円に触れていない敵にも届く', () => {
  const a = arena(40);                       // PLASMA AXE
  const enemy = place(a, a.circle, 0, 10);
  const distance = outside(a.circle, enemy);
  enemy.position.x = a.circle.position.x + distance;

  assert.ok(distance > a.circle.radius + enemy.radius, '触れていない前提が崩れている');
  a.advance(400);

  const weapon = a.hits.filter((h) => h.source === 'weapon');
  assert.ok(weapon.length > 0, '武器が届いていない');
  assert.strictEqual(a.hits.filter((h) => h.source === 'body').length, 0,
    '触れていないのに本体が当たっている');
});

test('刃の向きから外れた敵には当たらない', () => {
  const a = arena(10);                       // NEON BLADE。腕は 1 本、角度 0
  const enemy = place(a, a.circle, Math.PI, 0);
  const distance = outside(a.circle, enemy);
  enemy.position.x = a.circle.position.x - distance;   // 真後ろ

  a.advance(600);
  assert.strictEqual(a.hits.length, 0, '刃の反対側の敵に当たっている');
});

test('武器が回ると、当たる相手が入れ替わる', () => {
  const a = arena(10, { weapons: {} });      // 回転はそのまま (spin 2.6)
  const tier = makeConfig().weapons.tiers.find((t) => t.id === 'blade');
  assert.ok(tier.spin > 0, '回っていない');

  const front = place(a, a.circle, 0, 10);
  const back = place(a, a.circle, Math.PI, 10);
  const distance = outside(a.circle, front);
  front.position.x = a.circle.position.x + distance;
  back.position.x = a.circle.position.x - distance;
  a.circle.weaponAngle = 0;

  // 半周ぶん回るまで進める
  a.advance(2000, { steps: 120 });

  const ids = new Set(a.hits.filter((h) => h.source === 'weapon').map((h) => h.enemy.id));
  assert.ok(ids.has(front.id), '前の敵に当たっていない');
  assert.ok(ids.has(back.id), '回ったのに後ろの敵に当たっていない');
});

test('腕の向き (offset) は絵と揃っている', () => {
  // PLASMA CANNON は円の真横に砲を出すので、当たるのも真横だけ
  const a = arena(70);
  const side = place(a, a.circle, Math.PI / 2, 10);
  const front = place(a, a.circle, 0, 10);
  const distance = outside(a.circle, side);
  side.position.x = a.circle.position.x;
  side.position.y = a.circle.position.y + distance;
  front.position.x = a.circle.position.x + distance;
  front.position.y = a.circle.position.y;

  a.advance(400);
  const struck = a.hits.filter((h) => h.source === 'weapon').map((h) => h.enemy.id);
  assert.ok(struck.includes(side.id), '砲の向きの敵に当たっていない');
  assert.ok(!struck.includes(front.id), '砲が向いていない方向に当たっている');
});

test('Lv1〜9 は武器を持たないので、武器では当たらない', () => {
  const a = arena(5);
  assert.strictEqual(a.tier.hit, null);

  const enemy = place(a, a.circle, 0, 10);
  enemy.position.x = a.circle.position.x + outside(a.circle, enemy);

  a.advance(600);
  assert.strictEqual(a.hits.length, 0, '武器を持たないのに当たっている');
});

test('武器は間隔を空けてしか当たらない', () => {
  const a = arena(40);
  const enemy = place(a, a.circle, 0, 10);
  enemy.position.x = a.circle.position.x + outside(a.circle, enemy);

  const interval = a.config.weapons.combat.intervalMs;
  a.advance(interval * 3, { steps: 60 });

  const weapon = a.hits.filter((h) => h.source === 'weapon').length;
  assert.ok(weapon >= 3 && weapon <= 5, `当たった回数がおかしい: ${weapon}`);
});

// ------------------------------------------------------------- 特殊能力

test('CLEAVE は一振りで複数の敵に当たる', () => {
  const a = arena(40);                       // maxTargets 3
  const enemies = [-0.3, 0, 0.3].map((angle) => {
    const e = place(a, a.circle, angle, 10);
    const d = outside(a.circle, e);
    e.position.x = a.circle.position.x + Math.cos(angle) * d;
    e.position.y = a.circle.position.y + Math.sin(angle) * d;
    return e;
  });

  a.advance(50);
  const struck = new Set(a.hits.filter((h) => h.source === 'weapon').map((h) => h.enemy.id));
  assert.strictEqual(struck.size, enemies.length, '一振りで 3 体に当たっていない');
});

test('当たる敵の数には上限がある', () => {
  const a = arena(10);                       // NEON BLADE は能力なし = 1 体まで
  for (const angle of [-0.15, 0, 0.15]) {
    const e = place(a, a.circle, angle, 10);
    const d = outside(a.circle, e);
    e.position.x = a.circle.position.x + Math.cos(angle) * d;
    e.position.y = a.circle.position.y + Math.sin(angle) * d;
  }

  a.advance(50);
  assert.strictEqual(a.hits.filter((h) => h.source === 'weapon').length, 1,
    '上限を超えて当たっている');
});

test('LIFESTEAL は斬ったぶんだけ HP が戻る', () => {
  const a = arena(50);                       // ENERGY SCYTHE
  const ability = a.tier.ability;
  assert.ok(ability.lifesteal > 0);

  const angle = a.tier.hit.offset;           // 刃が伸びている向き
  const enemy = place(a, a.circle, angle, 10);
  const d = outside(a.circle, enemy);
  enemy.position.x = a.circle.position.x + Math.cos(angle) * d;
  enemy.position.y = a.circle.position.y + Math.sin(angle) * d;

  a.circle.hp = a.circle.maxHp * 0.5;
  const before = a.circle.hp;
  a.advance(50);

  const dealt = a.hits.filter((h) => h.source === 'weapon')
    .reduce((sum, h) => sum + h.amount, 0);
  assert.ok(dealt > 0, '斬れていない');
  assert.ok(Math.abs((a.circle.hp - before) - dealt * ability.lifesteal) < 0.01,
    'HP の戻りが与ダメージと合っていない');
});

test('LIFESTEAL でも最大 HP は超えない', () => {
  const a = arena(50);
  const angle = a.tier.hit.offset;
  const enemy = place(a, a.circle, angle, 10);
  const d = outside(a.circle, enemy);
  enemy.position.x = a.circle.position.x + Math.cos(angle) * d;
  enemy.position.y = a.circle.position.y + Math.sin(angle) * d;

  a.advance(2000, { steps: 40 });
  assert.ok(a.circle.hp <= a.circle.maxHp, '最大 HP を超えている');
});

test('BARRAGE は武器の間隔が短い', () => {
  const base = arena(40);                    // rate なし
  const fast = arena(70);                    // rate 0.55
  assert.strictEqual(base.tier.ability.rate, undefined);
  assert.ok(fast.tier.ability.rate < 1);

  for (const a of [base, fast]) {
    const angle = a.tier.hit.offset || 0;
    const e = place(a, a.circle, angle, 10);
    const d = outside(a.circle, e);
    e.position.x = a.circle.position.x + Math.cos(angle) * d;
    e.position.y = a.circle.position.y + Math.sin(angle) * d;
    a.advance(2000, { steps: 200 });
  }

  const slow = base.hits.filter((h) => h.source === 'weapon').length;
  const quick = fast.hits.filter((h) => h.source === 'weapon').length;
  assert.ok(quick > slow, `連射が速くない (${quick} <= ${slow})`);
});

test('AEGIS は受けるダメージを減らす', () => {
  const plain = arena(70);                   // damageTaken なし
  const tough = arena(80);                   // damageTaken 0.6
  assert.strictEqual(plain.tier.ability.damageTaken, undefined);
  assert.ok(tough.tier.ability.damageTaken < 1);

  plain.engine._damageCircle(plain.circle, 100);
  tough.engine._damageCircle(tough.circle, 100);

  assert.strictEqual(plain.circle.maxHp - plain.circle.hp, 100);
  assert.strictEqual(tough.circle.maxHp - tough.circle.hp, 60);
});

test('NOVA は射程内の敵を全部まとめて殴る', () => {
  const a = arena(100);                      // LEGENDARY CORE
  const nova = a.tier.ability.nova;
  assert.ok(nova, 'NOVA が無い');

  // 刃の向きに関係なく、ぐるりと囲む
  const ring = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const e = place(a, a.circle, angle, 10);
    const d = a.circle.radius * 1.4;
    e.position.x = a.circle.position.x + Math.cos(angle) * d;
    e.position.y = a.circle.position.y + Math.sin(angle) * d;
    ring.push(e);
  }
  // 射程の外にも 1 体
  const far = place(a, a.circle, 0, 10);
  far.position.x = a.circle.position.x + a.circle.radius * 6;

  let fired = 0;
  a.engine.on('weapon:nova', () => { fired += 1; });

  // 1 発目は Lv100 に届いた瞬間に出る (演出としての区切り)
  a.advance(50, { steps: 4 });
  assert.strictEqual(fired, 1, '最大レベルに届いた瞬間に出ていない');

  const struck = new Set(a.hits.filter((h) => h.source === 'nova').map((h) => h.enemy.id));
  assert.strictEqual(struck.size, ring.length, '射程内の敵全部に当たっていない');
  assert.ok(!struck.has(far.id), '射程の外まで当たっている');

  // 2 発目は間隔を空けてから
  a.advance(nova.intervalMs - 200, { steps: 40 });
  assert.strictEqual(fired, 1, '間隔を待たずに 2 発目が出ている');
  a.advance(400, { steps: 20 });
  assert.strictEqual(fired, 2, '2 発目が出ていない');
});

test('NOVA を持たない段では衝撃波が出ない', () => {
  const a = arena(90);
  assert.strictEqual(a.tier.ability.nova, undefined);

  const e = place(a, a.circle, 0, 10);
  e.position.x = a.circle.position.x + a.circle.radius * 1.3;

  a.advance(6000, { steps: 200 });
  assert.strictEqual(a.hits.filter((h) => h.source === 'nova').length, 0);
});

// ------------------------------------------------ 見た目とルールが同じ段

test('段の引き当てはルール側と描画側で同じ', () => {
  const { Weapons } = require('../js/weapons.js');
  const config = makeConfig();
  const view = new Weapons({ config, doc: null });

  for (let level = 1; level <= 100; level += 1) {
    assert.strictEqual(view.tierFor(level), weaponTierFor(level, config.weapons),
      `Lv${level} で段が食い違っている`);
  }
});

test('当たり判定を持つ段には、必ず描く形がある', () => {
  const config = makeConfig();
  config.weapons.tiers.forEach((tier) => {
    if (!tier.hit) return;
    assert.ok(tier.hit.arms >= 1, `${tier.id} の腕が無い`);
    assert.ok(tier.hit.arc > 0 && tier.hit.arc <= Math.PI, `${tier.id} の角度がおかしい`);
    assert.ok(tier.hit.reach > 1, `${tier.id} の武器が円の内側にある`);
    assert.ok(tier.hit.reach <= config.weapons.extent + 0.05,
      `${tier.id} の当たり判定が絵より遠い`);
    assert.ok(tier.spin !== 0, `${tier.id} が回っていない`);
    assert.ok(tier.hit.layer === 'a' || tier.hit.layer === 'b');
  });
});
