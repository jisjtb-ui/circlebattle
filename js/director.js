/**
 * director.js - 「次に何か起きそう」を作る層。
 *
 * 敵の自動生成だけだと、5 分見ても 30 分見ても同じ画面になります。
 * ここが一定時間ごとに WAVE を進め、ときどき特殊イベント
 * (BOSS / SWARM / RARE) を起こして、区切りと山場を作ります。
 *
 * **視聴者の円もランキングも触りません。** 積み上げたものが消えると
 * 「今までの努力が無駄になった」と感じさせるためです。区切りはあくまで
 * 敵側にだけ入ります。
 *
 * 起こすのは engine への「敵を出して」だけで、演出は画面側 (main / game-view) が
 * 'wave' / 'event' を受け取って行います。
 */
(function (global) {
  'use strict';

  function Director(engine, options) {
    options = options || {};
    this.engine = engine;
    this.config = options.config || engine.config;
    this.now = options.now || function () { return Date.now(); };
    this.random = options.random || Math.random;

    this.settings = this.config.director;
    /** 今のウェーブ (1 から)。 */
    this.wave = 1;
    /** 直近に起きた特殊イベント。画面が読みます。 */
    this.lastEvent = null;

    this._nextWaveAt = null;
    this._listeners = {};
  }

  Director.prototype.on = function (name, handler) {
    (this._listeners[name] || (this._listeners[name] = [])).push(handler);
    return this;
  };

  /**
   * 購読をやめる。
   *
   * 画面は 2 つ (操作画面 / ゲームウィンドウ) あり、ゲームウィンドウは
   * 閉じられます。閉じた画面の handler を残したままにすると、
   * 既に無いウィンドウの音や DOM を触りにいってエラーになります。
   */
  Director.prototype.off = function (name, handler) {
    var handlers = this._listeners[name];
    if (!handlers) return this;
    var i = handlers.indexOf(handler);
    if (i !== -1) handlers.splice(i, 1);
    return this;
  };

  Director.prototype.emit = function (name, payload) {
    var handlers = this._listeners[name];
    if (!handlers) return;
    handlers.slice().forEach(function (handler) { handler(payload); });
  };

  /** weight に比例した抽選。 */
  Director.prototype._pickEvent = function () {
    var events = this.settings.events || [];
    var total = 0;
    var i;
    for (i = 0; i < events.length; i += 1) total += Math.max(0, events[i].weight || 0);
    if (total <= 0) return null;

    var roll = this.random() * total;
    for (i = 0; i < events.length; i += 1) {
      roll -= Math.max(0, events[i].weight || 0);
      if (roll < 0) return events[i];
    }
    return events[events.length - 1];
  };

  /**
   * 毎フレーム呼ぶ。ウェーブの時間が来たら次へ進めます。
   */
  Director.prototype.update = function (at) {
    var settings = this.settings;
    if (!settings || !settings.enabled) return null;

    var now = at != null ? at : this.now();
    if (this._nextWaveAt == null) { this._nextWaveAt = now + settings.waveMs; return null; }
    if (now < this._nextWaveAt) return null;

    this._nextWaveAt = now + settings.waveMs;
    this.wave += 1;

    // 特殊イベントは毎回は起こさない (毎回だと「特殊」ではなくなるため)
    var event = this.random() < settings.eventChance ? this._pickEvent() : null;
    if (event) this._runEvent(event, now);

    this.emit('wave', { wave: this.wave, event: event, at: now });
    return event;
  };

  /** 特殊イベントの中身 (敵を出すだけ)。 */
  Director.prototype._runEvent = function (event, now) {
    var spawn = event.spawn || {};
    var count = Math.max(1, spawn.count || 1);
    var spawned = [];

    for (var i = 0; i < count; i += 1) {
      var enemy = this.engine.spawnEnemy(spawn.type || null, now);
      if (enemy) spawned.push(enemy);
    }

    this.lastEvent = { id: event.id, label: event.label, sub: event.sub || null, at: now, spawned: spawned.length };
    this.emit('event', this.lastEvent);
    return spawned;
  };

  /** 手で起こす (テストパネル用)。 */
  Director.prototype.trigger = function (id) {
    var events = this.settings.events || [];
    for (var i = 0; i < events.length; i += 1) {
      if (events[i].id === id) return this._runEvent(events[i], this.now());
    }
    return null;
  };

  Director.prototype.reset = function () {
    this.wave = 1;
    this.lastEvent = null;
    this._nextWaveAt = null;
    return this;
  };

  /** 次のウェーブまでの残り (ミリ秒)。画面のゲージに使います。 */
  Director.prototype.remainingMs = function (at) {
    if (this._nextWaveAt == null) return this.settings.waveMs;
    return Math.max(0, this._nextWaveAt - (at != null ? at : this.now()));
  };

  global.CB = global.CB || {};
  global.CB.Director = Director;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Director: Director };
  }
})(typeof window !== 'undefined' ? window : this);
