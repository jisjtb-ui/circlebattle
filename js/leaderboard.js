/**
 * leaderboard.js - ユーザーごとの成績とランキング。
 *
 *   userId
 *   userName
 *   profileImageUrl
 *   kills            倒した敵の数
 *   damage           与えた総ダメージ
 *   score            撃破ポイントの合計
 *   lastActivity     最後に何かした時刻 (ミリ秒)
 *
 * チームの概念はありません。並ぶのは常に個人です。
 * 並べ替えの基準は score / kills / damage のどれでも選べます (既定は score)。
 */
(function (global) {
  'use strict';

  var FIELDS = ['score', 'kills', 'damage'];

  function Leaderboard(options) {
    options = options || {};
    var config = options.config || (global.CB && global.CB.CONFIG);
    var ranking = (config && config.ranking) || {};

    this.now = options.now || function () { return Date.now(); };
    this.sortBy = FIELDS.indexOf(ranking.sortBy) !== -1 ? ranking.sortBy : 'score';
    this.order = ranking.order === 'asc' ? 'asc' : 'desc';
    this.size = ranking.size || 10;

    this.users = {};          // userId -> record
    this.version = 0;         // 変わるたびに増える。描画側の差分判定用。
    this._listeners = [];
  }

  Leaderboard.FIELDS = FIELDS;

  /** 変化を受け取る (描画の更新用)。 */
  Leaderboard.prototype.on = function (handler) {
    this._listeners.push(handler);
    return this;
  };

  Leaderboard.prototype._changed = function () {
    this.version += 1;
    var self = this;
    this._listeners.slice().forEach(function (handler) { handler(self); });
  };

  /**
   * ユーザーを登録 / 更新して記録を返す。
   *
   * 名前とプロフィール画像は届くたびに上書きします (改名やアイコン変更に追従)。
   * 空の値では上書きしません。一度取れた画像を、画像の無いイベントで
   * 消してしまわないためです。
   *
   * @param {object} user { id, uniqueId, displayName, profileImageUrl }
   */
  Leaderboard.prototype.touch = function (user, at) {
    if (!user) return null;
    var id = String(user.id || user.userId || user.uniqueId || 'unknown');
    var record = this.users[id];

    if (!record) {
      record = this.users[id] = {
        userId: id,
        userName: user.uniqueId || user.userName || id,
        displayName: user.displayName || user.uniqueId || id,
        profileImageUrl: user.profileImageUrl || null,
        kills: 0,
        damage: 0,
        score: 0,
        lastActivity: at != null ? at : this.now(),
        /** デモ視聴者かどうか。本物のイベントが来たら消せるように印を付けます。 */
        demo: Boolean(user.demo)
      };
      this._changed();
      return record;
    }

    if (user.uniqueId) record.userName = user.uniqueId;
    if (user.displayName) record.displayName = user.displayName;
    if (user.profileImageUrl) record.profileImageUrl = user.profileImageUrl;
    record.lastActivity = at != null ? at : this.now();
    return record;
  };

  Leaderboard.prototype.get = function (userId) {
    return this.users[String(userId)] || null;
  };

  /** 与えたダメージを記録する。 */
  Leaderboard.prototype.addDamage = function (user, amount, at) {
    var record = this.touch(user, at);
    if (!record || !(amount > 0)) return record;
    record.damage += amount;
    this._changed();
    return record;
  };

  /** 撃破を記録する。points はそのままスコアへ入ります。 */
  Leaderboard.prototype.addKill = function (user, points, kills, at) {
    var record = this.touch(user, at);
    if (!record) return null;
    record.kills += kills == null ? 1 : kills;
    record.score += points > 0 ? points : 0;
    this._changed();
    return record;
  };

  /** 撃破を伴わないスコア加算 (ダメージ配分など)。 */
  Leaderboard.prototype.addScore = function (user, points, at) {
    var record = this.touch(user, at);
    if (!record || !(points > 0)) return record;
    record.score += points;
    this._changed();
    return record;
  };

  /**
   * 並べ替えの基準を変える。
   *
   *   leaderboard.setSort('kills');
   *   leaderboard.setSort('damage', 'desc');
   */
  Leaderboard.prototype.setSort = function (field, order) {
    if (FIELDS.indexOf(field) !== -1) this.sortBy = field;
    if (order === 'asc' || order === 'desc') this.order = order;
    this._changed();
    return this;
  };

  /**
   * 上位を返す。既定は設定の size (= 10)。
   * 11 位以下はここで切り落とすので、画面には出ません。
   */
  Leaderboard.prototype.top = function (n, field, order) {
    var by = FIELDS.indexOf(field) !== -1 ? field : this.sortBy;
    var dir = (order === 'asc' || order === 'desc') ? order : this.order;
    var sign = dir === 'asc' ? 1 : -1;
    var limit = n == null ? this.size : n;

    // 主基準が同点のときは score -> kills -> damage の順に見る。
    // それでも並ばなければ、先に到達した人を上にする。
    var tiebreak = FIELDS.filter(function (f) { return f !== by; });

    var list = Object.keys(this.users).map(function (id) { return this.users[id]; }, this);
    list.sort(function (a, b) {
      if (a[by] !== b[by]) return sign * (a[by] - b[by]);
      for (var i = 0; i < tiebreak.length; i += 1) {
        var f = tiebreak[i];
        if (a[f] !== b[f]) return sign * (a[f] - b[f]);
      }
      if (a.lastActivity !== b.lastActivity) return a.lastActivity - b.lastActivity;
      return a.userId < b.userId ? -1 : 1;
    });

    return limit > 0 ? list.slice(0, limit) : list;
  };

  Leaderboard.prototype.count = function () {
    return Object.keys(this.users).length;
  };

  /** 条件に合うユーザーを消す (デモ視聴者の後片付けに使います)。 */
  Leaderboard.prototype.removeWhere = function (predicate) {
    var removed = 0;
    Object.keys(this.users).forEach(function (id) {
      if (predicate(this.users[id])) { delete this.users[id]; removed += 1; }
    }, this);
    if (removed) this._changed();
    return removed;
  };

  Leaderboard.prototype.reset = function () {
    this.users = {};
    this._changed();
    return this;
  };

  global.CB = global.CB || {};
  global.CB.Leaderboard = Leaderboard;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Leaderboard: Leaderboard };
  }
})(typeof window !== 'undefined' ? window : this);
