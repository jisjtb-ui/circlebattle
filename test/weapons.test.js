/**
 * 武器の段のテスト。
 *
 * 一番大事なのは「**武器はステータスを 1 つも変えない**」ことです。
 * 見た目の話が強さに漏れると、育て方の説明と実際がずれます。
 */
const test = require('node:test');
const assert = require('node:assert');
const { Weapons } = require('../js/weapons.js');
const { statsForLevel } = require('../js/game.js');
const { setup, makeConfig } = require('./helpers.js');

/** canvas の無い Node でも段の計算だけは試せます。 */
function weapons(overrides) {
  return new Weapons({ config: makeConfig(overrides), doc: null });
}

test('レベルごとに正しい段になる', () => {
  const w = weapons();
  const expected = [
    [1, 'none'], [9, 'none'],
    [10, 'blade'], [19, 'blade'],
    [20, 'twin'], [30, 'spear'], [40, 'axe'], [50, 'scythe'],
    [60, 'chakram'], [70, 'cannon'], [80, 'wings'], [90, 'orbital'],
    [99, 'orbital'], [100, 'core']
  ];

  for (const [level, id] of expected) {
    assert.strictEqual(w.tierFor(level).id, id, `Lv${level} の段が違う`);
  }
});

test('段は 11 個あり、Lv1 と Lv100 を含む', () => {
  const tiers = makeConfig().weapons.tiers;
  assert.strictEqual(tiers.length, 11);
  assert.strictEqual(tiers[0].minLevel, 1);
  assert.strictEqual(tiers[tiers.length - 1].minLevel, 100);

  // 昇順で、10 ずつ上がっている
  for (let i = 1; i < tiers.length; i += 1) {
    assert.strictEqual(tiers[i].minLevel, tiers[i - 1].minLevel + (i === 1 ? 9 : 10));
  }

  // 見分けが付くように、色は全部違う
  const colors = new Set(tiers.map((t) => t.color));
  assert.strictEqual(colors.size, tiers.length, '同じ色の段がある');
});

test('段の中でも進み具合が増えていく (中間レベルの成長)', () => {
  const w = weapons();

  assert.strictEqual(w.progressFor(10), 0);
  assert.strictEqual(w.progressFor(15), 0.5);
  assert.ok(w.progressFor(19) > w.progressFor(15));
  assert.strictEqual(w.progressFor(20), 0, '次の段では 0 に戻る');
  assert.strictEqual(w.progressFor(100), 1, '最終段は常に 1');
});

test('軌跡は段の半ばから出る (Lv15 / Lv25 …)', () => {
  const config = makeConfig();
  const w = new Weapons({ config, doc: null });
  const from = config.weapons.trailFrom;

  assert.ok(w.progressFor(14) < from, 'Lv14 で軌跡が出ている');
  assert.ok(w.progressFor(15) >= from, 'Lv15 で軌跡が出ていない');
  assert.ok(w.progressFor(25) >= from, 'Lv25 で軌跡が出ていない');
});

test('段をまたいだときだけ演出を出す', () => {
  const w = weapons();

  assert.strictEqual(w.tierChanged(9, 10).id, 'blade');
  assert.strictEqual(w.tierChanged(49, 50).id, 'scythe');
  assert.strictEqual(w.tierChanged(99, 100).id, 'core');
  assert.strictEqual(w.tierChanged(11, 12), null, '段の中で演出が出ている');
  assert.strictEqual(w.tierChanged(50, 50), null);
  // ギフトで一気に上がった場合も、着いた先の段を返す
  assert.strictEqual(w.tierChanged(1, 70).id, 'cannon');
});

test('次の段まであと何レベルか分かる', () => {
  const w = weapons();
  assert.strictEqual(w.levelsToNextTier(1), 9);
  assert.strictEqual(w.levelsToNextTier(48), 2);
  assert.strictEqual(w.levelsToNextTier(100), 0, '最終段の先は無い');
});

test('節目は Lv50 と Lv100 だけ', () => {
  const milestones = makeConfig().weapons.milestones;
  assert.deepStrictEqual(milestones, [50, 100]);
});

// ------------------------------------------------- 強さに影響しないこと

test('武器を切ってもステータスは 1 つも変わらない', () => {
  const on = makeConfig();
  const off = makeConfig({ weapons: { enabled: false } });

  for (const level of [1, 10, 25, 50, 75, 99, 100]) {
    assert.deepStrictEqual(
      statsForLevel(level, off.viewers),
      statsForLevel(level, on.viewers),
      `Lv${level} のステータスが武器の設定で変わっている`
    );
  }
});

test('段が変わっても円の能力は今までどおり', () => {
  const s = setup({ config: { demo: { enabled: false } } });
  const user = { id: 'u1', uniqueId: 'yui' };

  // Lv9 (武器なし) から Lv10 (NEON BLADE) へ 1 段またぐ
  s.session.gainLevels(user, 9, 'GIFT', s.now());
  const circle = s.engine.circles[0];
  const before = { hp: circle.maxHp, attack: circle.attack, radius: circle.radius, speed: circle.speed };

  s.session.gainLevels(user, 1, 'LIKE', s.now());

  // 上がるのはレベル補正のぶんだけ。武器のぶんは 0
  const expected = statsForLevel(10, s.config.viewers);
  assert.strictEqual(circle.level, 10);
  assert.strictEqual(circle.maxHp, expected.hp);
  assert.strictEqual(circle.attack, expected.attack);
  assert.strictEqual(circle.radius, expected.radius);
  assert.strictEqual(circle.speed, expected.speed);
  assert.ok(circle.attack > before.attack, 'レベル補正まで消えている');
});

test('武器は円の外側にだけ出る (プロフィール画像を隠さない)', () => {
  const config = makeConfig();
  assert.ok(config.weapons.extent > 1, '武器が円の内側に入る設定になっている');
  assert.ok(config.weapons.extent <= 2.2, '武器が大きすぎて隣の円を隠す');
});

test('武器の大きさはレベルに対して必ず増える (段の境目でも逆転しない)', () => {
  const w = weapons();
  let previous = 0;

  for (let level = 1; level <= 100; level += 1) {
    const scale = w.scaleFor(level);
    assert.ok(scale > previous, `Lv${level} で武器が小さくなっている`);
    previous = scale;
  }

  const config = makeConfig().weapons;
  assert.strictEqual(w.scaleFor(1), config.minScale);
  assert.strictEqual(w.scaleFor(100), config.maxScale);
  // レベルの範囲外を渡しても壊れない
  assert.strictEqual(w.scaleFor(0), config.minScale);
  assert.strictEqual(w.scaleFor(999), config.maxScale);
});

test('NPC の武器は本物より目立たない設定になっている', () => {
  const config = makeConfig().weapons;
  assert.ok(config.npcAlpha < 1, 'NPC の武器が本物と同じ濃さ');
  assert.ok(config.npcColor, 'NPC の色が無い');
  // 段の色のどれとも違う色でなければ、見分けられません
  assert.ok(!config.tiers.some((t) => t.color === config.npcColor));
});
