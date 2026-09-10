/**
 * PLAYER CANNON のテスト。
 *
 * 一番大事なのは「**円はすべて大砲から出る**」ことと、
 * 「**演出が詰まってもゲームが止まらない**」ことです。
 */
const test = require('node:test');
const assert = require('node:assert');
const { Cannon } = require('../js/cannon.js');
const { setup, makeConfig } = require('./helpers.js');

/** 大砲を繋いだ場を作る。時計はテストが進めます。 */
function arena(overrides = {}) {
  const s = setup({ config: { demo: { enabled: false }, ...overrides } });
  const cannon = new Cannon({
    config: s.config, engine: s.engine, session: s.session,
    now: s.now, random: () => 0.5
  });
  s.session.launcher = cannon;

  const fired = [];
  cannon.on('fire', (event) => fired.push(event));
  return { ...s, cannon, fired };
}

/** 大砲が空になるまで進める。 */
function drain(a, ms = 6000) {
  for (let t = 0; t < ms; t += 20) {
    a.advance(20);
    a.cannon.update(a.now());
  }
}

// ------------------------------------------------- すべて大砲から出ること

test('LIKE で生まれる円も大砲から出る', () => {
  const a = arena();
  a.send({ type: 'like', count: 100, user: { id: 'u1', uniqueId: 'yui' } });

  assert.strictEqual(a.engine.circles.length, 0, 'いきなり盤面に出ている');
  assert.strictEqual(a.cannon.queue.length + (a.cannon.shot ? 1 : 0), 1);

  drain(a);
  assert.strictEqual(a.engine.circles.length, 1, '撃たれていない');
});

test('どのイベントでも砲口から出て、中央を向いている', () => {
  for (const raw of [
    { type: 'like', count: 100 },
    { type: 'follow' },
    { type: 'share' },
    { type: 'gift', diamondCount: 30 },
    { type: 'member' }
  ]) {
    const a = arena();
    // 撃たれた**その瞬間**の場所と向きを見ます (あとで見ると飛んだあとです)
    const born = [];
    a.engine.on('circle:spawn', (circle) => born.push({
      x: circle.position.x, y: circle.position.y,
      heading: Math.atan2(circle.velocity.y, circle.velocity.x)
    }));

    a.send({ ...raw, user: { id: 'u1', uniqueId: 'yui' } });
    drain(a);

    assert.strictEqual(born.length, 1, `${raw.type} で円が出ていない`);
    const muzzle = a.cannon.muzzle(a.config.cannon.loadScale);
    const gap = Math.hypot(born[0].x - muzzle.x, born[0].y - muzzle.y);
    assert.ok(gap < 1, `${raw.type}: 砲口から出ていない (${gap.toFixed(1)} 離れている)`);

    const off = Math.abs(born[0].heading - a.cannon.aim());
    assert.ok(off <= a.config.cannon.spreadRad + 0.001,
      `${raw.type}: 中央と違う向き (${off.toFixed(2)} ラジアン)`);
  }
});

test('発射の向きは中央寄り (完全なランダムではない)', () => {
  const a = arena();
  const aim = a.cannon.aim();
  const spread = a.config.cannon.spreadRad;
  const headings = [];
  a.engine.on('circle:spawn', (c) => headings.push(Math.atan2(c.velocity.y, c.velocity.x)));

  for (let i = 1; i <= 8; i += 1) {
    a.send({ type: 'member', user: { id: 'u' + i, uniqueId: 'v' + i } });
  }
  drain(a);

  assert.strictEqual(a.fired.length, 8);
  assert.strictEqual(headings.length, 8);
  for (const heading of headings) {
    assert.ok(Math.abs(heading - aim) <= spread + 0.001,
      `中央から ${Math.abs(heading - aim).toFixed(2)} ラジアンずれている`);
  }
});

// --------------------------------------------------------- 飛んでいる間

test('飛んでいる間は戦わず、ぶつからない', () => {
  const a = arena({ enemies: { spawn: { intervalMs: 999999, initialCount: 0, minAlive: 0 } } });
  a.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });
  // 撃たれるまで進めて、そこで止めます (飛んでいる最中を見たいため)
  while (!a.engine.circles.length) { a.advance(20); a.cannon.update(a.now()); }

  const circle = a.engine.circles[0];
  assert.ok(circle.launchUntil != null, 'まだ飛んでいるはず');

  // 砲口のすぐ先に敵を置いても、飛んでいる間は削られない
  const enemy = a.engine.spawnEnemy('boss');
  enemy.position.x = circle.position.x;
  enemy.position.y = circle.position.y;
  enemy.velocity.x = 0;
  enemy.velocity.y = 0;
  const hp = enemy.hp;

  a.advance(100, { steps: 6 });
  assert.strictEqual(enemy.hp, hp, '飛んでいる間に殴っている');
});

test('飛び終わると普通の円に戻る', () => {
  const a = arena();
  a.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });
  while (!a.engine.circles.length) { a.advance(20); a.cannon.update(a.now()); }

  const circle = a.engine.circles[0];
  const boosted = Math.hypot(circle.velocity.x, circle.velocity.y);
  assert.ok(boosted > circle.speed * 1.5, '撃ち出しの勢いが付いていない');

  let landed = 0;
  a.engine.on('circle:landed', () => { landed += 1; });
  drain(a, 1200);

  assert.strictEqual(landed, 1, '着弾の合図が出ていない');
  assert.strictEqual(circle.launchUntil, null);
  const settled = Math.hypot(circle.velocity.x, circle.velocity.y);
  assert.ok(Math.abs(settled - circle.speed) < 1, '速さが元に戻っていない');
});

// ------------------------------------------------------------ 順番待ち

test('同時にたくさん来ても 1 発ずつ順番に撃つ', () => {
  const a = arena();
  for (let i = 1; i <= 6; i += 1) {
    a.send({ type: 'member', user: { id: 'u' + i, uniqueId: 'v' + i } });
  }

  assert.strictEqual(a.engine.circles.length, 0, '同時に全部出てしまっている');
  drain(a);

  assert.strictEqual(a.fired.length, 6, '全員ぶん撃たれていない');
  assert.strictEqual(a.engine.circles.length, 6);
  // 送った順に撃たれている
  assert.deepStrictEqual(a.fired.map((f) => f.shot.user.uniqueId),
    ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
});

test('待ちが増えたら装填を短くする', () => {
  const a = arena();
  const s = a.config.cannon;

  a.send({ type: 'member', user: { id: 'u1', uniqueId: 'v1' } });
  a.cannon.update(a.now());
  assert.strictEqual(a.cannon._loadMs(), s.loadMs, '1 人でも急いでいる');

  for (let i = 2; i <= 6; i += 1) {
    a.send({ type: 'member', user: { id: 'u' + i, uniqueId: 'v' + i } });
  }
  assert.strictEqual(a.cannon._loadMs(), s.burstLoadMs, '混んでいるのに急がない');
});

test('待たせすぎるくらいなら演出を飛ばして撃つ', () => {
  const a = arena();
  const max = a.config.cannon.maxQueue;

  for (let i = 1; i <= max + 5; i += 1) {
    a.send({ type: 'member', user: { id: 'u' + i, uniqueId: 'v' + i } });
  }

  // 溢れたぶんはその場で撃たれている (誰も入れないままにしない)
  assert.ok(a.cannon.stats.skipped >= 5, '溢れたぶんが撃たれていない');
  assert.ok(a.engine.circles.length >= 5, '盤面に出ていない');
  assert.ok(a.cannon.queue.length <= max, '待ちが減っていない');
});

test('大砲が詰まっていてもゲームは進む', () => {
  const a = arena();
  for (let i = 1; i <= 10; i += 1) {
    a.send({ type: 'member', user: { id: 'u' + i, uniqueId: 'v' + i } });
  }

  const before = a.engine.stats.spawned;
  // 大砲を止めたまま時間だけ進める
  a.advance(4000, { steps: 200 });

  assert.ok(a.engine.stats.spawned > before, '敵の生成が止まっている');
  assert.ok(a.cannon.queue.length > 0, '待ちが消えている (前提が崩れた)');
});

// ------------------------------------------------------ 既存ルールを守る

test('装填中にまた行動したら、その弾が強くなる (円は増えない)', () => {
  const a = arena();
  const user = { id: 'u1', uniqueId: 'yui' };

  a.send({ type: 'member', user });                    // 入室ぶんが装填される
  assert.ok(a.cannon.pendingFor('u1'), '装填されていない');

  a.send({ type: 'like', count: 100, user });          // HP +10 ポイント
  assert.strictEqual(a.cannon.pendingCount('u1'), 1, '弾が 2 つになっている');

  drain(a);
  assert.strictEqual(a.engine.circles.length, 1);
  // 入室の 3 + いいねの 10 が、撃たれた 1 つの円にまとまって乗ります
  assert.strictEqual(a.engine.circles[0].points.hp, 13, '装填中の弾が強くなっていない');
});

test('保有上限 (1 人 1 つ) は大砲の中のぶんも数える', () => {
  const a = arena();
  const user = { id: 'u1', uniqueId: 'yui' };
  const cap = a.config.viewers.limits.maxPerUser;

  // 本番と同じ経路で、続けざまに送る
  for (let i = 0; i < cap + 3; i += 1) {
    a.send({ type: 'gift', diamondCount: 100, user });
    a.advance(20);
    a.cannon.update(a.now());
  }
  assert.ok(a.cannon.pendingCount('u1') + a.engine.circleCountOf('u1') <= cap,
    '盤面と大砲を合わせて上限を超えている');

  drain(a);
  assert.strictEqual(a.engine.circles.filter((c) => c.ownerId === 'u1').length, cap);
  // 送ったぶんは全部、その 1 つの円へ乗ります (頭打ちはありません)
  assert.strictEqual(a.engine.circles.find((c) => c.ownerId === 'u1').points.attack,
    (cap + 3) * 100, '送ったギフトのぶんが乗っていない');
});

test('入っただけでは点が入らない', () => {
  const a = arena();
  a.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });
  drain(a);

  const record = a.leaderboard.get('u1');
  assert.ok(record, 'ランキングに載っていない');
  assert.strictEqual(record.score, 0, '入っただけで点が入っている');
  assert.strictEqual(record.kills, 0);
});

// ------------------------------------------------------------ 将来の拡張

test('演出の種類を増やせる形になっている', () => {
  const config = makeConfig();
  const types = config.cannon.types;
  assert.ok(types.normal, 'normal が無い');
  assert.ok(types.special && types.legendary, '将来ぶんの枠が無い');

  // 今はすべて normal を使う
  for (const event of Object.keys(config.cannon.typeByEvent)) {
    assert.strictEqual(config.cannon.typeByEvent[event], 'normal',
      `${event} が normal 以外になっている`);
  }
});

test('大砲を切れば今までどおりその場に出る', () => {
  const s = setup({ config: { demo: { enabled: false } } });   // launcher を付けない
  s.send({ type: 'member', user: { id: 'u1', uniqueId: 'yui' } });

  assert.strictEqual(s.engine.circles.length, 1, '大砲なしで出てこない');
  assert.strictEqual(s.engine.circles[0].launchUntil, null);
});
