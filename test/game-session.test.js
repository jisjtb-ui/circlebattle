const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers.js');

const circlesOf = (engine, ownerId) => engine.circles.filter((c) => c.ownerId === ownerId);

test('10 LIKE で弱い円が 1 個', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'u1', uniqueId: 'taro' }, count: 10 });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].sourceEvent, 'LIKE');
  assert.strictEqual(mine[0].strength, 1);
});

test('20 LIKE で 2 個、100 LIKE で 10 個', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'a', uniqueId: 'a' }, count: 20 });
  send({ type: 'like', user: { id: 'b', uniqueId: 'b' }, count: 100 });

  assert.strictEqual(circlesOf(engine, 'a').length, 2);
  assert.strictEqual(circlesOf(engine, 'b').length, 10);
});

test('LIKE の端数はユーザーごとに次へ繰り越す', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 7 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 0);

  send({ type: 'like', user, count: 5 });                 // 合計 12
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);

  send({ type: 'like', user, count: 8 });                 // 端数 2 + 8 = 10
  assert.strictEqual(circlesOf(engine, 'u1').length, 2);
});

test('LIKE の端数は他人と混ざらない', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'a', uniqueId: 'a' }, count: 9 });
  send({ type: 'like', user: { id: 'b', uniqueId: 'b' }, count: 9 });

  assert.strictEqual(engine.circles.length, 0);
});

test('FOLLOW と SHARE で中程度の円が 1 個ずつ', () => {
  const { engine, send, config } = setup();
  send({ type: 'follow', user: { id: 'u1', uniqueId: 'taro' } });
  send({ type: 'share', user: { id: 'u1', uniqueId: 'taro' } });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 2);
  assert.deepStrictEqual(mine.map((c) => c.sourceEvent), ['FOLLOW', 'SHARE']);
  assert.strictEqual(mine[0].strength, config.viewers.follow.strength);
  assert.ok(mine[0].hp > 40, 'LIKE の円より強くない');
});

test('GIFT はコイン価値ぶん強い円になる', () => {
  const { engine, send, config } = setup();
  const gift = config.viewers.gift;

  send({ type: 'gift', user: { id: 'a', uniqueId: 'a' }, diamondCount: 1, repeatCount: 1 });
  send({ type: 'gift', user: { id: 'b', uniqueId: 'b' }, diamondCount: 100, repeatCount: 1 });

  const small = circlesOf(engine, 'a')[0];
  const big = circlesOf(engine, 'b')[0];

  assert.strictEqual(small.strength, gift.baseStrength + 1 * gift.strengthPerCoin);
  assert.strictEqual(big.strength, gift.baseStrength + 100 * gift.strengthPerCoin);
  assert.ok(big.hp > small.hp * 5, 'ギフトの価値が強さに反映されていない');
  assert.strictEqual(big.sourceEvent, 'GIFT');
});

test('高額ギフトでも上限を超えない', () => {
  const { engine, send, config } = setup();
  send({ type: 'gift', user: { id: 'a', uniqueId: 'a' }, diamondCount: 100_000, repeatCount: 10 });

  const circle = circlesOf(engine, 'a')[0];
  assert.strictEqual(circle.strength, config.viewers.scaling.maxStrength);
  assert.ok(circle.radius <= config.viewers.scaling.maxRadius);
});

test('コメントでは円が出ない (チーム分けもしない)', () => {
  const { engine, session, send } = setup();
  const comments = [];
  session.on('comment', (c) => comments.push(c));

  send({ type: 'chat', user: { id: 'u1', uniqueId: 'taro' }, comment: 'kawaii' });

  assert.strictEqual(engine.circles.length, 0);
  assert.strictEqual(comments.length, 1, 'コメントがイベントとして届いていない');
  assert.strictEqual(comments[0].text, 'kawaii');
});

test('LAST HIT: とどめを刺した人が撃破ポイントを取る', () => {
  const { engine, session, leaderboard } = setup();

  session._award({
    points: 20,
    lastHit: { ownerId: 'u2', ownerName: 'jiro', damage: 10 },
    contributions: [
      { ownerId: 'u1', ownerName: 'taro', damage: 990 },
      { ownerId: 'u2', ownerName: 'jiro', damage: 10 }
    ],
    at: 1000
  });

  assert.strictEqual(leaderboard.get('u2').score, 20);
  assert.strictEqual(leaderboard.get('u2').kills, 1);
  assert.strictEqual(leaderboard.get('u1'), null);
});

test('ダメージ配分: 貢献度に応じてポイントを分ける', () => {
  const { session, leaderboard } = setup({ config: { scoring: { mode: 'damage' } } });

  session._award({
    points: 100,
    lastHit: { ownerId: 'u2', ownerName: 'jiro', damage: 25 },
    contributions: [
      { ownerId: 'u1', ownerName: 'taro', damage: 75 },
      { ownerId: 'u2', ownerName: 'jiro', damage: 25 }
    ],
    at: 1000
  });

  assert.strictEqual(leaderboard.get('u1').score, 75);
  assert.strictEqual(leaderboard.get('u2').score, 25);
  assert.strictEqual(leaderboard.get('u1').kills, 0, 'KILL は 1 人だけに付く');
  assert.strictEqual(leaderboard.get('u2').kills, 1);
});

test('ダメージ配分: KILL を最大貢献者に付けることもできる', () => {
  const { session, leaderboard } = setup({
    config: { scoring: { mode: 'damage', killCredit: 'topDamage' } }
  });

  session._award({
    points: 100,
    lastHit: { ownerId: 'u2', ownerName: 'jiro', damage: 25 },
    contributions: [
      { ownerId: 'u1', ownerName: 'taro', damage: 75 },
      { ownerId: 'u2', ownerName: 'jiro', damage: 25 }
    ],
    at: 1000
  });

  assert.strictEqual(leaderboard.get('u1').kills, 1);
  assert.strictEqual(leaderboard.get('u2').kills, 0);
});

test('倒すとランキングが自動で更新される', () => {
  const { engine, leaderboard, advance } = setup();
  engine.enemies.length = 0;
  engine.circles.length = 0;

  const enemy = engine.spawnEnemy('normal');
  enemy.position.x = 500;
  enemy.position.y = 500;

  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', strength: 20 });
  circle.position.x = 500;
  circle.position.y = 500;

  advance(5_000, { steps: 150 });

  const record = leaderboard.get('u1');
  assert.ok(record.kills >= 1, '撃破が記録されていない');
  assert.ok(record.score >= 1, 'ポイントが入っていない');
  assert.ok(record.damage > 0, 'ダメージが記録されていない');
  assert.strictEqual(leaderboard.top()[0].userName, 'taro');
});

test('ダメージにもスコアを付けられる (設定)', () => {
  const { engine, leaderboard, advance } = setup({ config: { scoring: { pointsPerDamage: 0.5 } } });
  engine.enemies.length = 0;

  const enemy = engine.spawnEnemy('boss');
  enemy.position.x = 500;
  enemy.position.y = 500;
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', strength: 5 });
  circle.position.x = 500;
  circle.position.y = 500;

  advance(2_000, { steps: 60 });

  const record = leaderboard.get('u1');
  assert.ok(record.damage > 0);
  assert.ok(Math.abs(record.score - record.damage * 0.5) < 0.001, 'ダメージぶんのスコアが合わない');
});

test('プロフィール画像がランキングまで届く', () => {
  const { send, leaderboard } = setup();
  send({
    type: 'follow',
    user: { id: 'u1', uniqueId: 'taro', avatarThumb: { urlList: ['https://x/100x100/a.webp'] } }
  });

  assert.strictEqual(leaderboard.get('u1').profileImageUrl, 'https://x/100x100/a.webp');
});
