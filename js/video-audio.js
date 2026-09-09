/**
 * video-audio.js - VIDEO BATTLE MODE のミキサー。
 *
 * **LIVE 版の js/audio.js には触りません。** あちらは「視聴者イベントに
 * 短い音を付ける」だけで足りますが、こちらは
 *
 *   - 武器ごとの射出音とヒット音を鳴らし分ける
 *   - 重要度で音量を変える (移動 < 拾う = 射出 < 命中 < 大ダメージ < 最終攻撃)
 *   - 短時間に重なる音を間引く (SHOTGUN / LASER)
 *   - 照射中はループを鳴らし続ける
 *   - 終盤ほど音を厚くする
 *   - 最後の一撃の前に一瞬だけ音を落とす
 *   - **録画にゲーム音をそのまま乗せる**
 *
 * まで要るので、別のミキサーにしてあります。
 *
 * 配線:
 *
 *   sfx   ──┐
 *           ├─→ master ─→ リミッター ─┬─→ スピーカー
 *   music ──┘ (duck)                   └─→ 録画用の MediaStream
 *
 * 音そのもの (AudioBuffer) は video-sound-bank.js が用意します。ここは
 * 「いつ・どのくらいの音量で鳴らすか」だけを持ちます。
 */
(function (global) {
  'use strict';

  function VideoAudio(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.VIDEO_CONFIG);
    if (!this.config) throw new Error('VideoAudio: config が渡されていません');

    this.settings = this.config.audio;
    this.now = options.now || function () { return Date.now(); };

    var Bank = options.SoundBank || (global.CB && global.CB.VideoSoundBank);
    this.bank = options.bank || (Bank ? new Bank({ config: this.config }) : null);

    this.enabled = true;
    this.master = this.settings.master;
    this.sfxVolume = this.settings.sfx;
    this.musicVolume = this.settings.music;

    /** 0〜1。戦況が進むほど 1 に近づき、効果音全体が少し厚くなります。 */
    this.intensity = 0;

    /** ブラウザに止められているか (最初の操作待ち)。 */
    this.blocked = false;
    this.supported = typeof global.AudioContext === 'function' ||
                     typeof global.webkitAudioContext === 'function';

    this.ctx = null;
    this.nodes = null;
    this._loops = {};           // key -> { source, gain, name }
    this._lastPlayed = {};      // 音の名前 -> 最後に鳴らした時刻
    this._recent = [];          // 1 秒あたりの上限を守るための記録
    this._hushUntil = 0;
    this._blockedHandlers = [];

    this.stats = { played: 0, throttled: 0 };
  }

  VideoAudio.prototype.onBlocked = function (handler) {
    this._blockedHandlers.push(handler);
    return this;
  };

  VideoAudio.prototype._setBlocked = function (blocked) {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    var self = this;
    this._blockedHandlers.slice().forEach(function (h) { h(blocked, self); });
  };

  // ------------------------------------------------------------- 配線

  VideoAudio.prototype._ensureContext = function () {
    if (this.ctx || !this.supported) return this.ctx;

    var Ctor = global.AudioContext || global.webkitAudioContext;
    try {
      this.ctx = new Ctor();
    } catch (err) {
      this.supported = false;
      return null;
    }

    var ctx = this.ctx;
    var master = ctx.createGain();
    var sfx = ctx.createGain();
    var music = ctx.createGain();
    var duck = ctx.createGain();

    /*
     * 出口のリミッター。大ダメージと最終攻撃は意図的に大きくしてあるので、
     * 何も挟まないと録画した音が割れます。潰すのではなく、飛び出たところ
     * だけを抑える設定にしてあります。
     */
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.16;

    sfx.connect(master);
    music.connect(duck);
    duck.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);

    // 録画用の出口。ここに繋いだ音だけが動画に入ります
    var stream = null;
    if (typeof ctx.createMediaStreamDestination === 'function') {
      stream = ctx.createMediaStreamDestination();
      limiter.connect(stream);
    }

    this.nodes = { master: master, sfx: sfx, music: music, duck: duck, limiter: limiter, stream: stream };
    this._applyGains();

    this._setBlocked(ctx.state === 'suspended');
    return ctx;
  };

  VideoAudio.prototype._applyGains = function () {
    if (!this.nodes) return;
    var on = this.enabled ? 1 : 0;
    this.nodes.master.gain.value = this.master * on;
    this.nodes.sfx.gain.value = this.sfxVolume * this._intensityScale();
    this.nodes.music.gain.value = this.musicVolume;
  };

  /** 終盤ほど厚くする倍率。 */
  VideoAudio.prototype._intensityScale = function () {
    var range = this.settings.intensity;
    return range.from + (range.to - range.from) * Math.max(0, Math.min(1, this.intensity));
  };

  /**
   * 音源を用意する。最初の操作より前に呼んでも構いません
   * (AudioContext が要るので、実際の読み込みは context ができてからです)。
   */
  VideoAudio.prototype.load = function () {
    var ctx = this._ensureContext();
    if (!ctx || !this.bank) return Promise.resolve(null);
    return this.bank.load(ctx);
  };

  /** 最初のクリックで呼びます。音源の用意もここで終わらせます。 */
  VideoAudio.prototype.resume = function () {
    var ctx = this._ensureContext();
    if (!ctx) return Promise.resolve(false);

    var self = this;
    var wake = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();

    return wake.then(function () {
      self._setBlocked(false);
      return self.load();
    }).then(function () { return true; })
      .catch(function () { self._setBlocked(true); return false; });
  };

  // ------------------------------------------------------------- 音量

  VideoAudio.prototype.setEnabled = function (enabled) {
    this.enabled = Boolean(enabled);
    this._applyGains();
    if (!this.enabled) this.stopAllLoops();
    return this.enabled;
  };

  function clamp01(value) {
    return Math.max(0, Math.min(Number(value) || 0, 1));
  }

  VideoAudio.prototype.setMasterVolume = function (v) {
    this.master = clamp01(v); this._applyGains(); return this.master;
  };
  VideoAudio.prototype.setSfxVolume = function (v) {
    this.sfxVolume = clamp01(v); this._applyGains(); return this.sfxVolume;
  };
  VideoAudio.prototype.setMusicVolume = function (v) {
    this.musicVolume = clamp01(v); this._applyGains(); return this.musicVolume;
  };

  /** 戦況の進み具合 (0〜1) を伝える。序盤は軽く、終盤は厚くなります。 */
  VideoAudio.prototype.setIntensity = function (value) {
    this.intensity = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.nodes) this.nodes.sfx.gain.value = this.sfxVolume * this._intensityScale();
    return this.intensity;
  };

  /**
   * その音を鳴らすときの音量。
   *
   * 重要度 (category) がそのまま音量になります。全部同じ音量にすると
   * 「何が起きたか」が音から分からなくなるので、ここで必ず差をつけます。
   */
  VideoAudio.prototype.gainFor = function (name, opts) {
    var def = this.bank ? this.bank.defOf(name) : this.settings.sounds[name];
    if (!def) return 0;
    opts = opts || {};

    var category = opts.category || def.category || 'hit';
    var base = this.settings.categories[category];
    if (base == null) base = this.settings.categories.hit;

    return base * (def.gain != null ? def.gain : 1) * (opts.gain != null ? opts.gain : 1);
  };

  // ----------------------------------------------------------- 間引き

  /**
   * 今この音を鳴らしてよいか。
   *
   * SHOTGUN の粒も LASER の照射も、そのまま鳴らすと 1 秒に何十発も重なって
   * ただの雑音になります。音ごとの最短間隔と、全体の 1 秒あたりの上限で
   * 抑えます (どちらも config 側の数字です)。
   */
  VideoAudio.prototype.shouldPlay = function (name, at) {
    if (!this.enabled) return false;

    var def = this.bank ? this.bank.defOf(name) : this.settings.sounds[name];
    if (!def) return false;

    var now = at != null ? at : this.now();
    var last = this._lastPlayed[name];
    if (last != null && now - last < (def.minIntervalMs || 0)) return false;

    while (this._recent.length && now - this._recent[0] >= 1000) this._recent.shift();
    if (this._recent.length >= this.settings.maxPerSecond) return false;

    return true;
  };

  /**
   * 鳴らす。鳴らしたら true。
   *
   * @param {string} name  config.audio.sounds の名前
   * @param {object} [opts] { category, gain, rate, at, force }
   */
  VideoAudio.prototype.play = function (name, opts) {
    opts = opts || {};
    var now = opts.at != null ? opts.at : this.now();

    // 決着の音だけは間引きません。これを捨てると勝敗が音で分からなくなります
    if (!opts.force && !this.shouldPlay(name, now)) { this.stats.throttled += 1; return false; }
    if (opts.force && !this.enabled) return false;

    this._lastPlayed[name] = now;
    this._recent.push(now);
    this.stats.played += 1;

    var ctx = this._ensureContext();
    if (!ctx || !this.bank) return true;      // 音の出ない環境でも判断だけは同じに保つ
    if (ctx.state === 'suspended') { this._setBlocked(true); return true; }

    var buffer = this.bank.buffers[name];
    if (!buffer) return true;

    var gain = this.gainFor(name, opts);
    this._spawn(buffer, gain, opts.rate || 1, ctx.currentTime);

    var category = opts.category || (this.bank.defOf(name) || {}).category;
    if (category === 'big' || category === 'final') this._duck(gain);
    return true;
  };

  VideoAudio.prototype._spawn = function (buffer, gain, rate, at) {
    var ctx = this.ctx;
    var source = ctx.createBufferSource();
    var node = ctx.createGain();

    source.buffer = buffer;
    source.playbackRate.value = rate;
    node.gain.value = gain;

    source.connect(node);
    node.connect(this.nodes.sfx);
    source.start(at);
    return source;
  };

  /**
   * BGM を入れていても効果音が埋もれないように、大きい音の瞬間だけ
   * BGM を下げます。
   */
  VideoAudio.prototype._duck = function (amount) {
    if (!this.nodes) return;
    var duck = this.settings.duck;
    var gain = this.nodes.duck.gain;
    var t = this.ctx.currentTime;
    var depth = 1 - duck.amount * Math.min(1, amount);

    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(depth, t + duck.attackMs / 1000);
    gain.linearRampToValueAtTime(1, t + duck.attackMs / 1000 + duck.releaseMs / 1000);
  };

  /**
   * 一瞬だけ音を落とす。
   *
   * 「最後の一撃」の直前に入れます。ここで音が引くぶん、次に来る一撃が
   * 実際の音量以上に大きく聞こえます。
   */
  VideoAudio.prototype.hush = function (ms, level) {
    var duration = (ms != null ? ms : this.config.hp.hushMs) / 1000;
    var depth = level != null ? level : this.config.hp.hushLevel;
    this._hushUntil = this.now() + duration * 1000;

    if (!this.nodes) return duration;
    var gain = this.nodes.sfx.gain;
    var t = this.ctx.currentTime;
    var full = this.sfxVolume * this._intensityScale();

    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(full * depth, t + 0.06);
    gain.setValueAtTime(full * depth, t + duration);
    gain.linearRampToValueAtTime(full, t + duration + 0.05);
    return duration;
  };

  /** 今、無音の最中か。 */
  VideoAudio.prototype.hushed = function (at) {
    return (at != null ? at : this.now()) < this._hushUntil;
  };

  // --------------------------------------------------------- ループ音

  /**
   * 鳴らし続ける音を始める (LASER の照射中など)。
   * 同じ key で 2 回呼んでも 1 つしか鳴りません。
   */
  VideoAudio.prototype.startLoop = function (name, key) {
    key = key || name;
    if (this._loops[key]) return false;
    if (!this.enabled) return false;

    var ctx = this._ensureContext();
    if (!ctx || !this.bank) { this._loops[key] = { name: name, silent: true }; return true; }

    var buffer = this.bank.buffers[name];
    if (!buffer) { this._loops[key] = { name: name, silent: true }; return true; }

    var source = ctx.createBufferSource();
    var gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.0001;
    gain.gain.linearRampToValueAtTime(this.gainFor(name), ctx.currentTime + 0.05);

    source.connect(gain);
    gain.connect(this.nodes.sfx);
    source.start(ctx.currentTime);

    this._loops[key] = { source: source, gain: gain, name: name };
    return true;
  };

  /** ループ音を止める。少しだけ余韻を残して切ります (ブツ切りを避けるため)。 */
  VideoAudio.prototype.stopLoop = function (key) {
    var loop = this._loops[key];
    if (!loop) return false;
    delete this._loops[key];
    if (loop.silent || !this.ctx) return true;

    var t = this.ctx.currentTime;
    loop.gain.gain.cancelScheduledValues(t);
    loop.gain.gain.setValueAtTime(loop.gain.gain.value, t);
    loop.gain.gain.linearRampToValueAtTime(0.0001, t + 0.06);
    try { loop.source.stop(t + 0.1); } catch (err) { /* すでに止まっている */ }
    return true;
  };

  VideoAudio.prototype.loopPlaying = function (key) {
    return Boolean(this._loops[key]);
  };

  VideoAudio.prototype.stopAllLoops = function () {
    var self = this;
    Object.keys(this._loops).forEach(function (key) { self.stopLoop(key); });
  };

  // ----------------------------------------------------------- BGM

  /**
   * BGM を差し込む。<audio> をそのまま music バスに繋ぐので、
   * 効果音と同じミキサーを通り、録画にもそのまま乗ります。
   */
  VideoAudio.prototype.attachMusic = function (element) {
    var ctx = this._ensureContext();
    if (!ctx || !element || this._musicSource) return null;
    try {
      this._musicSource = ctx.createMediaElementSource(element);
      this._musicSource.connect(this.nodes.music);
    } catch (err) {
      this._musicSource = null;
    }
    return this._musicSource;
  };

  // --------------------------------------------------------- 録画用

  /** 録画に乗せる音のトラック。 */
  VideoAudio.prototype.streamTracks = function () {
    this._ensureContext();
    if (!this.nodes || !this.nodes.stream) return [];
    return this.nodes.stream.stream.getAudioTracks();
  };

  global.CB = global.CB || {};
  global.CB.VideoAudio = VideoAudio;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoAudio: VideoAudio };
  }
})(typeof window !== 'undefined' ? window : this);
