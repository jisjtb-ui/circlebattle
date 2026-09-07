const test = require('node:test');
const assert = require('node:assert');
const { setup, makeConfig } = require('./helpers.js');

const circlesOf = (engine, ownerId) => engine.circles.filter((c) => c.ownerId === ownerId);

test('10 LIKE で 1 レベル', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'u1', uniqueId: 'taro' }, count: 10 });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1, '円は 1 つだけのはず');
  assert.strictEqual(mine[0].level, 1);
  assert.strictEqual(mine[0].sourceEvent, 'LIKE');
});

test('LIKE を続けると同じ円が育つ (増えない)', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 100 });        // 10 レベル
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, 10);

  send({ type: 'like', user, count: 100 });        // さらに 10 レベル
  assert.strictEqual(circlesOf(engine, 'u1').length, 1, '円が増えている');
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, 20);
});

test('育つと強く・大きくなる', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 10 });
  const circle = circlesOf(engine, 'u1')[0];
  const low = { hp: circle.maxHp, attack: circle.attack, radius: circle.radius };

  send({ type: 'like', user, count: 500 });        // +50 レベル

  assert.ok(circle.maxHp > low.hp, 'HP が増えていない');
  assert.ok(circle.attack > low.attack, '攻撃力が上がっていない');
  assert.ok(circle.radius > low.radius, '大きくなっていない');
});

test('育てても HP の残りは減らない (増えたぶんは回復する)', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 10 });
  const circle = circlesOf(engine, 'u1')[0];
  circle.hp = Math.round(circle.maxHp / 2);
  const before = circle.hp;

  send({ type: 'like', user, count: 200 });

  assert.ok(circle.hp > before, '育てたのに HP が増えていない');
  assert.ok(circle.hp <= circle.maxHp);
});

test('LIKE の端数はユーザーごとに次へ繰り越す', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 7 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 0, 'まだレベル 1 に届かない');

  send({ type: 'like', user, count: 5 });                 // 合計 12
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, 1);

  send({ type: 'like', user, count: 8 });                 // 端数 2 + 8 = 10
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, 2);
});

test('LIKE の端数は他人と混ざらない', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'a', uniqueId: 'a' }, count: 9 });
  send({ type: 'like', user: { id: 'b', uniqueId: 'b' }, count: 9 });

  assert.strictEqual(engine.circles.length, 0);
});

test('FOLLOW と SHARE でもレベルが上がる', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const levels = config.viewers.levels;

  send({ type: 'follow', user });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, levels.follow);

  send({ type: 'share', user });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1, '円が増えている');
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, levels.follow + levels.share);
});

test('GIFT はコイン価値ぶんレベルが上がる', () => {
  const { engine, send, config } = setup();
  const perCoin = config.viewers.levels.giftLevelsPerCoin;

  send({ type: 'gift', user: { id: 'a', uniqueId: 'a' }, diamondCount: 5, repeatCount: 1 });
  send({ type: 'gift', user: { id: 'b', uniqueId: 'b' }, diamondCount: 30, repeatCount: 1 });

  assert.strictEqual(circlesOf(engine, 'a')[0].level, 5 * perCoin);
  assert.strictEqual(circlesOf(engine, 'b')[0].level, 30 * perCoin);
});

test('高額ギフトでも上限レベルを超えない', () => {
  const { engine, send, config } = setup();
  send({ type: 'gift', user: { id: 'a', uniqueId: 'a' }, diamondCount: 100_000, repeatCount: 10 });

  const circle = circlesOf(engine, 'a')[0];
  assert.strictEqual(circle.level, config.viewers.levels.max);
  assert.ok(circle.radius <= config.viewers.scaling.maxRadius);
});

test('最大レベルに達した円はそのまま残り、次の行動で新しい円ができる', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const max = config.viewers.levels.max;

  send({ type: 'gift', user, diamondCount: 1000, repeatCount: 1 });   // 一気に最大まで
  const maxed = circlesOf(engine, 'u1')[0];
  assert.strictEqual(maxed.level, max);

  send({ type: 'like', user, count: 10 });                            // 次の行動

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 2, '新しい円ができていない');
  assert.strictEqual(mine[0].id, maxed.id, '最大レベルの円が消えている');
  assert.strictEqual(mine[0].level, max, '最大レベルの円が変わっている');
  assert.strictEqual(mine[1].level, 1, '新しい円がレベル 1 で始まっていない');

  send({ type: 'like', user, count: 30 });                            // 新しい円が育つ
  assert.strictEqual(circlesOf(engine, 'u1').length, 2);
  assert.strictEqual(circlesOf(engine, 'u1')[1].level, 4);
});

test('最大レベルのあとのギフトは、その価値ぶんのレベルで始まる', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'gift', user, diamondCount: 1000, repeatCount: 1 });   // 最大まで
  send({ type: 'gift', user, diamondCount: 40, repeatCount: 1 });     // 次の行動

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 2);
  assert.strictEqual(mine[0].level, config.viewers.levels.max);
  assert.strictEqual(mine[1].level, 40);
});

test('入室すると 20 レベルの円をもらえる (1 人 1 回だけ)', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'member', user });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, config.viewers.levels.join);
  assert.strictEqual(circlesOf(engine, 'u1')[0].sourceEvent, 'JOIN');

  send({ type: 'member', user });
  send({ type: 'member', user });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1, '入り直すたびにもらえてしまう');
});

test('入室でもらった円も LIKE で育つ', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'member', user });
  send({ type: 'like', user, count: 50 });                            // +5 レベル

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].level, config.viewers.levels.join + 5);
});

test('円が力尽きたら、次の行動で新しい円ができる', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 100 });
  const first = circlesOf(engine, 'u1')[0];
  assert.strictEqual(first.level, 10);

  // 力尽きさせる
  engine._damageCircle(first, first.maxHp * 10);   // 軽減があっても確実に倒す
  engine._cleanup();
  assert.strictEqual(circlesOf(engine, 'u1').length, 0);

  send({ type: 'like', user, count: 30 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1, '作り直されていない');
  assert.strictEqual(circlesOf(engine, 'u1')[0].level, 3);
});

test('他の人の行動で自分の円は変わらない', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'a', uniqueId: 'a' }, count: 100 });
  const before = circlesOf(engine, 'a')[0].level;

  for (let i = 0; i < 20; i += 1) {
    send({ type: 'like', user: { id: 'b', uniqueId: 'b' }, count: 100 });
  }

  assert.strictEqual(circlesOf(engine, 'a').length, 1);
  assert.strictEqual(circlesOf(engine, 'a')[0].level, before);
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

  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 20 });
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
  // 他の敵を倒して撃破ポイントが混ざらないよう、補充を止めて 1 体だけにする
  const { engine, leaderboard, advance } = setup({
    config: {
      scoring: { pointsPerDamage: 0.5 },
      enemies: { spawn: { initialCount: 0, minAlive: 0, maxAlive: 0, intervalMs: 10_000_000 } }
    }
  });
  engine.enemies.length = 0;

  const enemy = engine.spawnEnemy('boss');
  enemy.position.x = 500;
  enemy.position.y = 500;
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', level: 5 });
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


test('レベルは 1 から 100 まで (10 LIKE = 1 レベル)', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const max = config.viewers.levels.max;

  // 10 LIKE を 100 回 = ちょうど最大レベル
  for (let i = 0; i < max; i += 1) send({ type: 'like', user, count: 10 });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1, `${mine.length} 個に増えている`);
  assert.strictEqual(mine[0].level, max);
});

test('レベルは飛ばさずに上がる (1 レベルずつ確認)', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  for (let expected = 1; expected <= 20; expected += 1) {
    send({ type: 'like', user, count: 10 });
    assert.strictEqual(circlesOf(engine, 'u1')[0].level, expected);
  }
});

test('ランキングにレベルが残る', () => {
  const { send, leaderboard, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 250 });                 // 25 レベル
  assert.strictEqual(leaderboard.get('u1').level, 25);
  assert.strictEqual(leaderboard.get('u1').maxLevel, 25);

  send({ type: 'gift', user, diamondCount: 1000 });          // 最大まで
  send({ type: 'like', user, count: 10 });                   // 新しい円 (レベル 1)

  assert.strictEqual(leaderboard.get('u1').level, 1, 'いまのレベルが追えていない');
  assert.strictEqual(leaderboard.get('u1').maxLevel, config.viewers.levels.max,
    '最大まで育てた記録が消えている');
});

test('レベルアップが通知される (音と表示のため)', () => {
  const { session, send } = setup();
  const ups = [];
  const spawns = [];
  session.on('levelup', (up) => ups.push(up));
  session.on('spawn', (spawn) => spawns.push(spawn));

  const user = { id: 'u1', uniqueId: 'taro' };
  send({ type: 'like', user, count: 10 });                   // 生まれる
  send({ type: 'like', user, count: 30 });                   // 育つ

  assert.strictEqual(spawns.length, 1);
  assert.strictEqual(spawns[0].level, 1);
  assert.strictEqual(ups.length, 1);
  assert.strictEqual(ups[0].from, 1);
  assert.strictEqual(ups[0].to, 4);
  assert.strictEqual(ups[0].sourceEvent, 'LIKE');
});

test('100 人が LIKE を送っても、円は 1 人 1 つずつ', () => {
  const harness = setup();
  for (let i = 1; i <= 100; i += 1) {
    for (let n = 0; n < 5; n += 1) {
      harness.send({ type: 'like', user: { id: 'u' + i, uniqueId: 'v' + i }, count: 30 });
    }
  }

  const perUser = {};
  harness.engine.circles.forEach((c) => { perUser[c.ownerId] = (perUser[c.ownerId] || 0) + 1; });

  assert.strictEqual(harness.engine.circles.length, 100, '円が 100 個より多い / 少ない');
  assert.ok(Object.values(perUser).every((n) => n === 1), '1 人で複数の円を持っている');
  assert.strictEqual(harness.engine.circles[0].level, 15);
});

test('上限まで埋まったら、次の円は順番待ちになる (押し出さない)', () => {
  const { engine, session, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const cap = config.viewers.limits.maxPerUser;

  // 高額ギフトを連投して、最大レベルの円で埋める
  for (let i = 0; i < cap; i += 1) send({ type: 'gift', user, diamondCount: 100 });
  assert.strictEqual(circlesOf(engine, 'u1').length, cap);

  const ids = circlesOf(engine, 'u1').map((c) => c.id);
  send({ type: 'gift', user, diamondCount: 100 });

  assert.strictEqual(circlesOf(engine, 'u1').length, cap, '上限を超えて出ている');
  assert.deepStrictEqual(circlesOf(engine, 'u1').map((c) => c.id), ids,
    '育っていた円が押し出された');
  assert.strictEqual(session._player('u1').queue.length, 1, '順番待ちに積まれていない');
});

test('円が減ったら、順番待ちから次が出てくる', () => {
  const { engine, session, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const cap = config.viewers.limits.maxPerUser;

  for (let i = 0; i < cap; i += 1) send({ type: 'gift', user, diamondCount: 100 });
  send({ type: 'gift', user, diamondCount: 30 });        // 6 個目 = 順番待ち (Lv30)
  assert.strictEqual(session._player('u1').queue.length, 1);

  // 1 つ倒れる
  const victim = circlesOf(engine, 'u1')[0];
  engine._damageCircle(victim, victim.maxHp * 10);  // 軽減があっても確実に倒す
  engine._cleanup();

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, cap, '補充されていない');
  assert.strictEqual(mine[mine.length - 1].level, 30, '順番待ちの円が出ていない');
  assert.strictEqual(session._player('u1').queue.length, 0, '列から減っていない');
});

test('最大レベルの円が燃え尽きても、順番待ちから次が出る', () => {
  const { engine, session, send, advance, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const cap = config.viewers.limits.maxPerUser;

  for (let i = 0; i < cap; i += 1) send({ type: 'gift', user, diamondCount: 100 });
  send({ type: 'like', user, count: 100 });              // 順番待ち (Lv10)

  advance(config.viewers.levels.maxDurationMs + 500, { steps: 300 });

  assert.strictEqual(session._player('u1').queue.length, 0, '順番待ちが残ったまま');
  const mine = circlesOf(engine, 'u1');
  assert.ok(mine.length >= 1, '燃え尽きたあと 1 つも出ていない');
  assert.ok(mine.some((c) => c.level === 10), '待っていた円が出ていない');
});

test('順番待ちの列も埋まったら、最後の円が強くなる (消えない)', () => {
  const { session, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const cap = config.viewers.limits.maxPerUser;
  const queue = config.viewers.limits.queue;

  for (let i = 0; i < cap; i += 1) send({ type: 'gift', user, diamondCount: 100 });
  for (let i = 0; i < queue; i += 1) send({ type: 'gift', user, diamondCount: 10 });

  const list = session._player('u1').queue;
  assert.strictEqual(list.length, queue, '列が想定より長い / 短い');
  const lastBefore = list[list.length - 1].level;

  send({ type: 'gift', user, diamondCount: 20 });        // あふれたぶん

  assert.strictEqual(session._player('u1').queue.length, queue, '列が伸びている');
  assert.strictEqual(session._player('u1').queue[queue - 1].level, lastBefore + 20,
    'あふれたぶんが消えている');
});

test('順番待ちの数がランキングに出る', () => {
  const { send, leaderboard, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const cap = config.viewers.limits.maxPerUser;

  for (let i = 0; i < cap; i += 1) send({ type: 'gift', user, diamondCount: 100 });
  assert.strictEqual(leaderboard.get('u1').queued, 0);

  send({ type: 'gift', user, diamondCount: 50 });
  send({ type: 'gift', user, diamondCount: 50 });
  assert.strictEqual(leaderboard.get('u1').queued, 2);
});

test('他の人の円は順番待ちに影響しない', () => {
  const { engine, session, send, config } = setup();
  const cap = config.viewers.limits.maxPerUser;
  const a = { id: 'a', uniqueId: 'a' };
  const b = { id: 'b', uniqueId: 'b' };

  for (let i = 0; i < cap + 2; i += 1) send({ type: 'gift', user: a, diamondCount: 100 });
  send({ type: 'gift', user: b, diamondCount: 100 });

  assert.strictEqual(circlesOf(engine, 'a').length, cap);
  assert.strictEqual(session._player('a').queue.length, 2);
  assert.strictEqual(circlesOf(engine, 'b').length, 1, '他人が埋まっていると出られない');
  assert.strictEqual(session._player('b').queue.length, 0);
});

// --------------------------------------------------------------- コンボ

/** 敵を 1 体、指定の人に倒させる。 */
function killOne(s, user = { id: 'u1', uniqueId: 'yui' }) {
  const enemy = s.engine.spawnEnemy('normal');
  s.session._award({
    enemy,
    typeId: enemy.typeId,
    points: 100,
    at: s.now(),
    lastHit: { ownerId: user.id, ownerName: user.uniqueId, damage: enemy.maxHp },
    contributions: [{ ownerId: user.id, ownerName: user.uniqueId, damage: enemy.maxHp }]
  });
  return s.kills[s.kills.length - 1];
}

test('続けて倒すとコンボが伸びる', () => {
  const s = setup({ config: { combo: { enabled: true, windowMs: 4000 } } });

  assert.strictEqual(killOne(s).combo, 1);
  s.advance(500);
  assert.strictEqual(killOne(s).combo, 2);
  s.advance(500);
  assert.strictEqual(killOne(s).combo, 3);
});

test('間が空くとコンボは 1 に戻る', () => {
  const s = setup({ config: { combo: { enabled: true, windowMs: 4000 } } });

  killOne(s);
  s.advance(500);
  assert.strictEqual(killOne(s).combo, 2);

  s.advance(5000);
  assert.strictEqual(killOne(s).combo, 1, '時間が空いたのに続いている');
});

test('コンボは人ごとに数える', () => {
  const s = setup({ config: { combo: { enabled: true, windowMs: 4000 } } });
  const a = { id: 'u1', uniqueId: 'yui' };
  const b = { id: 'u2', uniqueId: 'ren' };

  killOne(s, a);
  s.advance(100);
  assert.strictEqual(killOne(s, b).combo, 1, '他人の撃破で伸びている');
  s.advance(100);
  assert.strictEqual(killOne(s, a).combo, 2);
});

test('コンボの倍率には上限がある (一気の逆転を作らない)', () => {
  const s = setup({
    config: { combo: { enabled: true, windowMs: 4000, bonusPerHit: 0.1, maxBonus: 1 } }
  });

  let last = null;
  for (let i = 0; i < 40; i += 1) {
    last = killOne(s);
    s.advance(50);
  }

  assert.ok(last.combo > 20, 'コンボが伸びていない');
  assert.strictEqual(last.points, 200, '上限 (2 倍) を超えている');
});

test('コンボを切ると倍率は掛からない', () => {
  const s = setup({ config: { combo: { enabled: false } } });

  killOne(s);
  s.advance(100);
  const kill = killOne(s);

  assert.strictEqual(kill.combo, 1);
  assert.strictEqual(kill.points, 100);
});

// ------------------------------------------------------- 入室のハイライト

test('入室で生まれた円は、順番待ちから出てきても JOIN のまま', () => {
  // 画面はこの sourceEvent を見て光らせるので、途中で消えると
  // 「入ってきた人の円がどれか」が分からなくなります。
  const { engine, session, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const cap = config.viewers.limits.maxPerUser;

  for (let i = 0; i < cap; i += 1) send({ type: 'gift', user, diamondCount: 100 });
  send({ type: 'member', user });                    // 満員なので順番待ちへ
  assert.strictEqual(session._player('u1').queue.length, 1);

  const victim = circlesOf(engine, 'u1')[0];
  engine._damageCircle(victim, victim.maxHp * 10);
  engine._cleanup();

  const released = circlesOf(engine, 'u1').pop();
  assert.strictEqual(released.sourceEvent, 'JOIN', '順番待ちを通ると JOIN が消えている');
  assert.strictEqual(released.level, config.viewers.levels.join);
});

test('入室のハイライトは設定で消せる', () => {
  const config = makeConfig({ ui: { join: { highlightMs: 0 } } });
  assert.strictEqual(config.ui.join.highlightMs, 0);

  // 色と文字はいつでも変えられる
  const custom = makeConfig({ ui: { join: { color: '#ff0000', label: 'NEW' } } });
  assert.strictEqual(custom.ui.join.color, '#ff0000');
  assert.strictEqual(custom.ui.join.label, 'NEW');
});
