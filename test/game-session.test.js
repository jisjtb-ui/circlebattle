const test = require('node:test');
const assert = require('node:assert');
const { setup, makeConfig } = require('./helpers.js');
const { statsForPoints } = require('../js/game.js');

const circlesOf = (engine, ownerId) => engine.circles.filter((c) => c.ownerId === ownerId);

// -------------------------------------------------- 行動 → ステータス
//
// レベルという 1 本の物差しはやめました。行動ごとに別の力が付きます。
// ここが崩れると「押した行動と画面で起きること」がつながらなくなります。

test('10 LIKE で HP が 1 ポイント増える', () => {
  const { engine, send, config } = setup();
  send({ type: 'like', user: { id: 'u1', uniqueId: 'taro' }, count: 10 });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1, '円は 1 つだけのはず');
  assert.strictEqual(mine[0].points.hp, 1);
  assert.strictEqual(mine[0].maxHp, config.viewers.base.hp + config.viewers.stats.hp.per);
  assert.strictEqual(mine[0].sourceEvent, 'LIKE');
});

test('LIKE を続けると同じ円が硬くなる (増えない)', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 100 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp, 10);

  send({ type: 'like', user, count: 100 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1, '円が増えている');
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp, 20);
});

test('いいねでは攻撃力は上がらない (ギフトの領分)', () => {
  const { engine, send, config } = setup();
  send({ type: 'like', user: { id: 'u1', uniqueId: 'taro' }, count: 500 });

  assert.strictEqual(circlesOf(engine, 'u1')[0].attack, config.viewers.base.attack);
});

test('ギフトで攻撃力が上がる (HP は上がらない)', () => {
  const { engine, send, config } = setup();
  const stats = config.viewers.stats;
  send({ type: 'gift', user: { id: 'u1', uniqueId: 'taro' }, diamondCount: 30 });

  const circle = circlesOf(engine, 'u1')[0];
  assert.strictEqual(circle.points.attack, 30);
  assert.strictEqual(circle.attack, config.viewers.base.attack + 30 * stats.attack.per);
  assert.strictEqual(circle.maxHp, config.viewers.base.hp, 'ギフトで HP まで上がっている');
});

test('シェアでドレインが付く', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'share', user });
  send({ type: 'share', user });

  const circle = circlesOf(engine, 'u1')[0];
  assert.strictEqual(circle.points.drain, 2);
  assert.ok(circle.drain > 0 && circle.drain < 1);
  // 1 回のときより必ず増えている (何回シェアしても効く)
  const one = statsForPoints({ drain: 1 }, config.viewers).drain;
  assert.ok(circle.drain > one, '2 回目のシェアが効いていない');
});

test('フォローでスパイクが付く (1 人 1 回だけ)', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const follow = config.viewers.gain.followPoints;

  send({ type: 'follow', user });
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.spike, follow);

  send({ type: 'follow', user });
  send({ type: 'follow', user });
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.spike, follow,
    'フォローし直すたびに増えている');
});

test('スパイクの威力は HP と本数の両方で伸びる', () => {
  const { engine, send } = setup();
  const soft = { id: 'a', uniqueId: 'a' };
  const hard = { id: 'b', uniqueId: 'b' };

  send({ type: 'follow', user: soft });
  send({ type: 'follow', user: hard });
  const softDamage = circlesOf(engine, 'a')[0].spikeDamage;

  send({ type: 'like', user: hard, count: 1000 });      // HP を積む
  assert.ok(circlesOf(engine, 'b')[0].spikeDamage > softDamage,
    '硬いのに棘が強くなっていない');

  // 本数のぶん: フォローしていない人の棘 (入室ぶんの 1 本) より強い
  send({ type: 'member', user: { id: 'c', uniqueId: 'c' } });
  assert.ok(softDamage > circlesOf(engine, 'c')[0].spikeDamage,
    'フォローしても棘が強くなっていない');
});

test('育つと大きくなる', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 10 });
  const circle = circlesOf(engine, 'u1')[0];
  const small = circle.radius;

  send({ type: 'like', user, count: 2000 });

  assert.ok(circle.maxHp > 0);
  assert.ok(circle.radius > small, '大きくなっていない');
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
  assert.strictEqual(circlesOf(engine, 'u1').length, 0, 'まだ 1 ポイントに届かない');

  send({ type: 'like', user, count: 5 });                 // 合計 12
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp, 1);

  send({ type: 'like', user, count: 8 });                 // 端数 2 + 8 = 10
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp, 2);
});

test('LIKE の端数は他人と混ざらない', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'a', uniqueId: 'a' }, count: 9 });
  send({ type: 'like', user: { id: 'b', uniqueId: 'b' }, count: 9 });

  assert.strictEqual(engine.circles.length, 0);
});

test('力に頭打ちが無い (押した / 贈ったぶんは必ず数字になる)', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const stats = config.viewers.stats;

  send({ type: 'gift', user, diamondCount: 100_000 });
  send({ type: 'like', user, count: 1_000_000 });

  const circle = circlesOf(engine, 'u1')[0];
  assert.strictEqual(circle.points.attack, 100_000);
  assert.strictEqual(circle.points.hp, 100_000);
  assert.strictEqual(circle.attack, config.viewers.base.attack + 100_000 * stats.attack.per);
  assert.strictEqual(circle.maxHp, config.viewers.base.hp + 100_000 * stats.hp.per);

  // さらに送っても、まだ増える
  const before = { hp: circle.maxHp, attack: circle.attack, radius: circle.radius };
  send({ type: 'gift', user, diamondCount: 100_000 });
  send({ type: 'like', user, count: 1_000_000 });
  assert.ok(circle.attack > before.attack, '攻撃力が止まっている');
  assert.ok(circle.maxHp > before.hp, 'HP が止まっている');
  assert.ok(circle.radius > before.radius, '大きさが止まっている');
});

test('ドレインだけは 1 を超えない (超えると誰にも倒せなくなる)', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  for (let i = 0; i < 500; i += 1) send({ type: 'share', user });

  const circle = circlesOf(engine, 'u1')[0];
  assert.strictEqual(circle.points.drain, 500, 'シェアぶんが記録されていない');
  assert.ok(circle.drain < 1, `ドレインが ${circle.drain} になっている`);
  assert.ok(circle.drain > 0.9, '500 回シェアしたのに効いていない');
});

test('入室すると少しの HP と棘 1 本をもらえる (1 人 1 回だけ)', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };
  const join = config.viewers.gain.joinPoints;

  send({ type: 'member', user });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp, join.hp);
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.spike, join.spike);
  assert.strictEqual(circlesOf(engine, 'u1')[0].sourceEvent, 'JOIN');

  send({ type: 'member', user });
  send({ type: 'member', user });
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp, join.hp,
    '入り直すたびにもらえてしまう');
});

test('入室でもらった円も LIKE で育つ', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'member', user });
  send({ type: 'like', user, count: 50 });                            // +5 ポイント

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].points.hp, config.viewers.gain.joinPoints.hp + 5);
});

// ------------------------------------------------------ 倒れたあと

test('倒された円は消え、次の行動でまた撃ち出される', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 100 });
  const first = circlesOf(engine, 'u1')[0];
  assert.strictEqual(first.points.hp, 10);

  engine._damageCircle(first, first.maxHp * 10);   // 軽減があっても確実に倒す
  engine._cleanup();
  assert.strictEqual(circlesOf(engine, 'u1').length, 0, '倒れても消えていない');

  send({ type: 'like', user, count: 30 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1, '作り直されていない');
});

test('倒されても貯めた力は失わない', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 200 });        // HP 20
  send({ type: 'gift', user, diamondCount: 40 });  // ATK 40
  send({ type: 'follow', user });                  // 棘
  const before = { ...circlesOf(engine, 'u1')[0].points };

  const circle = circlesOf(engine, 'u1')[0];
  engine._damageCircle(circle, circle.maxHp * 10);
  engine._cleanup();

  send({ type: 'like', user, count: 10 });         // 1 回の行動で復帰
  const back = circlesOf(engine, 'u1')[0];
  assert.strictEqual(back.points.attack, before.attack, '攻撃力が失われている');
  assert.strictEqual(back.points.spike, before.spike, '棘が失われている');
  assert.strictEqual(back.points.hp, before.hp + 1, 'いいねのぶんが乗っていない');
});

test('倒されたままでは戻らない (行動が要る)', () => {
  const { engine, send, advance } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 100 });
  const circle = circlesOf(engine, 'u1')[0];
  engine._damageCircle(circle, circle.maxHp * 10);
  engine._cleanup();

  advance(10_000, { steps: 50 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 0, '何もしていないのに戻っている');
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

  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', points: { attack: 40 } });
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
  const circle = engine.spawnCircle({ ownerId: 'u1', ownerName: 'taro', points: { attack: 10 } });
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


// ------------------------------------------------------ 1 人 1 つ

test('100 人が LIKE を送っても、円は 1 人 1 つずつ', () => {
  const { engine, send } = setup();

  for (let i = 0; i < 100; i += 1) {
    const user = { id: 'u' + i, uniqueId: 'v' + i };
    send({ type: 'like', user, count: 200 });
    send({ type: 'gift', user, diamondCount: 50 });
    send({ type: 'follow', user });
  }

  assert.strictEqual(engine.circles.length, 100, '1 人 1 つになっていない');
  for (let i = 0; i < 100; i += 1) {
    assert.strictEqual(circlesOf(engine, 'u' + i).length, 1);
  }
});

test('何度行動しても円は増えず、同じ円に乗る', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  for (let i = 0; i < 30; i += 1) send({ type: 'gift', user, diamondCount: 3 });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1, `${mine.length} 個に増えている`);
  assert.strictEqual(mine[0].points.attack, 90);
});

test('ランキングに貯めた力が残る', () => {
  const { send, leaderboard } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 100 });        // HP 10
  send({ type: 'gift', user, diamondCount: 20 });  // ATK 20

  const record = leaderboard.get('u1');
  assert.strictEqual(record.power, 30);
  assert.strictEqual(record.maxPower, 30);
});

test('力が増えたことが通知される (音と表示のため)', () => {
  const { session, send } = setup();
  const grew = [];
  session.on('grew', (event) => grew.push(event));
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'like', user, count: 10 });         // 1 つ目の円ができる (spawn)
  send({ type: 'like', user, count: 30 });         // ここから 'grew'
  send({ type: 'gift', user, diamondCount: 5 });

  assert.strictEqual(grew.length, 2);
  assert.strictEqual(grew[0].gained.hp, 3);
  assert.strictEqual(grew[0].sourceEvent, 'LIKE');
  assert.strictEqual(grew[1].gained.attack, 5);
  assert.strictEqual(grew[1].sourceEvent, 'GIFT');
});

test('とんでもない量を送っても、円は増えないし壊れない', () => {
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  for (let i = 0; i < 20; i += 1) send({ type: 'gift', user, diamondCount: 1_000_000 });

  const mine = circlesOf(engine, 'u1');
  assert.strictEqual(mine.length, 1, '円が増えている');
  assert.ok(Number.isFinite(mine[0].attack) && Number.isFinite(mine[0].radius));
  assert.ok(mine[0].radius > 0);
});

test('他の人の円は自分の円に影響しない', () => {
  const { engine, send } = setup();
  send({ type: 'like', user: { id: 'a', uniqueId: 'a' }, count: 100 });
  const before = circlesOf(engine, 'a')[0].points.hp;

  for (let i = 0; i < 20; i += 1) {
    send({ type: 'like', user: { id: 'b', uniqueId: 'b' }, count: 100 });
  }

  assert.strictEqual(circlesOf(engine, 'a').length, 1);
  assert.strictEqual(circlesOf(engine, 'a')[0].points.hp, before);
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

test('入室で出た円は JOIN のまま撃ち出される', () => {
  // 画面はこの sourceEvent を見て光らせるので、途中で消えると
  // 「入ってきた人の円がどれか」が分からなくなります。
  const { engine, send } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'member', user });
  assert.strictEqual(circlesOf(engine, 'u1')[0].sourceEvent, 'JOIN');
});

test('倒れたあと入室し直しても、力は 1 人 1 つのまま', () => {
  const { engine, send, config } = setup();
  const user = { id: 'u1', uniqueId: 'taro' };

  send({ type: 'member', user });
  const circle = circlesOf(engine, 'u1')[0];
  engine._damageCircle(circle, circle.maxHp * 10);
  engine._cleanup();

  send({ type: 'member', user });                    // 2 回目の入室は効かない
  assert.strictEqual(circlesOf(engine, 'u1').length, 0, '入り直しで戻ってきている');

  send({ type: 'like', user, count: 10 });
  assert.strictEqual(circlesOf(engine, 'u1').length, 1);
  assert.strictEqual(circlesOf(engine, 'u1')[0].points.hp,
    config.viewers.gain.joinPoints.hp + 1);
});

test('入室のハイライトは設定で消せる', () => {
  const config = makeConfig({ ui: { join: { highlightMs: 0 } } });
  assert.strictEqual(config.ui.join.highlightMs, 0);

  // 色と文字はいつでも変えられる
  const custom = makeConfig({ ui: { join: { color: '#ff0000', label: 'NEW' } } });
  assert.strictEqual(custom.ui.join.color, '#ff0000');
  assert.strictEqual(custom.ui.join.label, 'NEW');
});
