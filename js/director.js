/**
 * director.js - 進行役。ラウンドの時計と、ときどき起きる特殊イベント。
 *
 * 敵の自動生成だけだと、5 分見ても 30 分見ても同じ画面になります。
 * ここが**ラウンドの残り時間**を数え、ときどき特殊イベント
 * (BOSS / SWARM / RARE / ELITE) を起こして山場を作ります。
 *
 * ## ウェーブをやめた理由
 *
 * 以前は `WAVE 1 → 2 → 3 …` と数を積み上げていました。数が積み上がるほど、
 * あとから来た人には「もう 7 まで進んでいる、今さら入っても」に見えます。
 * 途中から見た人が**その場で対等に参加できる**ほうを取りました。
 *
 * 代わりに置いたのが**決まった長さのラウンド**です。残り時間が画面に出て、
 * 0 になったら結果を出して**全部リセット**し、次のラウンドが始まります。
 * どこから見ても「次のラウンドは最初から」なので、遅れは生まれません。
 *
 * ここは**リセットしません**。時間が来たことを 'round:end' / 'round:reset' で
 * 知らせるだけで、実際に消すのは app.js です (何を消すかを知っているのは
 * 組み立てた側なので)。演出も画面側 (game-view) が受け取って行います。
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
    /** 何ラウンド目か (1 から)。画面には出しません。記録用です。 */
    this.round = 1;
    /** 'playing' … 進行中 / 'result' … 結果を出している間 */
    this.phase = 'playing';
    /** 直近に起きた特殊イベント。画面が読みます。 */
    this.lastEvent = null;

    this._startedAt = null;      // このラウンドが始まった時刻
    this._resultUntil = null;    // 結果を出しておく終わりの時刻
    this._nextEventAt = null;
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
   * 毎フレーム呼ぶ。
   *
   *   進行中  … 時間が来たら特殊イベント / ラウンドの終わり
   *   結果表示 … 出しておく時間が過ぎたらリセットを知らせる
   */
  Director.prototype.update = function (at) {
    var settings = this.settings;
    if (!settings || !settings.enabled) return null;

    var now = at != null ? at : this.now();
    if (this._startedAt == null) this._start(now);

    if (this.phase === 'result') {
      if (now < this._resultUntil) return null;
      // ここを受けた app が engine もランキングも消します。
      // director 自身の時計は _start が引き直します。
      this.round += 1;
      this._start(now);
      this.emit('round:reset', { round: this.round, at: now });
      return null;
    }

    var roundMs = settings.roundMs;
    if (roundMs > 0 && now - this._startedAt >= roundMs) {
      this.phase = 'result';
      this._resultUntil = now + (settings.resultMs > 0 ? settings.resultMs : 0);
      this.emit('round:end', { round: this.round, at: now });
      return null;
    }

    if (now < this._nextEventAt) return null;
    this._nextEventAt = now + this._eventEveryMs();

    // 毎回は起こしません (毎回だと「特殊」ではなくなるため)
    var event = this.random() < settings.eventChance ? this._pickEvent() : null;
    if (event) this._runEvent(event, now);
    return event;
  };

  Director.prototype._eventEveryMs = function () {
    return this.settings.eventEveryMs > 0 ? this.settings.eventEveryMs : Infinity;
  };

  /** ラウンドの時計を引き直す。 */
  Director.prototype._start = function (now) {
    this.phase = 'playing';
    this._startedAt = now;
    this._resultUntil = null;
    this._nextEventAt = now + this._eventEveryMs();
    return this;
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
    this.round = 1;
    this.lastEvent = null;
    this.phase = 'playing';
    this._startedAt = null;
    this._resultUntil = null;
    this._nextEventAt = null;
    return this;
  };

  /**
   * ラウンドの残り (ミリ秒)。画面の残り時間に使います。
   *
   * 結果を出している間は 0。まだ始まっていなければ丸ごと 1 ラウンド分。
   */
  Director.prototype.remainingMs = function (at) {
    var roundMs = this.settings.roundMs;
    if (!(roundMs > 0)) return Infinity;
    if (this._startedAt == null) return roundMs;
    if (this.phase === 'result') return 0;
    return Math.max(0, roundMs - ((at != null ? at : this.now()) - this._startedAt));
  };

  global.CB = global.CB || {};
  global.CB.Director = Director;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Director: Director };
  }
})(typeof window !== 'undefined' ? window : this);
