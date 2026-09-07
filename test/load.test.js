/**
 * 100 人規模の負荷テスト。
 *
 * 視聴者が増えたときに、フレームが飛んだり、円が消えたり、
 * ランキングが壊れたりしないことを見ます。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./helpers.js');

/** 100 人が思い思いに操作している 1 秒ぶんのイベントを流す。 */
function crowd(harness, users, second) {
  const pick = () => users[Math.floor(Math.random() * users.length)];
  for (let i = 0; i < 50; i += 1) {
    harness.send({ type: 'like', count: 5 + Math.floor(Math.random() * 26), user: pick() });
  }
  const roll = Math.random();
  const user = pick();
  harness.send(roll < 0.4 ? { type: 'follow', user }
    : roll < 0.7 ? { type: 'share', user }
      : { type: 'chat', comment: 'がんばれ', user });
  if (second % 2 === 0) {
    harness.send({ type: 'gift', diamondCount: 1 + Math.floor(Math.random() * 50), user: pick() });
  }
}

function makeUsers(count) {
  const users = [];
  for (let i = 1; i <= count; i += 1) {
    users.push({
      id: 'u' + i,
      uniqueId: 'viewer' + String(i).padStart(3, '0'),
      avatarThumb: { urlList: ['https://x/100x100/a' + (i % 8) + '.webp'] }
    });
  }
  return users;
}

test('100 人が操作し続けてもフレームが飛ばない', () => {
  const harness = setup();
  const users = makeUsers(100);
  const times = [];

  for (let second = 0; second < 60; second += 1) {
    crowd(harness, users, second);
    for (let frame = 0; frame < 60; frame += 1) {
      const started = process.hrtime.bigint();
      harness.advance(1000 / 60, { steps: 1 });
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
  }

  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  const worst = times[times.length - 1];
  const dropped = times.filter((t) => t > 16.7).length;

  assert.ok(p99 < 5, `1 フレームの p99 が ${p99.toFixed(2)}ms ある`);
  assert.strictEqual(dropped, 0, `${dropped} フレームが 16.7ms を超えた (最悪 ${worst.toFixed(1)}ms)`);
});

test('100 人でも円と敵は上限内、ランキングは決めた人数', () => {
  const harness = setup();
  const users = makeUsers(100);
  const { engine, leaderboard, config } = harness;

  for (let second = 0; second < 90; second += 1) {
    crowd(harness, users, second);
    harness.advance(1000, { steps: 60 });
  }

  assert.ok(engine.circles.length <= config.viewers.limits.maxCircles);
  assert.ok(engine.enemies.length <= config.enemies.spawn.maxAlive);
  assert.strictEqual(leaderboard.count(), 100, '参加者が漏れている');
  assert.strictEqual(leaderboard.top().length, config.ranking.size);

  // 上位から順に並んでいる
  const top = leaderboard.top();
  for (let i = 1; i < top.length; i += 1) {
    assert.ok(top[i - 1].score >= top[i].score, 'ランキングの並びが崩れている');
  }
  assert.ok(top[0].kills > 0, '誰も倒せていない');
});

test('100 人でも円が止まらない / 場外に出ない / 敵が埋まらない', () => {
  const harness = setup();
  const users = makeUsers(100);
  const { engine, config } = harness;
  let stuckPairs = 0;

  for (let second = 0; second < 90; second += 1) {
    crowd(harness, users, second);
    harness.advance(1000, { steps: 60 });

    engine.circles.forEach((circle) => {
      assert.ok(Math.hypot(circle.velocity.x, circle.velocity.y) > 1, '止まった円がある');
      // フィールドは混み具合で広がるので、いまの広さと比べます
      assert.ok(circle.position.x >= -1 && circle.position.x <= engine.field.width + 1 &&
                circle.position.y >= -1 && circle.position.y <= engine.field.height + 1,
      '円が場外に出た');
    });

    // 敵同士が「小さいほうが完全に埋まる」ほど重なっていないこと
    for (let i = 0; i < engine.enemies.length; i += 1) {
      for (let j = i + 1; j < engine.enemies.length; j += 1) {
        const a = engine.enemies[i];
        const b = engine.enemies[j];
        const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        if ((a.radius + b.radius) - gap > Math.min(a.radius, b.radius)) stuckPairs += 1;
      }
    }
  }

  assert.strictEqual(stuckPairs, 0, `${stuckPairs} 回、敵が敵の中に埋まっていた`);
});

test('人が増えても 1 人が独占しない (円は全員に行き渡る)', () => {
  const harness = setup();
  const users = makeUsers(100);
  const { engine, config } = harness;

  for (let second = 0; second < 60; second += 1) {
    crowd(harness, users, second);
    harness.advance(1000, { steps: 60 });
  }

  const perUser = {};
  engine.circles.forEach((c) => { perUser[c.ownerId] = (perUser[c.ownerId] || 0) + 1; });
  const owners = Object.keys(perUser).length;
  const most = Math.max(...Object.values(perUser));

  assert.ok(owners > 40, `円を持っているのが ${owners} 人しかいない`);
  assert.ok(most <= config.viewers.limits.maxPerUser);
  assert.ok(most < engine.circles.length * 0.25, `1 人で ${most} 個 (全体の 4 分の 1 以上) を占めている`);
});
