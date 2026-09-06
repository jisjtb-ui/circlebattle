/**
 * audio.js - 効果音。
 *
 * 音は WebAudio でその場で作ります。mp3 も wav も置きません。
 * ファイルが無ければ「音が鳴らない」で詰まることも、配信のたびに
 * 素材を配る必要もないためです。
 *
 * 鳴らす中身は config.audio.sfx に書いてあります。ここにあるのは
 * 「いつ鳴らすか (間引き)」と「どう鳴らすか (合成)」だけで、
 * 「何が起きたら鳴らすか」は main.js が決めます。
 *
 * ブラウザは操作前の自動再生を止めるので、最初のクリックまでは
 * blocked が true になります。画面はそれをバッジで知らせるだけで、
 * ゲームの進行には影響しません。
 */
(function (global) {
  'use strict';

  function SfxPlayer(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.CONFIG);
    if (!this.config) throw new Error('SfxPlayer: config が渡されていません');

    this.settings = this.config.audio;
    this.now = options.now || function () { return Date.now(); };

    this.enabled = this.settings.enabled !== false;
    this.volume = this.settings.volume;

    /** ブラウザに止められているか (最初の操作待ち)。 */
    this.blocked = false;
    /** 音を出せる環境か (Node やテストでは false)。 */
    this.supported = typeof global.AudioContext === 'function' ||
                     typeof global.webkitAudioContext === 'function';

    this.ctx = null;
    this.master = null;
    this._noise = null;
    this._lastPlayed = {};      // 音の名前 -> 最後に鳴らした時刻
    this._recent = [];          // 1 秒あたりの上限を守るための記録
    this._blockedHandlers = [];

    this.stats = { played: 0, throttled: 0 };
  }

  /** 「操作待ちで鳴らせない」状態が変わったときに呼ばれる。 */
  SfxPlayer.prototype.onBlocked = function (handler) {
    this._blockedHandlers.push(handler);
    return this;
  };

  SfxPlayer.prototype._setBlocked = function (blocked) {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    var self = this;
    this._blockedHandlers.slice().forEach(function (handler) { handler(blocked, self); });
  };

  // ------------------------------------------------------------- context

  SfxPlayer.prototype._ensureContext = function () {
    if (this.ctx || !this.supported) return this.ctx;

    var Ctor = global.AudioContext || global.webkitAudioContext;
    try {
      this.ctx = new Ctor();
    } catch (err) {
      this.supported = false;
      return null;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this._setBlocked(this.ctx.state === 'suspended');
    return this.ctx;
  };

  /**
   * 止められていた音を鳴らせるようにする。
   * 最初のクリック / キー操作で呼びます。
   */
  SfxPlayer.prototype.resume = function () {
    var ctx = this._ensureContext();
    if (!ctx) return Promise.resolve(false);

    var self = this;
    if (ctx.state !== 'suspended') { this._setBlocked(false); return Promise.resolve(true); }

    return ctx.resume().then(function () {
      self._setBlocked(false);
      return true;
    }).catch(function () {
      self._setBlocked(true);
      return false;
    });
  };

  SfxPlayer.prototype.setEnabled = function (enabled) {
    this.enabled = Boolean(enabled);
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
    return this.enabled;
  };

  SfxPlayer.prototype.toggle = function () {
    return this.setEnabled(!this.enabled);
  };

  SfxPlayer.prototype.setVolume = function (volume) {
    this.volume = Math.max(0, Math.min(Number(volume) || 0, 1));
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
    return this.volume;
  };

  // ------------------------------------------------------------ 間引き

  /**
   * 今この音を鳴らしてよいか。
   *
   * 撃破もダメージも 1 秒に何十回も起きるので、そのまま鳴らすと
   * 音が潰れて何も聞き取れなくなります。音ごとの最短間隔と、
   * 全体の 1 秒あたりの上限の 2 つで抑えます。
   */
  SfxPlayer.prototype.shouldPlay = function (name, at) {
    if (!this.enabled) return false;

    var def = this.settings.sfx[name];
    if (!def) return false;

    var now = at != null ? at : this.now();
    var last = this._lastPlayed[name];
    if (last != null && now - last < (def.minIntervalMs || 0)) return false;

    // 直近 1 秒に鳴らした数を数える
    while (this._recent.length && now - this._recent[0] >= 1000) this._recent.shift();
    if (this._recent.length >= this.settings.maxPerSecond) return false;

    return true;
  };

  /**
   * 鳴らす。鳴らしたら true。
   *
   * @param {string} name    config.audio.sfx の名前
   * @param {object} [opts]  { pitch, at }
   */
  SfxPlayer.prototype.play = function (name, opts) {
    opts = opts || {};
    var now = opts.at != null ? opts.at : this.now();

    if (!this.shouldPlay(name, now)) { this.stats.throttled += 1; return false; }

    this._lastPlayed[name] = now;
    this._recent.push(now);
    this.stats.played += 1;

    // 音を出せない環境 (Node / テスト) でも、間引きの判断だけは同じに保つ
    var ctx = this._ensureContext();
    if (!ctx) return true;
    if (ctx.state === 'suspended') { this._setBlocked(true); return true; }

    this._render(this.settings.sfx[name], ctx.currentTime, Number(opts.pitch) || 1);
    return true;
  };

  // ------------------------------------------------------------- 合成

  SfxPlayer.prototype._render = function (def, at, pitch) {
    if (def.kind === 'sequence') {
      for (var i = 0; i < def.steps.length; i += 1) {
        var step = def.steps[i];
        this._render(step, at + (step.delay || 0), pitch);
      }
      return;
    }
    if (def.kind === 'noise') this._noiseBurst(def, at, pitch);
    else this._tone(def, at, pitch);
  };

  /** 音程のある短い音。from -> to へ滑らせると「ピュン」「ドーン」になります。 */
  SfxPlayer.prototype._tone = function (def, at, pitch) {
    var ctx = this.ctx;
    var duration = def.duration || 0.1;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = def.wave || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, def.from * pitch), at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, (def.to || def.from) * pitch), at + duration);

    // exponentialRamp は 0 を扱えないので、聞こえない小さな値から始めます
    var peak = Math.max(0.0002, def.gain || 0.2);
    var attack = Math.min(def.attack || 0.008, duration / 2);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  };

  /** 「バシッ」という当たる音。周波数を持たない雑音を帯域で削って作ります。 */
  SfxPlayer.prototype._noiseBurst = function (def, at, pitch) {
    var ctx = this.ctx;
    var duration = def.duration || 0.05;

    if (!this._noise) {
      // 1 秒ぶんの雑音を 1 回だけ作って使い回す
      var buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this._noise = buffer;
    }

    var source = ctx.createBufferSource();
    source.buffer = this._noise;
    source.loop = true;

    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = Math.max(60, (def.freq || 1200) * pitch);
    filter.Q.value = def.q || 1;

    var gain = ctx.createGain();
    var peak = Math.max(0.0002, def.gain || 0.15);
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(at);
    source.stop(at + duration + 0.02);
  };

  global.CB = global.CB || {};
  global.CB.SfxPlayer = SfxPlayer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SfxPlayer: SfxPlayer };
  }
})(typeof window !== 'undefined' ? window : this);
