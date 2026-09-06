/**
 * 効果音の「いつ鳴らすか」のテスト。
 * 音そのもの (WebAudio) はブラウザでしか動かないので、
 * ここでは間引きと入 / 切だけを見ます。
 */
const test = require('node:test');
const assert = require('node:assert');
const { SfxPlayer } = require('../js/audio.js');
const { makeConfig } = require('./helpers.js');

function player(overrides) {
  let clock = 1000;
  const sfx = new SfxPlayer({ config: makeConfig(overrides), now: () => clock });
  return {
    sfx,
    at: () => clock,
    advance(ms) { clock += ms; return clock; }
  };
}

test('音が鳴る (音源ファイルは要らない)', () => {
  const { sfx } = player();
  assert.strictEqual(sfx.play('kill'), true);
  assert.strictEqual(sfx.stats.played, 1);
});

test('知らない名前は鳴らさない', () => {
  const { sfx } = player();
  assert.strictEqual(sfx.play('nothing-like-this'), false);
});

test('同じ音は最短間隔まで繰り返さない', () => {
  const p = player({ audio: { sfx: { kill: { minIntervalMs: 100 } } } });

  assert.strictEqual(p.sfx.play('kill'), true);
  assert.strictEqual(p.sfx.play('kill'), false, '連続で鳴っている');

  p.advance(60);
  assert.strictEqual(p.sfx.play('kill'), false);

  p.advance(50);                       // 合計 110ms
  assert.strictEqual(p.sfx.play('kill'), true);
});

test('別の音は互いの間隔に影響しない', () => {
  const p = player();
  assert.strictEqual(p.sfx.play('kill'), true);
  assert.strictEqual(p.sfx.play('gift'), true);
});

test('1 秒あたりの上限を超えたら鳴らさない', () => {
  const p = player({ audio: { maxPerSecond: 3, sfx: { hit: { minIntervalMs: 0 } } } });

  assert.strictEqual(p.sfx.play('hit'), true);
  assert.strictEqual(p.sfx.play('hit'), true);
  assert.strictEqual(p.sfx.play('hit'), true);
  assert.strictEqual(p.sfx.play('hit'), false, '上限を超えて鳴っている');

  p.advance(1001);                     // 1 秒経てばまた鳴る
  assert.strictEqual(p.sfx.play('hit'), true);
});

test('切っていれば鳴らない', () => {
  const { sfx } = player();
  sfx.setEnabled(false);
  assert.strictEqual(sfx.play('kill'), false);

  sfx.setEnabled(true);
  assert.strictEqual(sfx.play('kill'), true);
});

test('設定で最初から切っておける', () => {
  const { sfx } = player({ audio: { enabled: false } });
  assert.strictEqual(sfx.enabled, false);
  assert.strictEqual(sfx.play('kill'), false);
});

test('音量は 0〜1 に収める', () => {
  const { sfx } = player();
  assert.strictEqual(sfx.setVolume(0.5), 0.5);
  assert.strictEqual(sfx.setVolume(9), 1);
  assert.strictEqual(sfx.setVolume(-1), 0);
});

test('入 / 切を切り替えられる', () => {
  const { sfx } = player();
  assert.strictEqual(sfx.toggle(), false);
  assert.strictEqual(sfx.toggle(), true);
});

test('音を出せない環境でも落ちない', () => {
  const { sfx } = player();
  assert.strictEqual(sfx.supported, false, 'Node に AudioContext は無いはず');
  assert.doesNotThrow(() => sfx.play('gift'));
  assert.doesNotThrow(() => sfx.resume());
});

test('敵の種類ごとに撃破音の高さが決まっている', () => {
  const config = makeConfig();
  const pitches = config.enemies.types.map((type) => type.killPitch);

  assert.strictEqual(pitches.length, config.enemies.types.length);
  // 強い敵ほど低い音になっている
  for (let i = 1; i < pitches.length; i += 1) {
    assert.ok(pitches[i] < pitches[i - 1],
      `${config.enemies.types[i].id} の音が前の敵より低くない`);
  }
});
