/**
 * アイテムのテスト。
 *
 * いちばん大事なのは「拾って不利にならない」ことです。
 * どの値も下がらないことを、拾うたびに確かめています。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup, makeConfig } = require('./helpers.js');
const { levelsFromGift } = require('../js/game.js');

/** 敵も他のアイテムも邪魔しない、静かなフィールドを作る。 */
function quiet(overrides = {}) {
  return setup({
    config: Object.assign({
      enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } }
    }, overrides)
  });
}

test('一定間隔でアイテムが置かれる', () => {
  const { engine, advance, config } = quiet();
  assert.strictEqual(engine.items.length, 0, '最初から置かれている');

  advance(config.items.spawn.firstDelayMs + 100, { steps: 60 });
  assert.strictEqual(engine.items.length, 1);

  advance(config.items.spawn.intervalMs, { steps: 60 });
  assert.strictEqual(engine.items.length, 2);
});

test('同時に置く数には上限がある', () => {
  // 時間で消えないようにして、上限まで貯まったら止まることを見る
  const { engine, advance, config } = quiet({ items: { lifetimeMs: 0 } });
  advance(config.items.spawn.intervalMs * 20, { steps: 1200 });
  assert.strictEqual(engine.items.length, config.items.spawn.maxAlive);
});

test('拾われないアイテムは時間で消える', () => {
  const { engine, advance, config } = quiet({ items: { spawn: { maxAlive: 1, intervalMs: 10_000_000 } } });
  advance(config.items.spawn.firstDelayMs + 100, { steps: 60 });
  assert.strictEqual(engine.items.length, 1);

  advance(config.items.lifetimeMs, { steps: 600 });
  assert.strictEqual(engine.items.length, 0);
});

test('視聴者の円は拾える', () => {
  const { engine, advance } = quiet();
  const item = engine.spawnItem('power');
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 1 });
  circle.position.x = item.position.x;
  circle.position.y = item.position.y;

  advance(100, { steps: 3 });

  assert.strictEqual(engine.items.length, 0, '拾われていない');
  assert.strictEqual(engine.stats.itemsTaken, 1);
});

test('敵は拾えない (触れても素通りする)', () => {
  const { engine, advance } = quiet();
  const item = engine.spawnItem('power');
  const enemy = engine.spawnEnemy('normal');
  enemy.position.x = item.position.x;
  enemy.position.y = item.position.y;
  const before = { hp: enemy.hp, attack: enemy.attack, speed: enemy.speed };

  advance(1_000, { steps: 30 });

  assert.strictEqual(engine.items.length, 1, '敵がアイテムを取っている');
  assert.strictEqual(enemy.attack, before.attack, '敵が強くなっている');
  assert.strictEqual(enemy.speed, before.speed);
});

test('POWER は 100 コインギフトと同じレベルにする', () => {
  const { engine, advance, config } = quiet();
  const expected = Math.min(levelsFromGift(100, config.viewers), config.viewers.levels.max);

  const item = engine.spawnItem('power');
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 1 });
  circle.position.x = item.position.x;
  circle.position.y = item.position.y;

  advance(100, { steps: 3 });

  assert.strictEqual(circle.level, expected);

  // 100 コインのギフトで出した円と、同じ強さ・同じ攻撃力になる
  const gifted = engine.spawnCircle({ ownerId: 'u2', ownerName: 'jiro', level: expected });
  assert.strictEqual(circle.attack, gifted.attack);
  assert.strictEqual(circle.maxHp, gifted.maxHp);
});

test('SPEED は速くする (元の速さの上限まで)', () => {
  const { engine, advance, config } = quiet();
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 1 });
  const base = circle.speed;
  const cap = base * config.items.types.find((t) => t.id === 'speed').effect.maxMultiplier;

  for (let i = 0; i < 6; i += 1) {
    const item = engine.spawnItem('speed');
    circle.position.x = item.position.x;
    circle.position.y = item.position.y;
    advance(100, { steps: 3 });
  }

  assert.ok(circle.speed > base, '速くなっていない');
  assert.ok(circle.speed <= cap + 0.001, `上限 ${cap} を超えて ${circle.speed} になっている`);
  // 速さと実際の移動量が合っている
  assert.ok(Math.abs(Math.hypot(circle.velocity.x, circle.velocity.y) - circle.speed) < 0.001);
});

test('拾って弱くなる値は 1 つも無い', () => {
  const { engine, advance, config } = quiet();
  const watched = ['level', 'hp', 'maxHp', 'attack', 'radius', 'speed'];

  config.items.types.forEach((type) => {
    // 強い円 / 弱い円のどちらで拾っても下がらないこと
    [1, 20, 200].forEach((level) => {
      const circle = engine.spawnCircle({ ownerId: 'u' + level, ownerName: 'u', level: level });
      const before = {};
      watched.forEach((key) => { before[key] = circle[key]; });

      const item = engine.spawnItem(type.id);
      circle.position.x = item.position.x;
      circle.position.y = item.position.y;
      advance(100, { steps: 3 });

      watched.forEach((key) => {
        assert.ok(circle[key] >= before[key],
          `${type.id} を Lv${level} の円が拾ったら ${key} が ${before[key]} → ${circle[key]} に下がった`);
      });
    });
  });
});

test('すでに最大レベルの円が POWER を拾っても弱くならない (全快はする)', () => {
  const { engine, advance } = quiet();
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 200 });
  circle.hp = 10;
  const before = { level: circle.level, attack: circle.attack, speed: circle.speed };

  const item = engine.spawnItem('power');
  circle.position.x = item.position.x;
  circle.position.y = item.position.y;
  advance(100, { steps: 3 });

  assert.strictEqual(circle.level, before.level);
  assert.strictEqual(circle.attack, before.attack);
  assert.strictEqual(circle.speed, before.speed);
  assert.strictEqual(circle.hp, circle.maxHp, '全快していない');
});

test('拾ったことを知らせる (音と通知のため)', () => {
  const { engine, advance } = quiet();
  const taken = [];
  engine.on('item:taken', (event) => taken.push(event));

  const item = engine.spawnItem('power');
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 1 });
  circle.position.x = item.position.x;
  circle.position.y = item.position.y;
  advance(100, { steps: 3 });

  assert.strictEqual(taken.length, 1);
  assert.strictEqual(taken[0].owner.ownerName, 'taro');
  assert.strictEqual(taken[0].item.label, 'POWER');
});

test('アイテムの種類はあとから足せる', () => {
  const { engine } = quiet();
  engine.addItemType({
    id: 'mega', label: 'MEGA', color: '#fff', weight: 0,
    effect: { type: 'level', levels: 500 }
  });

  const item = engine.spawnItem('mega');
  assert.strictEqual(item.typeId, 'mega');
  assert.strictEqual(item.effect.levels, 500);
});

test('設定で止められる', () => {
  const { engine, advance } = quiet({ items: { enabled: false } });
  advance(120_000, { steps: 3600 });
  assert.strictEqual(engine.items.length, 0);
});

test('アイテムは壁際には置かない (跳ね返る円が触れられるように)', () => {
  const { engine, config } = quiet();
  for (let i = 0; i < 60; i += 1) {
    const item = engine.spawnItem();
    assert.ok(item.position.x > item.radius * 2 && item.position.x < config.field.width - item.radius * 2,
      `x=${item.position.x} が壁に寄りすぎている`);
    assert.ok(item.position.y > item.radius * 2 && item.position.y < config.field.height - item.radius * 2,
      `y=${item.position.y} が壁に寄りすぎている`);
    engine.items.length = 0;
  }
});
