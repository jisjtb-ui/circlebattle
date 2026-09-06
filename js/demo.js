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
    this._nextAt = null;
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
    if (!this.active) return null;
    var now = at != null ? at : this.now();

    if (this._nextAt == null) this._nextAt = now;
    if (now < this._nextAt) return null;
    this._nextAt = now + this.settings.intervalMs;

    if (this.engine.circles.length >= this.settings.keepCircles) return null;

    var user = this.pick(this.users());
    var roll = this.random();
    var event;

    if (roll < 0.6) {
      event = { type: 'LIKE', user: user, count: this.config.viewers.like.perCircle, at: now };
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
   * 円もフィールドから引き上げます。残したままだと、そのあとも敵を倒し続けて
   * 本物の視聴者のランキングに仮の名前が混ざってしまうためです。
   */
  DemoDirector.prototype.stop = function () {
    if (!this.active) return this;
    this.active = false;

    if (this.settings.clearOnRealEvent) {
      if (this.engine) this.engine.removeCirclesWhere(function (circle) { return circle.demo; });
      if (this.leaderboard) this.leaderboard.removeWhere(function (record) { return record.demo; });
    }
    return this;
  };

  global.CB = global.CB || {};
  global.CB.DemoDirector = DemoDirector;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DemoDirector: DemoDirector };
  }
})(typeof window !== 'undefined' ? window : this);
