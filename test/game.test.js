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

test('敵は等速直線運動をする (速さも向きも変わらない)', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 1, minAlive: 0, maxAlive: 1, intervalMs: 10_000_000 } } }
  });
  const enemy = engine.enemies[0];
  // 壁で反射しない向きと位置にしておく
  enemy.position.x = 500;
  enemy.position.y = 500;
  enemy.velocity.x = enemy.speed;
  enemy.velocity.y = 0;

  advance(2_000, { steps: 60 });

  assert.ok(Math.abs(enemy.velocity.x - enemy.speed) < 0.001, '速さが変わっている');
  assert.strictEqual(enemy.velocity.y, 0, '向きが変わっている');
  assert.ok(Math.abs(enemy.position.y - 500) < 0.001, 'まっすぐ進んでいない');
});

test('視聴者円も等速直線運動をする (敵を追いかけない)', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', strength: 1 });
  circle.position.x = 300;
  circle.position.y = 500;
  circle.velocity.x = circle.speed;
  circle.velocity.y = 0;

  // 追いかける実装なら、この敵のほうへ曲がってしまう
  const enemy = engine.spawnEnemy('normal');
  enemy.position.x = 300;
  enemy.position.y = 900;
  enemy.velocity.x = 0;
  enemy.velocity.y = 0;

  advance(1_000, { steps: 30 });

  assert.ok(Math.abs(circle.position.y - 500) < 0.001, '敵のほうへ曲がっている');
  assert.ok(Math.abs(circle.velocity.x - circle.speed) < 0.001, '速さが変わっている');
});

test('壁では反射する (フィールドから出ない)', () => {
  const { engine, advance, config } = setup({
    config: { enemies: { spawn: { initialCount: 1, minAlive: 0, maxAlive: 1, intervalMs: 10_000_000 } } }
  });
  const enemy = engine.enemies[0];
  enemy.position.x = config.field.width - enemy.radius - 1;
  enemy.position.y = 500;
  enemy.velocity.x = enemy.speed;
  enemy.velocity.y = 0;

  advance(1_000, { steps: 30 });

  assert.ok(enemy.velocity.x < 0, '壁で跳ね返っていない');
  assert.ok(Math.abs(Math.hypot(enemy.velocity.x, enemy.velocity.y) - enemy.speed) < 0.001,
    '反射で速さが変わっている');
});

test('設定を戻せば追いかける動きにもできる', () => {
  const { engine, advance } = setup({
    config: {
      viewers: { movement: { mode: 'seek' } },
      enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } }
    }
  });
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', strength: 1 });
  circle.position.x = 300;
  circle.position.y = 500;

  const enemy = engine.spawnEnemy('normal');
  enemy.position.x = 300;
  enemy.position.y = 900;
  enemy.velocity.x = 0;
  enemy.velocity.y = 0;

  advance(1_000, { steps: 30 });
  assert.ok(circle.position.y > 520, '敵に近づいていない');
});

test('プロフィール画像が見える大きさになっている', () => {
  const { config } = setup();
  // フィールド 1000 を 1080px で描くので、直径が 40px 未満だと顔が潰れる
  const diameterPx = config.viewers.base.radius * 2 * (1080 / config.field.width);
  assert.ok(diameterPx >= 40, `視聴者円の直径が ${Math.round(diameterPx)}px しかない`);
});

test('円同士はぶつかると跳ね返る', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });

  // 正面衝突させる
  const a = engine.spawnCircle({ ownerId: 'a', ownerName: 'a', strength: 1 });
  const b = engine.spawnCircle({ ownerId: 'b', ownerName: 'b', strength: 1 });
  a.position.x = 460; a.position.y = 500; a.velocity.x = a.speed;  a.velocity.y = 0;
  b.position.x = 540; b.position.y = 500; b.velocity.x = -b.speed; b.velocity.y = 0;

  advance(1_000, { steps: 60 });

  assert.ok(a.velocity.x < 0, '左の円が跳ね返っていない');
  assert.ok(b.velocity.x > 0, '右の円が跳ね返っていない');
  assert.ok(a.position.x < b.position.x, 'すり抜けている');
});

test('跳ね返っても速さは変わらない (等速のまま)', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });

  const a = engine.spawnCircle({ ownerId: 'a', ownerName: 'a', strength: 1 });
  const b = engine.spawnCircle({ ownerId: 'b', ownerName: 'b', strength: 1 });
  // 斜めにぶつける (真正面より速さが変わりやすい当たり方)
  a.position.x = 470; a.position.y = 480; a.velocity.x = a.speed; a.velocity.y = 0;
  b.position.x = 530; b.position.y = 500; b.velocity.x = 0; b.velocity.y = -b.speed;

  advance(2_000, { steps: 120 });

  [a, b].forEach((circle) => {
    const speed = Math.hypot(circle.velocity.x, circle.velocity.y);
    assert.ok(Math.abs(speed - circle.speed) < 0.001,
      `速さが ${speed.toFixed(1)} に変わっている (元は ${circle.speed})`);
  });
});

test('大きい円ほど押し勝つ (小さい円だけが跳ね返る)', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });

  const small = engine.spawnCircle({ ownerId: 'a', ownerName: 'a', strength: 1 });
  const big = engine.spawnCircle({ ownerId: 'b', ownerName: 'b', strength: 60 });
  small.position.x = 460; small.position.y = 500; small.velocity.x = small.speed; small.velocity.y = 0;
  big.position.x = 560; big.position.y = 500; big.velocity.x = 0; big.velocity.y = 0;
  const bigHeadingBefore = { x: big.velocity.x, y: big.velocity.y };

  advance(1_000, { steps: 60 });

  assert.ok(small.velocity.x < 0, '小さい円が跳ね返っていない');
  assert.ok(Math.hypot(big.velocity.x - bigHeadingBefore.x, big.velocity.y - bigHeadingBefore.y) < small.speed,
    '大きい円が小さい円と同じだけ飛ばされている');
});

test('円が敵にぶつかっても跳ね返る', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });

  const enemy = engine.spawnEnemy('boss');
  enemy.position.x = 560; enemy.position.y = 500; enemy.velocity.x = 0; enemy.velocity.y = 0;

  const circle = engine.spawnCircle({ ownerId: 'a', ownerName: 'a', strength: 1 });
  circle.position.x = 420; circle.position.y = 500; circle.velocity.x = circle.speed; circle.velocity.y = 0;

  advance(1_500, { steps: 90 });

  assert.ok(circle.velocity.x < 0, '敵から跳ね返っていない');
  assert.ok(enemy.hp < enemy.maxHp, 'ぶつかったのにダメージが入っていない');
});

test('円を大量に置いても 1 フレームの計算が跳ね上がらない', () => {
  const { engine, advance } = setup();
  for (let i = 0; i < 400; i += 1) {
    engine.spawnCircle({ ownerId: 'u' + (i % 20), ownerName: 'u' + (i % 20), strength: 1 });
  }
  assert.strictEqual(engine.circles.length, 400, '上限で消えている');

  const started = process.hrtime.bigint();
  advance(2_000, { steps: 120 });
  const perFrame = Number(process.hrtime.bigint() - started) / 1e6 / 120;

  // 総当たり (400^2/2 = 8 万組) だと 60fps に間に合わない。
  // 格子に切って隣だけを見るので、1 フレーム 1ms を大きく下回るはず。
  assert.ok(perFrame < 3, `1 フレーム ${perFrame.toFixed(2)}ms かかっている`);
});

test('設定で跳ね返りを切れる (押し離すだけに戻る)', () => {
  const { engine, advance } = setup({
    config: {
      collision: { bounce: false },
      enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } }
    }
  });

  const a = engine.spawnCircle({ ownerId: 'a', ownerName: 'a', strength: 1 });
  const b = engine.spawnCircle({ ownerId: 'b', ownerName: 'b', strength: 1 });
  a.position.x = 470; a.position.y = 500; a.velocity.x = a.speed; a.velocity.y = 0;
  b.position.x = 530; b.position.y = 500; b.velocity.x = a.speed; b.velocity.y = 0;

  advance(500, { steps: 30 });
  assert.ok(a.velocity.x > 0, '跳ね返らない設定なのに向きが変わっている');
});

test('敵は壁の上には湧かない (端をなぞる敵を作らない)', () => {
  const { engine, config } = setup();
  for (let i = 0; i < 80; i += 1) {
    const enemy = engine.spawnEnemy();
    const { x, y } = enemy.position;
    const gap = Math.min(x, y, config.field.width - x, config.field.height - y);
    assert.ok(gap > enemy.radius * 1.2,
      `${enemy.typeId} が壁から ${gap.toFixed(0)} しか離れていない (半径 ${enemy.radius})`);
    engine.enemies.length = 0;
  }
});

test('生まれた円は中央のほうへ進む', () => {
  const { engine, config } = setup();
  const cx = config.field.width / 2;
  const cy = config.field.height / 2;
  let inward = 0;

  for (let i = 0; i < 60; i += 1) {
    const enemy = engine.spawnEnemy();
    // 中央へのベクトルと進行方向が同じ向きなら内向き
    const dot = (cx - enemy.position.x) * enemy.velocity.x + (cy - enemy.position.y) * enemy.velocity.y;
    if (dot > 0) inward += 1;
    engine.enemies.length = 0;
  }

  assert.strictEqual(inward, 60, `${60 - inward} 体が中央と逆を向いて生まれた`);
});

test('壁と平行な向きでは生まれない', () => {
  const { engine, config } = setup();
  const min = config.motion.minWallAngleDeg * Math.PI / 180;

  for (let i = 0; i < 80; i += 1) {
    const enemy = engine.spawnEnemy();
    const heading = Math.atan2(enemy.velocity.y, enemy.velocity.x);
    const quarter = Math.PI / 2;
    const offAxis = Math.abs(heading - Math.round(heading / quarter) * quarter);
    assert.ok(offAxis >= min - 1e-9,
      `${(offAxis * 180 / Math.PI).toFixed(1)} 度しか軸から離れていない`);
    engine.enemies.length = 0;
  }
});

test('壁際に居座り続けたら中央へ向け直す', () => {
  const { engine, advance, config } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });

  const enemy = engine.spawnEnemy('normal');
  // 壁沿いにまっすぐ進む状態を作る (放っておくと永久に端を往復する)
  enemy.position.x = enemy.radius;
  enemy.position.y = 200;
  enemy.velocity.x = 0;
  enemy.velocity.y = enemy.speed;

  advance(config.motion.recenterAfterMs + 500, { steps: 120 });

  assert.ok(Math.abs(enemy.velocity.x) > 1, '壁沿いのまま向きが変わっていない');
  assert.ok(enemy.velocity.x > 0, '中央と逆 (壁の外) を向いている');
});

test('小さい敵が大きい敵の中に埋まったままにならない', () => {
  const { engine, advance } = setup({
    config: { enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } } }
  });

  // 角にボス 2 体を置き、その中に雑魚を埋める (報告された見た目そのもの)
  const bossA = engine.spawnEnemy('boss');
  const bossB = engine.spawnEnemy('boss');
  const small = engine.spawnEnemy('normal');
  bossA.position.x = 80; bossA.position.y = 80;
  bossB.position.x = 120; bossB.position.y = 120;
  small.position.x = 100; small.position.y = 100;

  advance(4_000, { steps: 240 });

  [[bossA, bossB], [bossA, small], [bossB, small]].forEach(([a, b]) => {
    const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    assert.ok(gap >= a.radius + b.radius - 1,
      `${a.typeId} と ${b.typeId} が ${(a.radius + b.radius - gap).toFixed(1)} 重なったまま`);
  });
});

test('しばらく回しても敵が端に偏らない', () => {
  const harness = setup();
  const { engine, config } = harness;
  const W = config.field.width;
  const H = config.field.height;
  let middle = 0;
  let samples = 0;

  for (let t = 0; t < 120; t += 1) {
    harness.advance(1000, { steps: 60, withDemo: true });
    engine.enemies.forEach((enemy) => {
      samples += 1;
      const inMiddle = enemy.position.x > W / 3 && enemy.position.x < W * 2 / 3 &&
                       enemy.position.y > H / 3 && enemy.position.y < H * 2 / 3;
      if (inMiddle) middle += 1;
    });
  }

  // 面積比だと中央の 3 分の 1 四方は 11%。半分の 5.5% を下回るなら端に偏っている。
  const share = 100 * middle / samples;
  assert.ok(share > 5.5, `中央に居た割合が ${share.toFixed(1)}% しかない`);
});
