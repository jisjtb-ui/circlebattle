/**
 * tiktok-adapter.js - TikTok の受信口。
 *
 *   TikTok Connector  ->  TikTokAdapter (ここ)  ->  EventRouter  ->  GameSession
 *
 * KAWAII VS BEAUTIFUL で作った接続部分をそのまま持ってきたものです。
 * 中継サーバー (tikhub) の作りが同じなので、繋ぎ方を作り直す必要はありません。
 * 変えたのは名前空間 (KVB -> CB) だけです。
 *
 * このファイルは受け取ったイベントを EventRouter へ渡すだけで、
 * ゲームのルールを一切持ちません。ギフトの価値づけも円の生成も
 * ここではなく config.js / event-router.js / game-session.js の仕事です。
 *
 * connect() を呼ばない限りネットワークアクセスは発生しません。
 * 呼ばなければ完全オフラインで動きます。
 */
(function (global) {
  'use strict';

  /**
   * @param {object} router   EventRouter
   * @param {object} [options] { liveId, url }
   */
  function TikTokAdapter(router, options) {
    this.router = router;
    this.options = options || {};
    this.liveId = this.options.liveId || 'live-1';
    this.socket = null;
    this.connected = false;
    this.warned = false;
    this.url = null;
    /** 中継サーバーが接続先の変更を受け付けるか。 */
    this.control = false;
    /** 配信側の状態。{ status, target, username, roomId, message } */
    this.live = null;
    this._statusHandlers = [];
  }

  /** 'connected' / 'disconnected' を受け取る (画面のインジケータ用)。 */
  TikTokAdapter.prototype.onStatus = function (handler) {
    this._statusHandlers.push(handler);
    return this;
  };

  TikTokAdapter.prototype.emitStatus = function (status) {
    var self = this;
    this._statusHandlers.slice().forEach(function (h) { h(status, self.url); });
  };

  /**
   * TikTok のイベントを 1 件流し込む唯一の入口。
   * 手で叩いて動作確認もできます:
   *
   *   CB.tiktok.handleEvent({ type:'gift', user:{ uniqueId:'taro' }, giftName:'Rose' });
   *   CB.tiktok.handleEvent({ type:'like', user:{ uniqueId:'taro' }, count:100 });
   *   CB.tiktok.handleEvent({ type:'follow', user:{ uniqueId:'taro' } });
   *   CB.tiktok.handleEvent({ type:'share', user:{ uniqueId:'taro' } });
   *   CB.tiktok.handleEvent({ type:'chat', user:{ uniqueId:'taro' }, text:'hello' });
   */
  TikTokAdapter.prototype.handleEvent = function (raw) {
    return this.router.dispatch(this.liveId, raw);
  };

  /**
   * 旧 API との互換。{ name, count, user } 形式のギフトも受け付けます。
   */
  TikTokAdapter.prototype.handleGift = function (gift) {
    return this.handleEvent({
      type: 'gift',
      user: gift.user,
      giftId: gift.giftId,
      giftName: gift.giftName || gift.name,
      repeatCount: gift.repeatCount || gift.count,
      diamondCount: gift.diamondCount || gift.diamonds
    });
  };

  /**
   * 繋ぎにいく中継サーバーの URL を決める。
   *
   *   1. ?bridge=... が付いていればそれ
   *   2. このページ自体が中継サーバーから配信されているなら、同じ場所の /events
   *      (tikhub が http://127.0.0.1:8787/ でゲームごと配信している場合)
   *   3. それ以外 (index.html を直接開いた場合) は 127.0.0.1:8787
   *
   * どの開き方でも設定なしで繋がるようにするための決め方です。
   */
  TikTokAdapter.resolveBridgeUrl = function (loc) {
    loc = loc || global.location;
    var params = new URLSearchParams(loc.search || '');
    var explicit = params.get('bridge');
    if (explicit) return explicit;

    if (loc.protocol === 'http:' || loc.protocol === 'https:') {
      return loc.origin + '/events';
    }
    return 'http://127.0.0.1:8787/events';
  };

  /**
   * 中継サーバーからイベントを受け取る。呼び出しは任意です。
   *
   * ブラウザから TikTok へ直接つなぐことはできないため、別プロセス
   * (tikhub の TikTok LIVE Event Server を --serve 付きで起動したもの) が
   * 受信したイベントを中継してくる前提です。期待する形は handleEvent() の
   * コメントと同じで、type は gift / like / follow / chat。
   *
   *   http:// で始まる URL  -> SSE (EventSource)。tikhub --serve はこちら
   *   ws://   で始まる URL  -> WebSocket
   *
   * @param {string} [url] 例 http://localhost:8787/events
   */
  TikTokAdapter.prototype.connect = function (url) {
    var target = url || this.options.url || TikTokAdapter.resolveBridgeUrl();
    this.url = target;
    return /^https?:/.test(target) ? this._connectSse(target) : this._connectWebSocket(target);
  };

  /**
   * SSE。送るのはサーバー -> ブラウザの一方向だけなので、これで足ります。
   * 切断時の再接続はブラウザ (EventSource) が自前でやってくれます。
   */
  TikTokAdapter.prototype._connectSse = function (target) {
    var self = this;

    return new Promise(function (resolve) {
      var source = new global.EventSource(target);
      self.socket = source;

      source.onopen = function () {
        var first = !self.connected;
        self.connected = true;
        if (first) console.info('[CB] TikTok イベントの受信を開始しました:', target);
        self.emitStatus('connected');
        resolve(true);
      };

      source.onmessage = function (event) {
        var payload;
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          return;                       // 壊れた行は捨てる
        }
        self.handleEvent(payload);
      };

      // 配信そのものの状態 (未接続 / 接続中 / 配信終了) を受け取る。
      // これで「中継には繋がったが配信には繋がっていない」を見分けられる。
      ['ready', 'status'].forEach(function (name) {
        source.addEventListener(name, function (event) {
          var payload;
          try {
            payload = JSON.parse(event.data || '{}');
          } catch (err) {
            return;
          }
          self.control = payload.control !== undefined ? payload.control : self.control;
          self.live = payload.live || payload;
          self.emitStatus('connected');
        });
      });

      source.onerror = function () {
        // EventSource は自動で再接続を続けるので、ここでは状態を落とすだけ。
        // tikhub をあとから起動しても、放っておけば繋がります。
        if (!self.connected && !self.warned) {
          self.warned = true;
          console.warn('[CB] 中継サーバーに接続できません:', target,
                       '— tikhub を起動すると自動で繋がります');
          resolve(false);
        }
        self.connected = false;
        self.emitStatus('disconnected');
      };
    });
  };

  TikTokAdapter.prototype._connectWebSocket = function (target) {
    var self = this;

    return new Promise(function (resolve) {
      var socket;
      try {
        socket = new global.WebSocket(target);
      } catch (err) {
        console.warn('[CB] WebSocket を開けませんでした:', err.message);
        resolve(false);
        return;
      }
      self.socket = socket;

      socket.onopen = function () {
        self.connected = true;
        console.info('[CB] TikTok イベントの受信を開始しました:', target);
        resolve(true);
      };

      socket.onmessage = function (event) {
        var payload;
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          return;                       // 壊れた行は捨てる
        }
        // 1 件でも配列でも受け付ける
        if (Array.isArray(payload)) payload.forEach(function (e) { self.handleEvent(e); });
        else self.handleEvent(payload);
      };

      socket.onerror = function () {
        if (!self.connected) resolve(false);
      };

      socket.onclose = function () {
        self.connected = false;
      };
    });
  };

  /**
   * 中継サーバーに「この配信へ繋いで」と頼む。
   * ブラウザから TikTok へ直接繋ぐわけではなく、tikhub に指示を出すだけです。
   *
   * @param {string} target LIVE の URL / 短縮 URL / @ユーザー名
   * @returns {Promise<object>} { ok, message, live }
   */
  TikTokAdapter.prototype.connectLive = function (target) {
    var base = (this.url || '').replace(/\/events$/, '') || 'http://127.0.0.1:8787';
    return fetch(base + '/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target })
    })
      .then(function (res) { return res.json(); })
      .catch(function (err) {
        return { ok: false, message: '中継サーバーに届きませんでした (' + err.message + ')' };
      });
  };

  TikTokAdapter.prototype.disconnect = function () {
    if (this.socket) this.socket.close();     // WebSocket / EventSource とも close()
    this.socket = null;
    this.connected = false;
  };

  global.CB = global.CB || {};
  global.CB.TikTokAdapter = TikTokAdapter;
})(window);
