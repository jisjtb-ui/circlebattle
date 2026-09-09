/**
 * demo.js - 誰も見ていない間、画面を止めないための仮の視聴者。
 *
 * このゲームの最重要仕様は「TikTok のイベントが 0 件でも画面が動いている」ことです。
 * 敵の自動生成だけでも敵は動きますが、それだけだと戦闘が起きません。
 * そこで、本物の視聴者イベントが 1 件も来ていない間だけ、仮の視聴者が
 * LIKE / FOLLOW / GIFT を送っている扱いにします。
 *
 * 送り先は本物と同じ GameSession なので、抜け道はありません。
 * 本物のイベントが 1 件でも届いたら止まり、記録も消えます (設定で変更可)。
 */
(function (global) {
  'use strict';

  function DemoDirector(session, options) {
    options = options || {};
    this.session = session;
    this.engine = options.engine || session.engine;
    this.config = options.config || session.config;
    this.leaderboard = options.leaderboard || session.leaderboard;
    this.now = options.now || function () { return Date.now(); };
    this.random = options.random || Math.random;

    this.settings = this.config.demo;
    this.active = Boolean(this.settings.enabled);
    /** 引き上げ中か。円を 1 つずつ消している間だけ true。 */
    this.retiring = false;
    this._nextAt = null;
    this._retireAt = null;
    this._users = null;

    var self = this;
    if (this.settings.stopOnRealEvent) {
      session.on('real-event', function () { self.stop(); });
    }
  }

  /** 仮の視聴者を作る。id を demo- で始めることで本物と混ざりません。 */
  DemoDirector.prototype.users = function () {
    if (this._users) return this._users;
    this._users = [];
    for (var i = 1; i <= this.settings.players; i += 1) {
      var name = this.settings.namePrefix + (i < 10 ? '0' : '') + i;
      this._users.push({
        id: 'demo-' + name,
        uniqueId: name,
        displayName: name,
        profileImageUrl: null,
        demo: true
      });
    }
    return this._users;
  };

  DemoDirector.prototype.pick = function (list) {
    return list[Math.floor(this.random() * list.length) % list.length];
  };

  /**
   * 毎フレーム呼ぶ。間隔が来ていて、円が足りていなければ 1 件送ります。
   * 円が十分あるときは何もしません (仮の視聴者で埋め尽くさないため)。
   */
  DemoDirector.prototype.update = function (at) {
    var now = at != null ? at : this.now();

    if (this.retiring) { this._retireTick(now); return null; }
    if (!this.active) return null;

    if (this._nextAt == null) this._nextAt = now;
    if (now < this._nextAt) return null;
    this._nextAt = now + this.settings.intervalMs;

    if (this.engine.circles.length >= this.settings.keepCircles) return null;

    var user = this.pick(this.users());
    var roll = this.random();
    var event;

    if (roll < 0.6) {
      event = { type: 'LIKE', user: user, count: this.config.viewers.gain.likesPerPoint, at: now };
    } else if (roll < 0.85) {
      event = { type: 'FOLLOW', user: user, at: now };
    } else {
      event = { type: 'GIFT', user: user, value: 1 + Math.floor(this.random() * 20), at: now };
    }

    return this.session.handle(event);
  };

  /**
   * 止める。
   *
   * 円も引き上げますが、**まとめて消しません**。一斉に消すと、最初の LIKE が
   * 来た瞬間に画面の円が全部消えて「リセットされた」ように見えるためです。
   * retireIntervalMs ごとに 1 つずつ引き上げ、本物の視聴者の円と入れ替えます。
   *
   * ランキングの記録だけは先に消します。引き上げ中の円が敵を倒しても
   * 点が入らないように、GameSession 側でも仮視聴者への加点を止めています。
   */
  DemoDirector.prototype.stop = function () {
    if (!this.active) return this;
    this.active = false;

    if (!this.settings.clearOnRealEvent) return this;

    if (this.leaderboard) this.leaderboard.removeWhere(function (record) { return record.demo; });

    if (this.settings.retireIntervalMs > 0) {
      this.retiring = true;
      this._retireAt = null;
    } else if (this.engine) {
      this.engine.removeCirclesWhere(function (circle) { return circle.demo; });
    }
    return this;
  };

  /** 引き上げ中: 間隔ごとに仮視聴者の円を 1 つ消す。 */
  DemoDirector.prototype._retireTick = function (now) {
    if (this._retireAt == null) this._retireAt = now + this.settings.retireIntervalMs;

    while (now >= this._retireAt) {
      var removed = this.engine.removeCirclesWhere(function (circle) { return circle.demo; }, 1);
      if (!removed) { this.retiring = false; return; }
      this._retireAt += this.settings.retireIntervalMs;
    }
  };

  global.CB = global.CB || {};
  global.CB.DemoDirector = DemoDirector;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DemoDirector: DemoDirector };
  }
})(typeof window !== 'undefined' ? window : this);
