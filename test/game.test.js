const test = require('node:test');
const assert = require('node:assert');
const { strengthToStats } = require('../js/game.js');
const { setup, makeConfig } = require('./helpers.js');

test('起動すると敵が置かれている', () => {
  const { engine, config } = setup();
  assert.strictEqual(engine.enemies.length, config.enemies.spawn.initialCount);
});

test('敵は一定間隔で自動生成される (TikTok イベントは不要)', () => {
  const { engine, config } = setup({ config: { enemies: { spawn: { minAlive: 0, maxAlive: 100 } } } });
  const before = engine.enemies.length;

  engine.update(engine._lastUpdate + config.enemies.spawn.intervalMs + 1);
  assert.strictEqual(engine.enemies.length, before + config.enemies.spawn.batch);
});

test('敵が下限を割ったら間隔を待たずに補充する', () => {
  const { engine, config } = setup();
  engine.enemies.length = 0;

  engine.update(engine._lastUpdate + 16);
  assert.strictEqual(engine.enemies.length, config.enemies.spawn.minAlive);
});

test('敵は上限を超えて増えない', () => {
  const { engine, advance } = setup({ config: { enemies: { spawn: { maxAlive: 10, intervalMs: 100 } } } });
  advance(60_000, { steps: 1200 });
  assert.ok(engine.enemies.length <= 10, `敵が ${engine.enemies.length} 体に増えている`);
});

test('敵はフィールドの外へ出ない', () => {
  const { engine, advance, config } = setup();
  advance(30_000, { steps: 900 });

  engine.enemies.forEach((enemy) => {
    assert.ok(enemy.position.x >= enemy.radius - 0.001 && enemy.position.x <= config.field.width - enemy.radius + 0.001,
      `x=${enemy.position.x} がフィールドの外`);
    assert.ok(enemy.position.y >= enemy.radius - 0.001 && enemy.position.y <= config.field.height - enemy.radius + 0.001,
      `y=${enemy.position.y} がフィールドの外`);
  });
});

test('敵は動き続ける (止まらない)', () => {
  const { engine, advance } = setup();
  const enemy = engine.enemies[0];
  const start = { x: enemy.position.x, y: enemy.position.y };

  advance(1_000, { steps: 30 });
  const moved = Math.hypot(enemy.position.x - start.x, enemy.position.y - start.y);
  assert.ok(moved > 1, '敵が動いていない');
});

test('完全に重なった敵は押し離される', () => {
  const { engine, advance } = setup();
  engine.enemies.length = 0;
  const a = engine.spawnEnemy('normal');
  const b = engine.spawnEnemy('normal');
  a.position.x = b.position.x = 500;
  a.position.y = b.position.y = 500;

  advance(1_000, { steps: 30 });
  const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  assert.ok(gap > 0, '重なったまま止まっている');
});

test('視聴者円は敵を攻撃して倒し、貢献度が残る', () => {
  const { engine, advance } = setup();
  engine.enemies.length = 0;
  engine.circles.length = 0;

  const killed = [];
  engine.on('enemy:killed', (kill) => killed.push(kill));

  const enemy = engine.spawnEnemy('normal');
  enemy.position.x = 500;
  enemy.position.y = 500;

  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', strength: 20, sourceEvent: 'GIFT' });
  circle.position.x = 500;
  circle.position.y = 500;

  advance(5_000, { steps: 150 });

  assert.strictEqual(killed.length >= 1, true, '敵が倒れていない');
  assert.strictEqual(engine.stats.defeated >= 1, true);
  assert.strictEqual(killed[0].lastHit.ownerId, 'u1');
  assert.strictEqual(killed[0].contributions[0].ownerId, 'u1');
  assert.ok(killed[0].contributions[0].damage > 0);
  assert.strictEqual(killed[0].points, 1);
});

test('倒した敵は消え、その後も新しい敵が出続ける', () => {
  const { engine, advance } = setup();
  for (let i = 0; i < 30; i += 1) {
    engine.spawnCircle({ ownerId: 'u' + i, ownerName: 'u' + i, strength: 30 });
  }
  advance(30_000, { steps: 900 });

  assert.ok(engine.stats.defeated > 0, '1 体も倒せていない');
  assert.ok(engine.enemies.length >= engine.config.enemies.spawn.minAlive, '敵が補充されていない');
});

test('1 人が持てる円の数には上限がある', () => {
  const { engine } = setup({ config: { viewers: { limits: { maxPerUser: 3 } } } });
  for (let i = 0; i < 10; i += 1) {
    engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', strength: 1 });
  }
  assert.strictEqual(engine.circles.filter((c) => c.ownerId === 'u1').length, 3);
});

test('フィールド全体の円の数にも上限がある', () => {
  const { engine } = setup({ config: { viewers: { limits: { maxCircles: 5, maxPerUser: 100 } } } });
  for (let i = 0; i < 20; i += 1) {
    engine.spawnCircle({ ownerId: 'u' + i, ownerName: 'u' + i, strength: 1 });
  }
  assert.strictEqual(engine.circles.length, 5);
});

test('円の情報が仕様どおり揃っている', () => {
  const { engine } = setup();
  const circle = engine.spawnCircle({
    ownerId: 'u1', ownerName: 'taro', profileImageUrl: 'https://x/a.webp',
    sourceEvent: 'GIFT', strength: 5
  });

  ['id', 'ownerId', 'ownerName', 'profileImageUrl', 'sourceEvent', 'strength',
    'hp', 'attack', 'radius', 'speed', 'position', 'velocity', 'kills', 'damage']
    .forEach((key) => assert.ok(circle[key] !== undefined, `${key} がない`));

  assert.strictEqual(typeof circle.position.x, 'number');
  assert.strictEqual(typeof circle.velocity.y, 'number');
});

test('強さが上がると HP も攻撃力も上がる (上限あり)', () => {
  const viewers = makeConfig().viewers;
  const weak = strengthToStats(1, viewers);
  const strong = strengthToStats(20, viewers);
  const huge = strengthToStats(100_000, viewers);

  assert.ok(strong.hp > weak.hp && strong.attack > weak.attack);
  assert.ok(strong.radius > weak.radius);
  assert.ok(huge.radius <= viewers.scaling.maxRadius);
  assert.strictEqual(huge.strength, viewers.scaling.maxStrength);
  assert.ok(huge.speed >= viewers.scaling.minSpeed);
});

test('敵の種類はあとから足せる', () => {
  const { engine } = setup();
  engine.addEnemyType({ id: 'event-boss', label: 'EVENT', hp: 20, radius: 30, speed: 10, attack: 1, attackIntervalMs: 500, points: 500, weight: 0, color: '#fff' });

  const enemy = engine.spawnEnemy('event-boss');
  assert.strictEqual(enemy.typeId, 'event-boss');
  assert.strictEqual(enemy.points, 500);
});

test('タブを離れて戻っても 1 フレームで進みすぎない', () => {
  // 敵 1 体だけにして、押し合いの影響を混ぜずに移動量だけを見る
  const { engine, config } = setup({
    config: {
      enemies: {
        spawn: { initialCount: 1, minAlive: 0, maxAlive: 1, intervalMs: 10_000_000 },
        movement: { chase: 0 }
      }
    }
  });
  const enemy = engine.enemies[0];
  const before = { x: enemy.position.x, y: enemy.position.y };

  engine.update(engine._lastUpdate + 600_000);           // 10 分ぶん

  const moved = Math.hypot(enemy.position.x - before.x, enemy.position.y - before.y);
  assert.ok(moved <= enemy.speed * (config.loop.maxDeltaMs / 1000) + 0.001,
    `1 フレームで ${moved} も進んでいる`);
});

test('視聴者が増えると敵も増える (上限は守る)', () => {
  const { engine, config } = setup();
  const step = config.enemies.spawn.circlesPerExtraEnemy;

  assert.strictEqual(engine.targetAlive(), config.enemies.spawn.minAlive);

  for (let i = 0; i < step * 4; i += 1) {
    engine.spawnCircle({ ownerId: 'u' + i, ownerName: 'u' + i, strength: 1 });
  }
  assert.strictEqual(engine.targetAlive(), config.enemies.spawn.minAlive + 4);

  for (let i = 0; i < config.viewers.limits.maxCircles; i += 1) {
    engine.spawnCircle({ ownerId: 'x' + i, ownerName: 'x' + i, strength: 1 });
  }
  assert.strictEqual(engine.targetAlive(), config.enemies.spawn.maxAlive);
});
