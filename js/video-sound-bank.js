/**
 * video-sound-bank.js - VIDEO BATTLE MODE の音源。
 *
 * 音は 2 通りで手に入ります。
 *
 *   1. sounds/hammer-shot.wav … 置いてあればこれを読みます
 *   2. 合成                   … 置いていなければレシピから作ります
 *
 * どちらも最後は同じ AudioBuffer になるので、鳴らす側 (video-audio.js) は
 * 「ファイルなのか合成なのか」を知りません。**あとから音を差し替えたいときは
 * sounds/ に同じ名前のファイルを置くだけ**で、コードは変えません。
 *
 * 合成はここでサンプル単位に計算します (OfflineAudioContext を使いません)。
 * そのほうが波形を細かく作れて、Node からも同じ結果を確かめられるためです。
 * 乱数は種つきなので、同じレシピからは毎回まったく同じ音が出ます。
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /** 種つきの乱数 (線形合同法)。雑音を毎回同じ形にするために使います。 */
  function seeded(seed) {
    var state = (seed >>> 0) || 1;
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296 * 2 - 1;
    };
  }

  /** freq の書き方 (数値 / [from, to]) をそろえる。 */
  function range(value, fallback) {
    if (value == null) return [fallback, fallback];
    if (typeof value === 'number') return [value, value];
    return [value[0], value.length > 1 ? value[1] : value[0]];
  }

  /** 0〜1 の進み具合から今の値を出す。exp は音程らしく聞こえます。 */
  function glide(from, to, t, mode) {
    if (from === to) return from;
    if (mode === 'lin') return from + (to - from) * t;
    var a = Math.max(1e-4, from);
    var b = Math.max(1e-4, to);
    return a * Math.pow(b / a, t);
  }

  /**
   * 音量の形。
   *
   *   attack で立ち上がり、あとは減衰します。release:'none' は減衰しません
   *   (繰り返して鳴らす laser-loop 用。減衰すると継ぎ目で音が途切れます)。
   */
  function envelope(t, dur, attack, release) {
    if (release === 'none') {
      // 継ぎ目を作らないため、増減しない板 (attack だけ丸める)
      if (attack > 0 && t < attack) return t / attack;
      return 1;
    }
    if (attack > 0 && t < attack) return t / attack;
    var rest = dur - attack;
    if (rest <= 0) return 0;
    var p = (t - attack) / rest;
    if (p >= 1) return 0;
    return release === 'lin' ? 1 - p : Math.pow(1 - p, 2.6) * (1 - p * 0.2);
  }

  /** 波形 1 サンプル。phase は 0〜1。 */
  function wave(type, phase, noise) {
    switch (type) {
      case 'square': return phase < 0.5 ? 1 : -1;
      case 'saw': return phase * 2 - 1;
      case 'triangle': return 1 - 4 * Math.abs(Math.round(phase) - phase);
      case 'noise': return noise();
      default: return Math.sin(phase * TAU);
    }
  }

  /**
   * 一次のローパス / ハイパス、その 2 つを重ねたバンドパス。
   *
   * BiquadFilter を書き起こすほどの精度は要りません。ここで欲しいのは
   * 「高いところを削って重くする」「低いところを削って軽くする」だけです。
   */
  function makeFilter(spec, sampleRate) {
    if (!spec) return null;
    var freq = range(spec.freq, 1000);
    var type = spec.type || 'lp';
    var lp = 0, hp = 0, prev = 0;

    return function (sample, t) {
      var f = glide(freq[0], freq[1], t, 'exp');
      // 一次フィルタの係数。サンプリング周波数で正規化します
      var k = 1 - Math.exp(-TAU * Math.min(f, sampleRate * 0.45) / sampleRate);

      if (type === 'hp') {
        lp += (sample - lp) * k;
        return sample - lp;
      }
      if (type === 'bp') {
        // 低い側を削ってから高い側を削ります (帯だけ残る)
        hp += (sample - hp) * k * 0.35;
        var band = sample - hp;
        lp += (band - lp) * Math.min(1, k * 2.2);
        prev = lp;
        return prev * (1 + (spec.q || 1) * 0.35);
      }
      lp += (sample - lp) * k;
      return lp;
    };
  }

  /**
   * レシピ 1 つぶんの波形を作る。
   *
   * @returns {Float32Array} -1〜1 に収めた音の中身
   */
  function render(recipe, sampleRate) {
    sampleRate = sampleRate || 44100;
    var duration = Math.max(0.01, recipe.duration || 0.3);
    var seamless = Boolean(recipe.seamless);

    /*
     * 繰り返して鳴らす音は **2 周ぶん作って後半だけを使います**。
     *
     * フィルタは状態を持っていて、鳴り始めの数ミリ秒は「まだ効いていない」
     * 音になります。そのまま繰り返すと、1 周するたびにその立ち上がりが
     * 挟まって「プツッ」と鳴ります。1 周ぶん空回ししてから切り出せば、
     * 始まりも終わりも同じ定常状態になり、継ぎ目が消えます。
     */
    var total = seamless ? duration * 2 : duration;
    var length = Math.max(1, Math.round(total * sampleRate));
    var out = new Float32Array(length);
    var layers = recipe.layers || [];

    for (var li = 0; li < layers.length; li += 1) {
      var layer = layers[li];
      var delay = Math.round((layer.delay || 0) * sampleRate);
      var dur = seamless ? total : Math.min(layer.dur || duration, duration - (layer.delay || 0));
      if (dur <= 0) continue;

      var count = Math.round(dur * sampleRate);
      var freq = range(layer.freq, 440);
      var sweep = layer.sweep || 'exp';
      var attack = Math.min(layer.attack != null ? layer.attack : 0.004, dur * 0.9);
      var release = layer.release || 'exp';
      var gain = layer.gain != null ? layer.gain : 0.5;
      var drive = layer.drive || 0;
      var vibrato = layer.vibrato;
      var noise = seeded(1013 + li * 7919);
      var filter = makeFilter(layer.filter, sampleRate);
      var phase = 0;

      /*
       * 繰り返して鳴らす音 (seamless) では、周波数が長さのちょうど整数倍の
       * 周期に収まるように丸めます。半端だと繰り返しの継ぎ目で「プツッ」と
       * 鳴ります。
       */
      var f0 = freq[0];
      if (seamless && freq[0] === freq[1]) {
        // 1 周のちょうど整数倍の周期に丸めます (半端だと繰り返しで段差が出ます)
        f0 = Math.max(1, Math.round(freq[0] * duration)) / duration;
      }

      for (var i = 0; i < count; i += 1) {
        var index = delay + i;
        if (index >= length) break;

        var t = i / sampleRate;
        var progress = count > 1 ? i / (count - 1) : 1;
        var f = freq[0] === freq[1] ? f0 : glide(freq[0], freq[1], progress, sweep);
        if (vibrato) f *= 1 + Math.sin(t * TAU * vibrato.rate) * vibrato.depth;

        phase += f / sampleRate;
        if (phase >= 1) phase -= Math.floor(phase);

        var sample = wave(layer.type, phase, noise);
        if (filter) sample = filter(sample, progress);
        if (drive) sample = Math.tanh(sample * drive) / Math.tanh(drive) * 1.15;

        out[index] += sample * gain * envelope(t, dur, attack, release);
      }
    }

    if (seamless) out = out.slice(length - Math.round(duration * sampleRate));
    return normalize(out, seamless ? 0.7 : 0.94);
  }

  /**
   * 全体を目標の大きさへそろえる。
   *
   * 層を足すと 1 を超えて割れるので、必ず通します。音ごとの相対的な
   * 大きさは video-audio.js の categories で決めるので、ここでは
   * 「割れないこと」だけを見ます。
   */
  function normalize(data, peak) {
    var max = 0;
    for (var i = 0; i < data.length; i += 1) {
      var v = data[i] < 0 ? -data[i] : data[i];
      if (v > max) max = v;
    }
    if (max <= 0) return data;
    var k = peak / max;
    for (var j = 0; j < data.length; j += 1) data[j] *= k;
    return data;
  }

  // ------------------------------------------------------------- 本体

  /**
   * @param {object} options { config, fetch }
   */
  function VideoSoundBank(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.VIDEO_CONFIG);
    if (!this.config) throw new Error('VideoSoundBank: config が渡されていません');

    this.settings = this.config.audio;
    this.fetch = options.fetch || (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);

    /** 名前 -> AudioBuffer。 */
    this.buffers = {};
    /** 名前 -> 'file' | 'synth'。どこから来た音かを画面に出すために持ちます。 */
    this.sources = {};
    this.ready = false;
  }

  VideoSoundBank.render = render;

  /** その名前の設定 (無ければ null)。 */
  VideoSoundBank.prototype.defOf = function (name) {
    return this.settings.sounds[name] || null;
  };

  /** 音源ファイルの置き場所。 */
  VideoSoundBank.prototype.urlOf = function (name) {
    var def = this.defOf(name);
    if (!def || !def.file) return null;
    return (this.settings.dir || '') + def.file;
  };

  /**
   * 全部の音を用意する。
   *
   * ファイルが無くても失敗しません (合成に落ちるだけ)。1 つでも読めなければ
   * 音が出ない、という作りにはしません。配信中に音が消えるのが一番困ります。
   */
  VideoSoundBank.prototype.load = function (ctx) {
    var self = this;
    var names = Object.keys(this.settings.sounds);

    return Promise.all(names.map(function (name) {
      return self._loadOne(ctx, name);
    })).then(function () {
      self.ready = true;
      return self;
    });
  };

  VideoSoundBank.prototype._loadOne = function (ctx, name) {
    var self = this;
    var def = this.defOf(name);

    return this._fetchFile(ctx, name).then(function (buffer) {
      if (buffer) {
        self.buffers[name] = buffer;
        self.sources[name] = 'file';
        return buffer;
      }
      var synth = self.synthesize(ctx, def);
      self.buffers[name] = synth;
      self.sources[name] = 'synth';
      return synth;
    });
  };

  /** ファイルを読む。無い / 読めない / 壊れている、はすべて null で返します。 */
  VideoSoundBank.prototype._fetchFile = function (ctx, name) {
    var url = this.urlOf(name);
    if (!url || !this.fetch || !ctx) return Promise.resolve(null);

    /*
     * file:// で開いているときは、そもそもファイルを読めません
     * (ブラウザが同一生成元の規則で止めます)。取りに行くだけ無駄なうえ、
     * 音の数だけ赤いエラーが出て、本当の不具合が埋もれます。
     */
    if (global.location && global.location.protocol === 'file:') return Promise.resolve(null);

    return this.fetch(url).then(function (res) {
      if (!res || !res.ok) return null;
      return res.arrayBuffer();
    }).then(function (raw) {
      if (!raw || !raw.byteLength) return null;
      return new Promise(function (resolve) {
        // decodeAudioData は古い書き方 (callback) しか受け取らない環境があります
        var done = false;
        try {
          var promise = ctx.decodeAudioData(raw, function (buffer) {
            done = true; resolve(buffer);
          }, function () { done = true; resolve(null); });
          if (promise && typeof promise.then === 'function') {
            promise.then(function (buffer) { if (!done) resolve(buffer); },
                         function () { if (!done) resolve(null); });
          }
        } catch (err) { resolve(null); }
      });
    }).catch(function () { return null; });
  };

  /** レシピから AudioBuffer を作る。 */
  VideoSoundBank.prototype.synthesize = function (ctx, def) {
    if (!def || !def.synth || !ctx) return null;
    var data = render(def.synth, ctx.sampleRate);
    var buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    return buffer;
  };

  /** 用意できた音の内訳 (画面に出す用)。 */
  VideoSoundBank.prototype.summary = function () {
    var counts = { file: 0, synth: 0, missing: 0 };
    var self = this;
    Object.keys(this.settings.sounds).forEach(function (name) {
      if (!self.buffers[name]) counts.missing += 1;
      else counts[self.sources[name]] += 1;
    });
    return counts;
  };

  global.CB = global.CB || {};
  global.CB.VideoSoundBank = VideoSoundBank;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoSoundBank: VideoSoundBank, render: render };
  }
})(typeof window !== 'undefined' ? window : this);
