/**
 * VIDEO BATTLE MODE の音のテスト。
 *
 * 実際の音 (WebAudio) はブラウザでしか鳴らないので、ここで見るのは
 *
 *   - 重要度どおりの音量になっているか
 *   - 重なりすぎを間引けているか
 *   - 決着の音だけは間引かれずに必ず鳴るか
 *   - 合成した波形が割れていないか / ループの継ぎ目が繋がるか
 *   - 武器ごとに射出音とヒット音が揃っているか
 *
 * です。
 */
const test = require('node:test');
const assert = require('node:assert');
const { VideoAudio } = require('../js/video-audio.js');
const { VideoSoundBank, render } = require('../js/video-sound-bank.js');
const { makeConfig } = require('./video-helpers.js');

function mixer(overrides) {
  let clock = 1000;
  const config = makeConfig(overrides);
  const audio = new VideoAudio({ config, now: () => clock });
  return { audio, config, advance(ms) { clock += ms; return clock; }, at: () => clock };
}

// ------------------------------------------------------------ 音量

test('重要度の順に音が大きくなる', () => {
  const { audio } = mixer();
  const move = audio.gainFor('bounce');
  const pickup = audio.gainFor('item-pickup');
  const shot = audio.gainFor('pistol-shot');
  const hit = audio.gainFor('pistol-hit');
  const big = audio.gainFor('hammer-hit');
  const final = audio.gainFor('ko-impact');

  assert.ok(move < pickup, '移動音がアイテム音より大きい');
  assert.ok(pickup <= shot * 1.2, 'アイテム音と射出音が同程度でない');
  assert.ok(shot < hit, '射出音がヒット音以上に大きい');
  assert.ok(hit < big, '大ダメージが通常のヒットと同じ');
  assert.ok(big < final, '最終攻撃が一番大きくない');
});

test('INJECTION NEEDLE は他の武器より静か', () => {
  const { audio } = mixer();
  assert.ok(audio.gainFor('needle-shot') < audio.gainFor('pistol-shot'));
  assert.ok(audio.gainFor('needle-shot') < audio.gainFor('sword-shot'));
  assert.ok(audio.gainFor('needle-shot') < audio.gainFor('shotgun-shot'));
});

test('音量は 0〜1 に収まる', () => {
  const { audio } = mixer();
  assert.strictEqual(audio.setMasterVolume(2), 1);
  assert.strictEqual(audio.setSfxVolume(-1), 0);
  assert.strictEqual(audio.setMusicVolume(0.3), 0.3);
});

test('終盤ほど効果音が厚くなる', () => {
  const { audio, config } = mixer();
  audio.setIntensity(0);
  const early = audio._intensityScale();
  audio.setIntensity(1);
  const late = audio._intensityScale();

  assert.strictEqual(early, config.audio.intensity.from);
  assert.strictEqual(late, config.audio.intensity.to);
  assert.ok(late > early);
});

// ---------------------------------------------------------- 間引き

test('同じ音は最短間隔まで繰り返さない', () => {
  const m = mixer({ audio: { sounds: { 'sword-hit': { minIntervalMs: 100 } } } });
  assert.strictEqual(m.audio.play('sword-hit', { at: m.at() }), true);
  assert.strictEqual(m.audio.play('sword-hit', { at: m.at() }), false, '連続で鳴っている');

  m.advance(60);
  assert.strictEqual(m.audio.play('sword-hit', { at: m.at() }), false);
  m.advance(50);
  assert.strictEqual(m.audio.play('sword-hit', { at: m.at() }), true);
});

test('SHOTGUN の粒が一度に鳴りすぎない', () => {
  const m = mixer();
  let played = 0;
  // 6 粒が 30ms のうちに当たった場合を模します
  for (let i = 0; i < 6; i += 1) {
    if (m.audio.play('shotgun-hit', { at: m.at() })) played += 1;
    m.advance(5);
  }
  assert.ok(played < 6, '粒の数だけ鳴っている');
  assert.ok(played >= 1, '一度も鳴っていない');
});

test('1 秒あたりの上限を超えたら鳴らさない', () => {
  const m = mixer({ audio: { maxPerSecond: 3, sounds: { bounce: { minIntervalMs: 0 } } } });
  assert.strictEqual(m.audio.play('bounce', { at: m.at() }), true);
  assert.strictEqual(m.audio.play('bounce', { at: m.at() }), true);
  assert.strictEqual(m.audio.play('bounce', { at: m.at() }), true);
  assert.strictEqual(m.audio.play('bounce', { at: m.at() }), false);

  m.advance(1001);
  assert.strictEqual(m.audio.play('bounce', { at: m.at() }), true);
});

test('決着の音は間引かれない', () => {
  const m = mixer({ audio: { maxPerSecond: 1 } });
  m.audio.play('bounce', { at: m.at() });
  assert.strictEqual(m.audio.play('victory', { at: m.at() }), false, 'force なしでは間引かれるはず');
  assert.strictEqual(m.audio.play('victory', { at: m.at(), force: true }), true);
});

test('知らない名前は鳴らさない', () => {
  const m = mixer();
  assert.strictEqual(m.audio.play('nothing-like-this', { at: m.at() }), false);
});

test('音を切っている間は鳴らない', () => {
  const m = mixer();
  m.audio.setEnabled(false);
  assert.strictEqual(m.audio.play('sword-hit', { at: m.at() }), false);
  assert.strictEqual(m.audio.play('victory', { at: m.at(), force: true }), false);
});

// ------------------------------------------------------------ ループ

test('ループ音は二重に鳴らず、止められる', () => {
  const m = mixer();
  assert.strictEqual(m.audio.startLoop('laser-loop', 'beam:red'), true);
  assert.strictEqual(m.audio.startLoop('laser-loop', 'beam:red'), false, '二重に鳴っている');
  assert.strictEqual(m.audio.loopPlaying('beam:red'), true);

  m.audio.stopLoop('beam:red');
  assert.strictEqual(m.audio.loopPlaying('beam:red'), false);
});

test('全部のループをまとめて止められる', () => {
  const m = mixer();
  m.audio.startLoop('laser-loop', 'beam:red');
  m.audio.startLoop('laser-loop', 'beam:blue');
  m.audio.stopAllLoops();
  assert.strictEqual(m.audio.loopPlaying('beam:red'), false);
  assert.strictEqual(m.audio.loopPlaying('beam:blue'), false);
});

test('短い無音を挟める', () => {
  const m = mixer();
  m.audio.hush(400, 0.1);
  assert.strictEqual(m.audio.hushed(m.at()), true);
  m.advance(500);
  assert.strictEqual(m.audio.hushed(m.at()), false);
});

// ------------------------------------------------------------ 音源

test('武器ごとに射出音とヒット音が揃っている', () => {
  const config = makeConfig();
  config.weapons.order.forEach((id) => {
    const weapon = config.weapons[id];
    assert.ok(weapon.sfx.shot, `${id} に射出音がない`);
    assert.ok(weapon.sfx.hit, `${id} にヒット音がない`);
    assert.ok(config.audio.sounds[weapon.sfx.shot], `${weapon.sfx.shot} の音源がない`);
    assert.ok(config.audio.sounds[weapon.sfx.hit], `${weapon.sfx.hit} の音源がない`);
  });

  // LASER だけは開始 / 継続 / 終了の 3 つ
  const laser = config.weapons.laser.sfx;
  ['shot', 'loop', 'hit', 'end'].forEach((key) => {
    assert.ok(config.audio.sounds[laser[key]], `laser.${key} の音源がない`);
  });
});

test('どの音もファイルで差し替えられる (名前とファイルが 1 対 1)', () => {
  const config = makeConfig();
  const files = new Set();
  Object.keys(config.audio.sounds).forEach((name) => {
    const def = config.audio.sounds[name];
    assert.ok(def.file, `${name} に差し替え用のファイル名がない`);
    assert.ok(def.synth, `${name} に合成のレシピがない (ファイルが無いと鳴らなくなる)`);
    assert.ok(!files.has(def.file), `${def.file} が重複している`);
    files.add(def.file);
  });
});

test('音源が読めない環境でも合成に落ちる', async () => {
  const config = makeConfig();
  const bank = new VideoSoundBank({ config, fetch: () => Promise.reject(new Error('no network')) });
  const ctx = {
    sampleRate: 44100,
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    }
  };

  await bank.load(ctx);
  assert.strictEqual(bank.ready, true);
  assert.strictEqual(bank.summary().file, 0);
  assert.strictEqual(bank.summary().synth, Object.keys(config.audio.sounds).length);
  assert.strictEqual(bank.urlOf('hammer-hit'), 'sounds/hammer-hit.wav');
});

// ------------------------------------------------------------ 波形

test('合成した波形が割れていない', () => {
  const config = makeConfig();
  Object.keys(config.audio.sounds).forEach((name) => {
    const data = render(config.audio.sounds[name].synth, 22050);
    assert.ok(data.length > 0, `${name} が空`);

    let peak = 0;
    let energy = 0;
    for (let i = 0; i < data.length; i += 1) {
      assert.ok(Number.isFinite(data[i]), `${name} に数でない値が入っている`);
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      energy += v;
    }
    assert.ok(peak <= 1, `${name} が 1 を超えている (割れる)`);
    assert.ok(peak > 0.3, `${name} が小さすぎる`);
    assert.ok(energy / data.length > 0.001, `${name} がほぼ無音`);
  });
});

test('ループ音は繋ぎ目で途切れない', () => {
  const config = makeConfig();
  const data = render(config.audio.sounds['laser-loop'].synth, 44100);

  // 繰り返しの継ぎ目 (最後 -> 最初) の段差が、音の中の一番大きな段差より
  // 小さいこと。ここが大きいと 0.5 秒ごとに「プツッ」と鳴ります
  let maxJump = 0;
  for (let i = 1; i < data.length; i += 1) {
    const jump = Math.abs(data[i] - data[i - 1]);
    if (jump > maxJump) maxJump = jump;
  }
  const seam = Math.abs(data[0] - data[data.length - 1]);
  assert.ok(seam <= maxJump, `繋ぎ目で段差がある (${seam.toFixed(3)} > ${maxJump.toFixed(3)})`);

  // 鳴り始めと鳴り終わりの音量がそろっていること
  function rms(from, to) {
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += data[i] * data[i];
    return Math.sqrt(sum / (to - from));
  }
  assert.ok(Math.abs(rms(0, 400) - rms(data.length - 400, data.length)) < 0.08, '継ぎ目で音量が変わる');

  // 最後まで鳴り続けていること (減衰しきっていたら「継続音」になりません)
  let late = 0;
  for (let i = data.length - 2000; i < data.length; i += 1) late += Math.abs(data[i]);
  assert.ok(late / 2000 > 0.05, '終わりで消えている');
});

test('武器ごとに音が違う', () => {
  const config = makeConfig();
  const shots = ['hammer-shot', 'sword-shot', 'needle-shot', 'pistol-shot', 'shotgun-shot', 'laser-start'];
  const signatures = shots.map((name) => {
    const data = render(config.audio.sounds[name].synth, 22050);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += Math.abs(data[i]);
    // 長さと平均の大きさが両方同じ音は、聞いても区別がつきません
    return data.length + ':' + (sum / data.length).toFixed(3);
  });
  assert.strictEqual(new Set(signatures).size, shots.length, '同じ音になっている武器がある');
});

test('LIVE 版の音の設定は別物のまま', () => {
  const { CONFIG } = require('../js/config.js');
  const { VIDEO_CONFIG } = require('../js/video-config.js');
  assert.ok(CONFIG.audio.sfx.kill, 'LIVE 版の音が消えている');
  assert.strictEqual(VIDEO_CONFIG.audio.sfx, 0.9, '動画モードは sfx を音量として持つ');
  assert.ok(!CONFIG.audio.sounds, 'LIVE 版に動画モードの音源が混ざっている');
});
