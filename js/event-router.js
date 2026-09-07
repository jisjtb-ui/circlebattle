/**
 * event-router.js - TikTok のイベントを「ゲームイベント」へ翻訳する層。
 *
 *   TikTok Connector  ->  EventRouter  ->  Game Event  ->  GameSession
 *
 * ここが TikTok の語彙 (giftId, diamondCount, uniqueId, avatarThumb, ...) を
 * 知っている最後の場所です。ここから先へ流れるゲームイベントには TikTok 固有の
 * 情報が一切含まれないため、ゲーム側は TikTok を直接参照しません。
 * 別の配信サービスを足すときは、この層をもう 1 つ書くだけで済みます。
 *
 * ルーターは liveId ごとにセッションを持てます。今は 1 本しか繋ぎませんが、
 * 複数 LIVE を同時に受けるときはセッションを足すだけです。
 *
 *   router.attach('live-a', sessionA);
 *   router.attach('live-b', sessionB);
 *   router.dispatch('live-a', tiktokEvent);
 */
(function (global) {
  'use strict';

  /** ルーターが下流へ流すゲームイベントの種類。 */
  var GAME_EVENT = {
    GIFT: 'GIFT',
    LIKE: 'LIKE',
    FOLLOW: 'FOLLOW',
    SHARE: 'SHARE',
    /** 入室。1 人 1 回だけ、レベル 20 の円がもらえます。 */
    JOIN: 'JOIN',
    /** 今回のゲームでは何も起こしません。将来の操作用に通すだけです。 */
    COMMENT: 'COMMENT'
  };

  function toPositiveInt(value, fallback) {
    var n = Math.floor(Number(value));
    return isFinite(n) && n > 0 ? n : fallback;
  }

  /**
   * プロフィール画像の URL を取り出す。
   *
   * 形はライブラリのバージョンと中継サーバーで揺れるので、ありうる置き場を
   * 順に見ます。tikhub が正規化済みの profileImageUrl を付けてくる場合は
   * 最初の 1 行で終わります。
   *
   *   profileImageUrl                       tikhub が正規化したもの
   *   profilePictureUrl                     ライブラリの簡易ユーザー
   *   avatarThumb.urlList[]                 protobuf の User (小さい順に見る)
   *   avatarMedium / avatarLarge
   */
  function readProfileImage(user) {
    var direct = user.profileImageUrl || user.profilePictureUrl || user.avatarUrl;
    if (direct) return String(direct);

    var sources = [user.avatarThumb, user.avatarMedium, user.avatarLarge, user.avatar];
    for (var i = 0; i < sources.length; i += 1) {
      var image = sources[i];
      if (!image) continue;
      if (typeof image === 'string') return image;
      var list = image.urlList || image.urls || image.url_list;
      if (Array.isArray(list) && list.length) {
        // 小さい 100x100 があればそれを使う。円の中に描くだけなので大きい画像は要りません。
        for (var j = 0; j < list.length; j += 1) {
          if (typeof list[j] === 'string' && list[j].indexOf('100x100') !== -1) return list[j];
        }
        return String(list[0]);
      }
    }
    return null;
  }

  /**
   * TikTok 側のユーザー表現はライブラリやバージョンで揺れるので、
   * ゲームが使う 4 つだけに均す。
   *
   *   id              … TikTok の userId。ランキングの鍵はこれ
   *   uniqueId        … @ 抜きのユーザー名。画面に出すのはこれ
   *   displayName     … 表示名 (ニックネーム)
   *   profileImageUrl … 円の中に描くプロフィール画像 (取れなければ null)
   *
   * userId が取れない配信・イベントもあるので、その場合は uniqueId で代用します。
   */
  function readUser(raw) {
    var user = raw.user || raw;
    var id = user.id != null && user.id !== '' ? String(user.id) : null;
    var uniqueId = user.uniqueId || user.displayId || user.username || raw.username || null;
    var displayName = user.nickname || user.displayName || null;

    uniqueId = uniqueId ? String(uniqueId) : (id || 'unknown');
    return {
      id: id || uniqueId,
      uniqueId: uniqueId,
      displayName: displayName ? String(displayName) : uniqueId,
      profileImageUrl: readProfileImage(user)
    };
  }

  function readText(raw) {
    var text = raw.text != null ? raw.text : (raw.comment != null ? raw.comment : raw.message);
    return text == null ? '' : String(text);
  }

  /**
   * @param {object} [options] { config, now }
   */
  function EventRouter(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.CONFIG);
    if (!this.config) throw new Error('EventRouter: config が渡されていません');
    this.now = options.now || function () { return Date.now(); };

    this.sessions = {};      // liveId -> session
    this._listeners = [];    // 監視用 (デバッグ・ログ)
    this.stats = { received: 0, routed: 0, dropped: 0 };
  }

  // ------------------------------------------------------------- sessions

  /** liveId にゲームセッションを結びつける。 */
  EventRouter.prototype.attach = function (liveId, session) {
    this.sessions[String(liveId)] = session;
    return this;
  };

  EventRouter.prototype.detach = function (liveId) {
    delete this.sessions[String(liveId)];
    return this;
  };

  EventRouter.prototype.getSession = function (liveId) {
    return this.sessions[String(liveId)] || null;
  };

  /** 変換後のゲームイベントを覗きたいとき用 (画面には影響しません)。 */
  EventRouter.prototype.onGameEvent = function (handler) {
    this._listeners.push(handler);
    return this;
  };

  // ------------------------------------------------------------ gift 変換

  /**
   * ギフト -> コイン価値。
   *
   * 優先順位:  giftId 指定  ->  ギフト名指定  ->  ダイヤ数  ->  既定値
   *
   * 連打ギフトは repeatCount 回ぶんまとめて 1 件で届くので掛けます。
   * 「コイン価値 -> 円の強さ」の変換はゲーム側 (game-session.js) の仕事なので、
   * ここではコイン価値までで止めます。
   */
  EventRouter.prototype.giftToCoins = function (raw) {
    var gifts = this.config.gifts;
    var repeat = toPositiveInt(raw.repeatCount != null ? raw.repeatCount : raw.count, 1);

    var id = raw.giftId != null ? String(raw.giftId) : null;
    var name = String(raw.giftName || raw.name || '').trim().toLowerCase();

    var unit;
    if (id && gifts.byId && gifts.byId[id] != null) {
      unit = Number(gifts.byId[id]);
    } else if (name && gifts.byName && gifts.byName[name] != null) {
      unit = Number(gifts.byName[name]);
    } else {
      var diamonds = Number(raw.diamondCount != null ? raw.diamondCount : raw.diamonds);
      unit = isFinite(diamonds) && diamonds > 0
        ? diamonds * Number(gifts.coinsPerDiamond)
        : Number(gifts.defaultCoins);
    }

    if (!isFinite(unit) || unit <= 0) return 0;
    return unit * repeat;
  };

  // ------------------------------------------------------------ dispatch

  /**
   * TikTok の生イベントを 1 件受け取り、ゲームイベントへ翻訳して
   * 対象セッションへ渡す。
   *
   * @param {string} liveId
   * @param {object} raw  { type:'gift'|'like'|'follow'|'share'|'chat', user, ... }
   * @returns {object|null} 流したゲームイベント (無視した場合は null)
   */
  EventRouter.prototype.dispatch = function (liveId, raw) {
    this.stats.received += 1;
    if (!raw) { this.stats.dropped += 1; return null; }

    var event = this.translate(raw);
    if (!event) { this.stats.dropped += 1; return null; }

    event.liveId = String(liveId);

    var session = this.getSession(liveId);
    if (session) {
      this.stats.routed += 1;
      session.handle(event);
    } else {
      this.stats.dropped += 1;
    }

    this._listeners.slice().forEach(function (handler) { handler(event); });
    return event;
  };

  /**
   * 翻訳だけを行う (セッションへは渡さない)。テストから直接叩けます。
   * ゲームで使わない種類 (viewer など) は null を返します。
   */
  EventRouter.prototype.translate = function (raw) {
    var type = String(raw.type || raw.event || '').toLowerCase();
    var at = this.now();

    switch (type) {
      case 'gift': {
        // 連打の途中経過 (finished === false) は捨てる。確定の 1 件だけ数えます。
        if (raw.finished === false) return null;
        var coins = this.giftToCoins(raw);
        if (coins <= 0) return null;
        return {
          type: GAME_EVENT.GIFT,
          user: readUser(raw),
          /** ギフトの価値。ゲーム側はこの数字だけを見ます。 */
          value: coins,
          /** 表示用。ゲームのルールには使いません。 */
          label: raw.giftName || raw.name || null,
          at: at
        };
      }
      case 'like': {
        var count = toPositiveInt(raw.count != null ? raw.count : raw.likeCount, 1);
        return { type: GAME_EVENT.LIKE, user: readUser(raw), count: count, at: at };
      }
      case 'follow':
        return { type: GAME_EVENT.FOLLOW, user: readUser(raw), at: at };

      case 'share':
        return { type: GAME_EVENT.SHARE, user: readUser(raw), at: at };

      // 入室。ライブラリによって member / join / enter と名前が揺れます。
      case 'member':
      case 'join':
      case 'enter':
        return { type: GAME_EVENT.JOIN, user: readUser(raw), at: at };

      case 'chat':
      case 'comment': {
        var text = readText(raw);
        if (!text) return null;
        return { type: GAME_EVENT.COMMENT, user: readUser(raw), text: text, at: at };
      }
      default:
        return null;
    }
  };

  global.CB = global.CB || {};
  global.CB.EventRouter = EventRouter;
  global.CB.GAME_EVENT = GAME_EVENT;
  global.CB.readUser = readUser;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventRouter: EventRouter, GAME_EVENT: GAME_EVENT, readUser: readUser };
  }
})(typeof window !== 'undefined' ? window : this);
