/**
 * cannon.js - PLAYER CANNON。視聴者の円を撃ち出す場所。
 *
 * **視聴者の円はすべてここから出てきます。** フィールドのどこかにぽんと
 * 現れるのではなく、端の大砲から中央へ向かって飛び込むので、
 * 「今この人が入ってきた」という因果が画面から読み取れます。
 *
 *   TikTok Connector → Event Router → GameSession
 *                                         │ spawnFor()
 *                                         ▼
 *                                      Cannon (ここ)
 *                                         │ 順番に 1 発ずつ
 *                                         ▼
 *                                   GameSession.spawnFor(launched)
 *                                         ▼
 *                                     BattleEngine
 *
 * ここは**描きません**。段階と時刻を持つだけで、canvas は renderer が
 * この状態を読んで描きます。そうしておくと、演出を変えてもゲームのルールに
 * 触らずに済みます。
 *
 * ゲームのループとは別に進みます。順番待ちが溜まっても、敵の生成も戦闘も
 * 止まりません。待ちが増えたら装填を短くし、それでも追いつかないときは
 * 演出を飛ばして即座に撃ちます。**入れなくなる人が出ないことを、
 * 演出の見栄えより優先します。**
 */
(function (global) {
  'use strict';

  /**
   * @param {object} options { config, engine, session, now }
   */
  function Cannon(options) {
    options = options || {};
    this.config = options.config;
    this.settings = this.config.cannon;
    this.engine = options.engine;
    this.session = options.session || null;
    this.now = options.now || function () { return Date.now(); };
    this.random = options.random || Math.random;

    /** 撃つ順番待ち。 */
    this.queue = [];
    /** いま装填しているもの。無ければ null。 */
    this.shot = null;
    /** 'idle' | 'load' | 'fire' | 'recover' */
    this.phase = 'idle';
    this.phaseAt = 0;
    /** 直近に撃った瞬間 (描画の閃光と反動に使います)。 */
    this.firedAt = -Infinity;
    /** 直近に撃ったもの。描画が煙や粒の色に使います。 */
    this.lastShot = null;

    this.stats = { queued: 0, fired: 0, skipped: 0 };
    this._listeners = {};
  }

  Cannon.prototype.on = function (name, handler) {
    (this._listeners[name] || (this._listeners[name] = [])).push(handler);
    return this;
  };

  Cannon.prototype.off = function (name, handler) {
    var handlers = this._listeners[name];
    if (!handlers) return this;
    var i = handlers.indexOf(handler);
    if (i !== -1) handlers.splice(i, 1);
    return this;
  };

  Cannon.prototype.emit = function (name, payload) {
    var handlers = this._listeners[name];
    if (!handlers) return;
    handlers.slice().forEach(function (handler) { handler(payload); });
  };

  // ------------------------------------------------------------ 位置と向き

  /** 大砲の根元 (フィールド座標)。フィールドが広がっても割合で追従します。 */
  Cannon.prototype.anchor = function () {
    var field = this.engine.field;
    return {
      x: field.width * this.settings.anchor.x,
      y: field.height * this.settings.anchor.y
    };
  };

  /** 中央へ向かう角度。撃つ向きも砲身の向きもこれです。 */
  Cannon.prototype.aim = function () {
    var field = this.engine.field;
    var base = this.anchor();
    return Math.atan2(field.height / 2 - base.y, field.width / 2 - base.x);
  };

  /** 砲口の位置。円はここから出ます。 */
  Cannon.prototype.muzzle = function (scale) {
    var base = this.anchor();
    var aim = this.aim();
    var length = this.settings.size * (scale != null ? scale : this.scale());
    return { x: base.x + Math.cos(aim) * length, y: base.y + Math.sin(aim) * length };
  };

  /**
   * 今の大きさの倍率。通常時は小さく、装填で大きく、発射で少し跳ねます。
   * 描画はこれを読むだけなので、見た目の調整はここと config で完結します。
   */
  Cannon.prototype.scale = function (at) {
    var s = this.settings;
    var now = at != null ? at : this.now();
    var elapsed = now - this.phaseAt;

    if (this.phase === 'load') {
      var t = Math.min(1, elapsed / Math.max(1, this._loadMs()));
      return s.idleScale + (s.loadScale - s.idleScale) * easeOut(t);
    }
    if (this.phase === 'fire') {
      var f = Math.min(1, elapsed / Math.max(1, s.fireMs));
      return s.fireScale - (s.fireScale - s.loadScale) * f;
    }
    if (this.phase === 'recover') {
      var r = Math.min(1, elapsed / Math.max(1, this._recoverMs()));
      return s.loadScale + (s.idleScale - s.loadScale) * easeOut(r);
    }
    return s.idleScale;
  };

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // -------------------------------------------------------------- 受け付け

  /**
   * 撃つものを受け付ける。GameSession.spawnFor から呼ばれます。
   *
   * @returns {boolean} true なら受け取った (呼び出し側は生成しない)
   */
  Cannon.prototype.enqueue = function (user, spec) {
    if (!this.settings.enabled) return false;

    var shot = {
      user: user,
      /** 撃つ瞬間に持たせるポイント。持ち主のものをそのまま写します。 */
      points: spec.points,
      sourceEvent: spec.sourceEvent || null,
      at: spec.at != null ? spec.at : this.now(),
      type: this.typeFor(spec.sourceEvent)
    };

    this.queue.push(shot);
    this.stats.queued += 1;
    this.emit('queued', shot);

    // 待ちが多すぎるときは、溜めずにその場で撃ちます。演出は飛びますが、
    // 出てくる場所と向きは大砲のままです。待たせて入れないほうが困ります。
    if (this.queue.length > this.settings.maxQueue) this._drainOverflow();
    return true;
  };

  /** その人のぶんで、まだ撃たれていないもの。 */
  Cannon.prototype.pendingFor = function (ownerId) {
    var id = String(ownerId);
    if (this.shot && String(this.shot.user.id) === id) return this.shot;
    for (var i = 0; i < this.queue.length; i += 1) {
      if (String(this.queue[i].user.id) === id) return this.queue[i];
    }
    return null;
  };

  /** その人のぶんで、まだ撃たれていない数。保有上限の判定に使います。 */
  Cannon.prototype.pendingCount = function (ownerId) {
    var id = String(ownerId);
    var count = this.shot && String(this.shot.user.id) === id ? 1 : 0;
    for (var i = 0; i < this.queue.length; i += 1) {
      if (String(this.queue[i].user.id) === id) count += 1;
    }
    return count;
  };

  /** そのイベントで使う演出の種類。 */
  Cannon.prototype.typeFor = function (sourceEvent) {
    var name = this.settings.typeByEvent[sourceEvent] || 'normal';
    return this.settings.types[name] || this.settings.types.normal;
  };

  /** 装填中に出す文言 (無ければ null)。 */
  Cannon.prototype.noticeFor = function (sourceEvent) {
    var notice = this.settings.notice || {};
    return notice[sourceEvent] || notice.default || null;
  };

  // ------------------------------------------------------------ 段階を進める

  Cannon.prototype._loadMs = function () {
    var s = this.settings;
    return this.queue.length >= s.burstAt ? s.burstLoadMs : s.loadMs;
  };

  Cannon.prototype._recoverMs = function () {
    var s = this.settings;
    return this.queue.length >= s.burstAt ? s.burstRecoverMs : s.recoverMs;
  };

  /**
   * 毎フレーム呼ぶ。**ゲームのループとは別に進みます。**
   * ここが遅れてもゲームは止まりませんし、ここで止めることもありません。
   */
  Cannon.prototype.update = function (at) {
    if (!this.settings.enabled) return;
    var now = at != null ? at : this.now();

    switch (this.phase) {
      case 'idle':
        if (this.queue.length) this._begin(now);
        break;
      case 'load':
        if (now - this.phaseAt >= this._loadMs()) this._fire(now);
        break;
      case 'fire':
        if (now - this.phaseAt >= this.settings.fireMs) this._enter('recover', now);
        break;
      case 'recover':
        if (now - this.phaseAt >= this._recoverMs()) {
          this._enter('idle', now);
          if (this.queue.length) this._begin(now);
        }
        break;
      default:
        break;
    }
  };

  Cannon.prototype._enter = function (phase, now) {
    this.phase = phase;
    this.phaseAt = now;
  };

  Cannon.prototype._begin = function (now) {
    this.shot = this.queue.shift();
    this._enter('load', now);
    this.emit('load', this.shot);
  };

  Cannon.prototype._fire = function (now) {
    var shot = this.shot;
    this.shot = null;
    this._enter('fire', now);
    if (shot) this._launch(shot, now);
  };

  /** 待ちすぎているぶんを、演出なしでまとめて撃つ。 */
  Cannon.prototype._drainOverflow = function () {
    var now = this.now();
    while (this.queue.length > this.settings.maxQueue) {
      this._launch(this.queue.shift(), now);
      this.stats.skipped += 1;
    }
  };

  /**
   * 実際に円を出す。
   *
   * 出す場所は砲口、向きは中央。ここから先は普通の円なので、戦闘も得点も
   * ランキングも今までどおりです (**入っただけでは点は入りません**)。
   */
  Cannon.prototype._launch = function (shot, now) {
    if (!this.session) return null;

    var s = this.settings;
    var muzzle = this.muzzle(s.loadScale);
    var spread = (this.random() * 2 - 1) * s.spreadRad;
    // 勢いも少しずらします。同じ速さで続けて撃つと団子になって飛びます。
    var jitter = 1 + (this.random() * 2 - 1) * (s.speedJitter || 0);

    var circle = this.session.spawnFor(shot.user, {
      points: shot.points,
      sourceEvent: shot.sourceEvent,
      at: now,
      // これが付いていると、GameSession はもう大砲へ回さずそのまま作ります
      launched: true,
      x: muzzle.x,
      y: muzzle.y,
      heading: this.aim() + spread,
      launchMs: s.launchMs,
      launchSpeed: s.launchSpeed * jitter
    });

    this.firedAt = now;
    this.lastShot = shot;
    this.stats.fired += 1;
    this.emit('fire', { shot: shot, circle: circle, at: now, muzzle: muzzle });
    return circle;
  };

  Cannon.prototype.reset = function () {
    this.queue.length = 0;
    this.shot = null;
    this.phase = 'idle';
    this.phaseAt = 0;
    this.firedAt = -Infinity;
    this.lastShot = null;
    return this;
  };

  global.CB = global.CB || {};
  global.CB.Cannon = Cannon;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Cannon: Cannon };
  }
})(typeof window !== 'undefined' ? window : this);
