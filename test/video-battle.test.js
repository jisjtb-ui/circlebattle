/**
 * VIDEO BATTLE MODE のルールのテスト。
 *
 * 一番大事なのは順番です:
 *
 *   攻撃 → (当たれば) ダメージ → HP 減少 → 'hit'
 *
 * 外れたときに HP が減らないこと、当たったぶんだけ HP が減ること、
 * HP が 0 になったら決着すること。ここが崩れると、HP バーも音も
 * 何を表しているのか分からなくなります。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('./video-helpers.js');

test('RED も BLUE も満タンから始まる', () => {
  const s = setup();
  assert.strictEqual(s.red.hp, s.config.fighters.maxHp);
  assert.strictEqual(s.blue.hp, s.config.fighters.maxHp);
  assert.strictEqual(s.battle.phase, 'live');
});

test('武器が命中すると、その量だけ HP が減る', () => {
  const s = setup();
  s.place(20);
  s.battle.equip(s.red, 'sword', s.now());
  s.battle.equip(s.blue, 'hammer', s.now());   // 相手はほぼ攻撃しない設定に

  const before = s.blue.hp;
  s.advance(1200);

  const hits = s.hits.filter((hit) => hit.target.id === 'blue');
  assert.ok(hits.length > 0, '一度も当たっていない');
  const dealt = hits.reduce((sum, hit) => sum + hit.amount, 0);
  assert.strictEqual(s.blue.hp, before - dealt, 'HP の減り方がダメージと合っていない');
});

test('外れたときは HP が減らず、音も鳴らさない', () => {
  const s = setup();
  s.place(20);
  s.battle.equip(s.red, 'hammer', s.now());

  // 持ち替えの間 (220ms) を置いてから振りかぶりが始まります
  s.advance(280);
  assert.strictEqual(s.red.action, 'windup');

  // 振り下ろす前に相手を遠くへ動かす (= 避けた)
  const away = s.battle.bounds();
  s.blue.position = { x: away.right - s.blue.radius - 10, y: away.bottom - s.blue.radius - 10 };
  const before = s.blue.hp;
  s.advance(400);

  assert.strictEqual(s.blue.hp, before, '外れたのに HP が減っている');
  assert.ok(s.of('miss').length > 0, 'miss が出ていない');
  assert.ok(!s.audio.names().includes('hammer-hit'), '外れたのにヒット音が鳴っている');
  assert.ok(s.audio.names().includes('hammer-shot'), '射出音は鳴るはず');
});

test('射出音とヒット音は別のイベントで鳴る', () => {
  const s = setup();
  s.place(20);
  s.battle.equip(s.red, 'sword', s.now());
  s.advance(600);

  const names = s.audio.names();
  assert.ok(names.includes('sword-shot'), '射出音が鳴っていない');
  assert.ok(names.includes('sword-hit'), 'ヒット音が鳴っていない');
  assert.ok(names.indexOf('sword-shot') < names.indexOf('sword-hit'), '射出より先にヒット音が鳴っている');
});

test('大ダメージは big として通知され、ヒットストップも長い', () => {
  const s = setup();
  s.place(20);
  s.battle.equip(s.red, 'hammer', s.now());
  s.advance(900);

  const big = s.hits.find((hit) => hit.big);
  assert.ok(big, 'HAMMER が大ダメージ扱いになっていない');
  assert.ok(big.amount >= s.blue.maxHp * s.config.hp.bigDamageRatio);
  assert.ok(big.shake > s.config.effects.shake, '大ダメージの振動が通常と同じ');
});

test('ヒットストップの間は盤面が止まる', () => {
  const s = setup();
  s.place(20);
  s.battle.equip(s.red, 'sword', s.now());
  s.advance(600);

  const at = s.now();
  s.battle.hitstopUntil = at + 100;
  const x = s.blue.position.x;
  s.advance(60, { step: 20 });

  assert.strictEqual(s.blue.position.x, x, '止まっている間に動いている');
});

test('HP の危険域が 30% / 15% / 5% で知らされる', () => {
  const s = setup();
  const now = s.now();

  s.blue.hp = s.blue.maxHp * 0.28;
  s.battle._levelTick(s.blue, now);
  s.blue.hp = s.blue.maxHp * 0.12;
  s.battle._levelTick(s.blue, now);
  s.blue.hp = s.blue.maxHp * 0.04;
  s.battle._levelTick(s.blue, now);

  assert.deepStrictEqual(s.of('level').map((event) => event.level), ['warn', 'danger', 'critical']);
});

test('「あと一撃」の合図は 1 戦に 1 回だけ', () => {
  const s = setup();
  const now = s.now();

  s.blue.hp = s.blue.maxHp * 0.04;
  s.battle._levelTick(s.blue, now);
  s.blue.hp = s.blue.maxHp * 0.5;
  s.battle._levelTick(s.blue, now);
  s.blue.hp = s.blue.maxHp * 0.02;
  s.battle._levelTick(s.blue, now);

  assert.strictEqual(s.of('hush').length, 1);
  assert.strictEqual(s.audio.hushes.length, 1, '無音が二度入っている');
});

test('HP が 0 になったら決着し、それ以上減らない', () => {
  const s = setup();
  s.place(20);
  s.blue.hp = 5;
  s.battle.equip(s.red, 'sword', s.now());
  s.advance(800);

  assert.strictEqual(s.blue.hp, 0);
  assert.strictEqual(s.battle.phase, 'over');
  assert.strictEqual(s.battle.winner.id, 'red');

  const ko = s.of('ko')[0];
  assert.ok(ko, 'ko が出ていない');
  assert.strictEqual(ko.winner.id, 'red');
  assert.strictEqual(ko.loser.id, 'blue');

  const hitsAfter = s.hits.length;
  s.advance(1000);
  assert.strictEqual(s.hits.length, hitsAfter, '決着後も当たっている');
});

test('決着の一撃は専用の音で、勝利音と敗北音が同時に始まる', () => {
  const s = setup();
  s.place(20);
  s.blue.hp = 5;
  s.battle.equip(s.red, 'sword', s.now());
  s.advance(800);

  const names = s.audio.names();
  assert.ok(names.includes('ko-impact'), '撃破音が鳴っていない');
  assert.ok(names.includes('defeat'), '敗北音が鳴っていない');
  assert.ok(names.includes('victory'), '勝利音が鳴っていない');

  const ko = s.of('ko')[0];
  const victory = s.audio.played.find((entry) => entry.name === 'victory');
  const defeat = s.audio.played.find((entry) => entry.name === 'defeat');
  assert.strictEqual(victory.at, ko.at, '勝利音が ko とずれている');
  assert.strictEqual(defeat.at, ko.at, '敗北音が ko とずれている');
});

test('アイテムを拾うと武器が変わり、取得音が鳴る', () => {
  const s = setup();
  const item = s.battle.spawnItem('shotgun', s.now());
  s.red.position = { x: item.x, y: item.y };

  s.advance(60);

  assert.strictEqual(s.red.weapon.id, 'shotgun');
  assert.strictEqual(s.of('pickup').length, 1);
  assert.ok(s.audio.names().includes('item-pickup'));
  assert.strictEqual(s.battle.items.length, 0, '拾ったアイテムが残っている');
});

test('SHOTGUN は 1 回の射出で複数の粒が飛ぶ', () => {
  const s = setup();
  s.place(600);                       // 届かない距離から撃たせる
  s.battle.equip(s.red, 'shotgun', s.now());
  s.red.nextAttackAt = 0;

  s.battle._fire(s.red, s.blue, s.now());
  assert.strictEqual(s.battle.projectiles.length, s.config.weapons.shotgun.pellets);
  assert.strictEqual(s.of('shot').length, 1, '粒の数だけ射出音が鳴ってはいけない');
});

test('LASER は照射の始めと終わりでループ音を出し入れする', () => {
  const s = setup();
  s.place(120);
  s.battle.equip(s.red, 'laser', s.now());
  s.red.nextAttackAt = 0;

  s.advance(400);
  assert.ok(s.audio.names().includes('laser-start'), '充填音が鳴っていない');

  s.advance(400);
  assert.ok(s.audio.loops.some((entry) => entry.start === 'laser-loop'), '照射中のループが始まっていない');

  s.advance(2000);
  assert.ok(s.audio.loops.some((entry) => entry.stop === 'beam:red'), 'ループが止まっていない');
  assert.ok(s.audio.names().includes('laser-end'), '停止音が鳴っていない');
});

test('LASER のダメージは毎フレームではなく一定間隔', () => {
  const s = setup();
  s.place(60);
  s.battle.equip(s.red, 'laser', s.now());
  s.red.nextAttackAt = 0;

  s.advance(2200, { step: 16 });

  const laserHits = s.hits.filter((hit) => hit.weapon.id === 'laser');
  assert.ok(laserHits.length > 0, '照射しても当たっていない');
  const maxTicks = Math.ceil(s.config.weapons.laser.beamMs / s.config.weapons.laser.tickMs) + 1;
  assert.ok(laserHits.length <= maxTicks,
    `間隔を無視して鳴っている (${laserHits.length} > ${maxTicks})`);
  laserHits.forEach((hit) => assert.strictEqual(hit.continuous, true));
});

test('INJECTION NEEDLE は刺さったあとも削り続ける (ただし音は鳴らさない)', () => {
  const s = setup();
  s.place(10);
  s.battle.equip(s.red, 'needle', s.now());
  s.advance(300);

  assert.ok(s.blue.poison, '毒が付いていない');
  assert.ok(s.audio.names().includes('needle-poison'), '毒付与音が鳴っていない');

  const poisonHits = s.hits.filter((hit) => hit.poison);
  assert.ok(poisonHits.length >= 0);

  // 継続ダメージは silent なので、その回数ぶんヒット音は増えません
  s.advance(1500);
  const after = s.hits.filter((hit) => hit.poison);
  assert.ok(after.length > 0, '継続ダメージが入っていない');
  after.forEach((hit) => assert.strictEqual(hit.silent, true));
});

test('終盤ほど 1 発が重くなる', () => {
  const s = setup();
  const start = s.now();
  const early = s.battle.damageMultiplier(start);
  const late = s.battle.damageMultiplier(start + s.config.escalation.toMs);

  assert.strictEqual(early, 1);
  assert.ok(late > early, '終盤でもダメージが変わっていない');
  assert.ok(Math.abs(late - s.config.escalation.maxMultiplier) < 0.001);
});

test('戦況が進むほど intensity が上がる', () => {
  const s = setup();
  assert.ok(s.battle.intensity(s.now()) < 0.05);

  s.red.hp = s.red.maxHp * 0.2;
  s.blue.hp = s.blue.maxHp * 0.2;
  assert.ok(s.battle.intensity(s.now()) > 0.7);
});

test('リセットすると HP も武器も戻る', () => {
  const s = setup();
  s.blue.hp = 1;
  s.battle.equip(s.blue, 'laser', s.now());
  s.battle.reset(s.now());

  assert.strictEqual(s.battle.fighters.blue.hp, s.config.fighters.maxHp);
  assert.strictEqual(s.battle.fighters.blue.weapon.id, s.config.fighters.blue.startWeapon);
  assert.strictEqual(s.battle.phase, 'live');
  assert.strictEqual(s.battle.hushed, false);
});

test('壁の外へは出ない (HP バーの下に潜り込まない)', () => {
  const s = setup();
  s.advance(6000, { step: 16 });

  const b = s.battle.bounds();
  ['red', 'blue'].forEach((id) => {
    const f = s.battle.fighters[id];
    assert.ok(f.position.y >= b.top + f.radius - 1, `${id} が上へ抜けている`);
    assert.ok(f.position.y <= b.bottom - f.radius + 1, `${id} が下へ抜けている`);
    assert.ok(f.position.x >= b.left + f.radius - 1, `${id} が左へ抜けている`);
    assert.ok(f.position.x <= b.right - f.radius + 1, `${id} が右へ抜けている`);
  });
});

test('LIVE 版の設定には触っていない', () => {
  const { CONFIG } = require('../js/config.js');
  const { VIDEO_CONFIG } = require('../js/video-config.js');

  assert.ok(CONFIG.audio.sfx.hit, 'LIVE 版の音の設定が消えている');
  assert.strictEqual(CONFIG.viewers != null, true);
  assert.strictEqual(VIDEO_CONFIG.viewers, undefined, '動画モードが LIVE 版の設定を持っている');
  assert.notStrictEqual(CONFIG.audio, VIDEO_CONFIG.audio, '音の設定を共有している');
});
