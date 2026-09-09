/**
 * 武器の段のテスト。
 *
 * 一番大事なのは「**武器はステータスを 1 つも変えない**」ことです。
 * 見た目の話が強さに漏れると、育て方の説明と実際がずれます。
 */
const test = require('node:test');
const assert = require('node:assert');
const { Weapons } = require('../js/weapons.js');
const { statsForPoints } = require('../js/game.js');
const { setup, makeConfig, attackPoints } = require('./helpers.js');

/** canvas の無い Node でも段の計算だけは試せます。 */
function weapons(overrides) {
  return new Weapons({ config: makeConfig(overrides), doc: null });
}

test('攻撃力ごとに正しい段になる', () => {
  const w = weapons();
  const expected = [
    [0, 'none'], [99, 'none'],
    [100, 'blade'], [169, 'blade'],
    [170, 'twin'], [250, 'spear'], [330, 'axe'], [410, 'scythe'],
    [500, 'chakram'], [590, 'cannon'], [680, 'wings'], [780, 'orbital'],
    [879, 'orbital'], [880, 'core']
  ];

  for (const [attack, id] of expected) {
    assert.strictEqual(w.tierFor(attack).id, id, `攻撃力 ${attack} の段が違う`);
  }
});

test('武器はギフトだけで上がる (いいねでは上がらない)', () => {
  const s = setup({ config: { demo: { enabled: false } } });
  const user = { id: 'u1', uniqueId: 'yui' };
  const w = new Weapons({ config: s.config, doc: null });

  s.session.gainPoints(user, { hp: 200 }, 'LIKE', s.now());
  assert.strictEqual(w.tierFor(s.engine.circles[0].attack).id, 'none',
    'いいねだけで武器が生えている');

  s.session.gainPoints(user, { attack: 30 }, 'GIFT', s.now());
  assert.notStrictEqual(w.tierFor(s.engine.circles[0].attack).id, 'none',
    'ギフトで武器が生えていない');
});

test('段は 11 個あり、武器なしから最終段まで並んでいる', () => {
  const tiers = makeConfig().weapons.tiers;
  assert.strictEqual(tiers.length, 11);
  assert.strictEqual(tiers[0].minAttack, 0);
  assert.strictEqual(tiers[0].id, 'none');
  assert.strictEqual(tiers[tiers.length - 1].id, 'core');

  // 昇順
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(tiers[i].minAttack > tiers[i - 1].minAttack, `${tiers[i].id} の順が逆`);
  }

  // 見分けが付くように、色は全部違う
  const colors = new Set(tiers.map((t) => t.color));
  assert.strictEqual(colors.size, tiers.length, '同じ色の段がある');
});

test('段の中でも進み具合が増えていく', () => {
  const w = weapons();

  assert.strictEqual(w.progressFor(100), 0);
  assert.strictEqual(w.progressFor(135), 0.5);
  assert.ok(w.progressFor(169) > w.progressFor(135));
  assert.strictEqual(w.progressFor(170), 0, '次の段では 0 に戻る');
  assert.strictEqual(w.progressFor(880), 1, '最終段は常に 1');
});

test('軌跡は段の半ばから出る', () => {
  const config = makeConfig();
  const w = new Weapons({ config, doc: null });
  const from = config.weapons.trailFrom;

  assert.ok(w.progressFor(120) < from, '段の入口で軌跡が出ている');
  assert.ok(w.progressFor(135) >= from, '段の半ばで軌跡が出ていない');
  assert.ok(w.progressFor(215) >= from, '次の段の半ばで軌跡が出ていない');
});

test('段をまたいだときだけ演出を出す', () => {
  const w = weapons();

  assert.strictEqual(w.tierChanged(99, 100).id, 'blade');
  assert.strictEqual(w.tierChanged(409, 410).id, 'scythe');
  assert.strictEqual(w.tierChanged(879, 880).id, 'core');
  assert.strictEqual(w.tierChanged(110, 120), null, '段の中で演出が出ている');
  assert.strictEqual(w.tierChanged(410, 410), null);
  // ギフトで一気に上がった場合も、着いた先の段を返す
  assert.strictEqual(w.tierChanged(40, 590).id, 'cannon');
});

test('次の段まであとどれだけ要るか分かる', () => {
  const w = weapons();
  assert.strictEqual(w.attackToNextTier(40), 60);
  assert.strictEqual(w.attackToNextTier(400), 10);
  assert.strictEqual(w.attackToNextTier(900), 0, '最終段の先は無い');
});

test('節目は 2 つだけ (毎段だと 10 回画面をふさぐ)', () => {
  const config = makeConfig().weapons;
  assert.strictEqual(config.milestones.length, 2);
  for (const id of config.milestones) {
    assert.ok(config.tiers.some((t) => t.id === id), `${id} という段が無い`);
  }
});

// ------------------------------------------------- 強さに影響しないこと

test('武器を切ってもステータスは 1 つも変わらない', () => {
  const on = makeConfig();
  const off = makeConfig({ weapons: { enabled: false } });

  for (const points of [{}, { attack: 10 }, { attack: 60 }, { hp: 40, attack: 140 }]) {
    assert.deepStrictEqual(
      statsForPoints(points, off.viewers),
      statsForPoints(points, on.viewers),
      `${JSON.stringify(points)} のステータスが武器の設定で変わっている`
    );
  }
});

test('段が変わっても円の能力は今までどおり', () => {
  const s = setup({ config: { demo: { enabled: false } } });
  const user = { id: 'u1', uniqueId: 'yui' };
  const need = attackPoints(s.config, 100);          // NEON BLADE の手前まで

  s.session.gainPoints(user, { attack: need - 1 }, 'GIFT', s.now());
  const circle = s.engine.circles[0];
  const before = { attack: circle.attack };

  s.session.gainPoints(user, { attack: 1 }, 'GIFT', s.now());

  // 上がるのはポイントのぶんだけ。武器のぶんは 0
  const expected = statsForPoints({ attack: need }, s.config.viewers);
  assert.strictEqual(circle.maxHp, expected.hp);
  assert.strictEqual(circle.attack, expected.attack);
  assert.strictEqual(circle.radius, expected.radius);
  assert.strictEqual(circle.speed, expected.speed);
  assert.ok(circle.attack > before.attack, 'ポイントぶんまで消えている');
});

test('武器は円の外側にだけ出る (プロフィール画像を隠さない)', () => {
  const config = makeConfig();
  assert.ok(config.weapons.extent > 1, '武器が円の内側に入る設定になっている');
  assert.ok(config.weapons.extent <= 2.2, '武器が大きすぎて隣の円を隠す');
});

test('武器の大きさは攻撃力に対して必ず増える (段の境目でも逆転しない)', () => {
  const w = weapons();
  const full = makeConfig().viewers;
  const max = full.base.attack + full.stats.attack.max;
  let previous = -1;

  for (let attack = 0; attack <= max; attack += 10) {
    const scale = w.scaleFor(attack);
    assert.ok(scale > previous, `攻撃力 ${attack} で武器が小さくなっている`);
    previous = scale;
  }

  const config = makeConfig().weapons;
  assert.strictEqual(w.scaleFor(0), config.minScale);
  assert.strictEqual(w.scaleFor(max), config.maxScale);
  // 範囲外を渡しても壊れない
  assert.strictEqual(w.scaleFor(-50), config.minScale);
  assert.strictEqual(w.scaleFor(99_999), config.maxScale);
});

test('NPC の武器は本物より目立たない設定になっている', () => {
  const config = makeConfig().weapons;
  assert.ok(config.npcAlpha < 1, 'NPC の武器が本物と同じ濃さ');
  assert.ok(config.npcColor, 'NPC の色が無い');
  // 段の色のどれとも違う色でなければ、見分けられません
  assert.ok(!config.tiers.some((t) => t.color === config.npcColor));
});
