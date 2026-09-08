/**
 * join-banner.js - 入室を受け取った瞬間、画面の真ん中に出す名前。
 *
 *   TikTok Connector → Event Router → GameSession
 *                                         │ 'join' (受け取った瞬間)
 *                                         ▼
 *                                     JoinBanner (ここ)
 *                                         │ 誰を今出しているか
 *                                         ▼
 *                                      Renderer (中央に描く)
 *
 * ここは**描きません**。「今どの名前を、いつまで出すか」を持つだけで、
 * 文字を置くのは renderer の役目です。cannon.js と同じ形にしてあるので、
 * 見た目を変えてもゲームのルールには触りません。
 *
 * 円が出るのは大砲が撃ったあとです。混んでいれば数秒あとになるので、
 * 円だけに任せると「今わたしが入った」が画面に出るまで間があきます。
 * ここは**受け取った瞬間**に動き、円とは別に名前を出します。
 *
 * 目立たせることと邪魔にしないことの両立は、時間で解いています:
 *
 *   1 度に 1 人   … 重ねると、結局どの名前も読めません
 *   1.1 秒で消す  … 出しっぱなしにすると盤面が見えません
 *   混んだら縮める … 待ちが 3 人を超えたら 0.52 秒
 *   あふれたら数える … 上限を超えたぶんは「+12 MORE JOINED」と数だけ
 *
 * 数だけにされた人も円は必ず出ます (大砲が撃ちます)。ここで落ちるのは
 * 名前の表示だけです。
 */
(function (global) {
  'use strict';

  /**
   * @param {object} options { config }
   */
  function JoinBanner(options) {
    options = options || {};
    this.config = options.config;
    this.settings = (this.config && this.config.ui && this.config.ui.join &&
                     this.config.ui.join.banner) || {};

    /** 出番待ちの名前。 */
    this.queue = [];
    /** いま出しているもの。無ければ null。 */
    this.current = null;
    /** 待ちがあふれて、数だけ数えた人数。 */
    this.overflow = 0;
    /** 次を出せる時刻 (前の 1 人が消えたあとの間)。 */
    this.readyAt = 0;
    /**
     * 出し直しの通し番号。renderer はこれが変わったときだけ
     * アニメーションをやり直します (毎フレームやり直すと点滅します)。
     */
    this.serial = 0;

    this.stats = { received: 0, shown: 0, counted: 0 };
  }

  /**
   * 入室を 1 件受け取る。**ゲームのルールには何も起こしません。**
   *
   * @param {object} user  { uniqueId, displayName, ... }
   * @param {number} [at]  受け取った時刻
   * @returns {boolean} 名前として出すなら true (数だけ数えたときは false)
   */
  JoinBanner.prototype.push = function (user, at) {
    if (!user || this.settings.enabled === false) return false;

    this.stats.received += 1;
    var name = user.uniqueId || user.displayName || String(user.id || '');
    if (!name) return false;

    var max = this.settings.maxQueue > 0 ? this.settings.maxQueue : 5;
    if (this.queue.length >= max) {
      // 出しきれないぶんは数だけ残します。捨てると、大量入室のときに
      // 「何人来たのか」まで画面から消えてしまいます。
      this.overflow += 1;
      this.stats.counted += 1;
      return false;
    }

    this.queue.push({ name: name, at: at || 0 });
    return true;
  };

  /** いま出している 1 人ぶんの表示時間。待ちが多いほど短くします。 */
  JoinBanner.prototype.holdMs = function () {
    var s = this.settings;
    var rushFrom = s.rushFrom > 0 ? s.rushFrom : 3;
    if (this.queue.length >= rushFrom) return s.rushHoldMs > 0 ? s.rushHoldMs : 520;
    return s.holdMs > 0 ? s.holdMs : 1100;
  };

  /**
   * 時間を進める。app.update() から毎フレーム呼ばれます。
   *
   * @param {number} now
   * @returns {object|null} いま出すもの { name, more, until, serial }
   */
  JoinBanner.prototype.update = function (now) {
    if (this.current && now >= this.current.until) {
      this.current = null;
      this.readyAt = now + (this.settings.gapMs >= 0 ? this.settings.gapMs : 90);
    }
    if (this.current || !this.queue.length || now < this.readyAt) return this.current;

    var next = this.queue.shift();
    this.serial += 1;
    this.stats.shown += 1;

    // あふれたぶんは、次に出る 1 人へまとめて添えます。出すたびに繰り返すと
    // 同じ数字が何度も出て、数えなおしたように見えます。
    var more = this.overflow;
    this.overflow = 0;

    this.current = {
      name: next.name,
      more: more,
      shownAt: now,
      until: now + this.holdMs(),
      serial: this.serial
    };
    return this.current;
  };

  /** 今この瞬間に出ているもの (renderer が読みます)。 */
  JoinBanner.prototype.active = function (now) {
    if (!this.current) return null;
    return now < this.current.until ? this.current : null;
  };

  JoinBanner.prototype.reset = function () {
    this.queue.length = 0;
    this.current = null;
    this.overflow = 0;
    this.readyAt = 0;
    return this;
  };

  global.CB = global.CB || {};
  global.CB.JoinBanner = JoinBanner;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { JoinBanner: JoinBanner };
  }
})(typeof window !== 'undefined' ? window : this);
