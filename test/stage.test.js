/**
 * 混んできたらフィールドが広がり、空いたら戻ることのテスト。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers.js');

/** 敵を出さない静かなフィールド (円だけで混み具合を作る)。 */
function quiet(overrides = {}) {
  return setup({
    config: Object.assign({
      enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } }
    }, overrides)
  });
}

/**
 * 占有率が target を超えるまで円を置く。
 *
 * 個数を決め打ちにしないのは、フィールドの広さや比を変えたときに
 * 「混んでいる」の意味が変わってしまうためです。
 */
function crowd(engine, level, target) {
  for (let i = 0; i < 400 && engine.coverage() <= target; i += 1) {
    if (!engine.spawnCircle({ ownerId: 'u' + i, ownerName: 'u' + i, level: level })) break;
  }
  return engine.coverage();
}

test('混んでくるとフィールドが広がる', () => {
  const { engine, advance, config } = quiet();
  assert.strictEqual(engine.field.width, config.field.width);

  crowd(engine, 100, config.field.expand.growAt);
  assert.ok(engine.coverage() > config.field.expand.growAt, 'テストが混んでいない');

  advance(config.field.expand.durationMs + 200, { steps: 140 });

  assert.strictEqual(engine.stage, 1);
  assert.ok(Math.abs(engine.field.width - engine.stageWidth(1)) < 1,
    `広さが ${engine.field.width} で止まっている`);
});

test('広がるのは一瞬ではなく 2 秒かけて', () => {
  const { engine, advance, config } = quiet();
  crowd(engine, 100, config.field.expand.growAt);

  const total = engine.stageWidth(1) - config.field.width;

  advance(100, { steps: 6 });
  const early = engine.field.width;
  const progress = (early - config.field.width) / total;
  assert.ok(progress < 0.15, `0.1 秒で ${(progress * 100).toFixed(0)}% も広がっている`);

  advance(config.field.expand.durationMs / 2, { steps: 60 });
  const mid = engine.field.width;
  assert.ok(mid > early && mid < engine.stageWidth(1), '途中で止まっている');

  advance(config.field.expand.durationMs, { steps: 120 });
  assert.ok(Math.abs(engine.field.width - engine.stageWidth(1)) < 1, '広がりきっていない');
});

test('広がるとき、中のものは一緒に広がる (位置関係が変わらない)', () => {
  const { engine } = quiet();

  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'u1', level: 1 });
  const enemy = engine.spawnEnemy('normal');
  const item = engine.spawnItem('power');
  circle.position.x = 200; circle.position.y = 400;
  enemy.position.x = 600; enemy.position.y = 800;
  item.position.x = 500; item.position.y = 500;

  const { width, height } = engine.field;
  engine._resizeField(width * 2, height * 2);   // 縦も横も 2 倍にする

  assert.strictEqual(circle.position.x, 400, '円が一緒に広がっていない');
  assert.strictEqual(circle.position.y, 800);
  assert.strictEqual(enemy.position.x, 1200, '敵が一緒に広がっていない');
  assert.strictEqual(item.position.x, 1000, 'アイテムが一緒に広がっていない');
  // 半径は変わらない (だから広いほど散らばって見える)
  assert.strictEqual(circle.radius, engine.circles[0].radius);
});

test('広がっても円は場外に出ない', () => {
  const { engine, advance, config } = quiet();
  crowd(engine, 100, config.field.expand.growAt);
  advance(config.field.expand.durationMs * 2, { steps: 240 });

  engine.circles.forEach((circle) => {
    assert.ok(circle.position.x >= -1 && circle.position.x <= engine.field.width + 1 &&
              circle.position.y >= -1 && circle.position.y <= engine.field.height + 1,
    '円が場外に出た');
  });
});

test('空いてくると元の広さに戻る', () => {
  const { engine, advance, config } = quiet();
  const expand = config.field.expand;

  crowd(engine, 100, config.field.expand.growAt);
  advance(expand.durationMs + expand.cooldownMs + 500, { steps: 400 });
  assert.strictEqual(engine.stage, 1, '広がっていない');

  // ごっそり減らす
  engine.circles.length = 5;
  assert.ok(engine.coverage() < expand.shrinkAt, 'テストが空いていない');

  advance(expand.durationMs + 500, { steps: 200 });

  assert.strictEqual(engine.stage, 0, '戻っていない');
  assert.ok(Math.abs(engine.field.width - config.field.width) < 1, '元の広さに戻っていない');
});

test('広がったり戻ったりを繰り返さない (変化のあとは少し待つ)', () => {
  const { engine, advance, config } = quiet();
  const changes = [];
  engine.on('stage:change', (event) => changes.push(event.stage));

  crowd(engine, 100, config.field.expand.growAt);
  advance(config.field.expand.durationMs + 100, { steps: 130 });
  const afterFirst = changes.length;

  // 変化直後は判定しない
  advance(config.field.expand.cooldownMs - 500, { steps: 200 });
  assert.strictEqual(changes.length, afterFirst, '待たずに次の変化が起きている');
});

test('段階には上限がある', () => {
  const { engine, advance, config } = quiet();
  const expand = config.field.expand;

  for (let i = 0; i < expand.maxSteps + 3; i += 1) {
    crowd(engine, 100, expand.growAt);
    advance(expand.durationMs + expand.cooldownMs + 300, { steps: 400 });
  }

  assert.strictEqual(engine.stage, expand.maxSteps);
  assert.ok(Math.abs(engine.field.width - engine.stageWidth(expand.maxSteps)) < 1);
});

test('広がるときに知らせが出る (画面の告知用)', () => {
  const { engine, advance, config } = quiet();
  const events = [];
  engine.on('stage:change', (event) => events.push(event));

  crowd(engine, 100, config.field.expand.growAt);
  advance(200, { steps: 12 });

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].growing, true);
  assert.strictEqual(events[0].stage, 1);
  assert.strictEqual(events[0].durationMs, config.field.expand.durationMs);
  assert.ok(events[0].scale > 1);
});

test('設定で止められる', () => {
  const { engine, advance, config } = quiet({ field: { expand: { enabled: false } } });
  crowd(engine, 100, config.field.expand.growAt);
  advance(20_000, { steps: 1200 });

  assert.strictEqual(engine.stage, 0);
  assert.strictEqual(engine.field.width, config.field.width);
});
