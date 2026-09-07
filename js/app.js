/**
 * app.js - ゲーム一式を組み立てて 1 つにまとめる層。
 *
 *   TikTok Connector → Event Router → Game Engine → Game State
 *                                                      │
 *                          ┌───────────────────────────┴───────────┐
 *                          │                                       │
 *                   Control Window                           Game Window
 *                   (index.html)                             (game.html)
 *                   設定・管理                                 配信用の画面
 *
 * **ゲームの状態は 1 つだけ**です。ゲームウィンドウは別プロセスではなく、
 * 操作画面が持っているこの塊を `window.opener.CB.app` から読んで描くだけです。
 * そのため、操作画面で音量や設定を変えると、ゲームウィンドウへ即座に届きます。
 *
 * ゲームウィンドウを OBS の「ブラウザソース」として URL で直接開いた場合は
 * opener がないので、その画面が自分でこの塊を作ります (standalone)。
 * どちらの開き方でも動くように、組み立てはここ 1 箇所にまとめてあります。
 */
(function (global) {
  'use strict';

  var LIVE_ID = 'live-1';

  /**
   * @param {object} [options] { config, liveId, connect }
   * @returns {object} engine / session / router / leaderboard / avatars / demo / tiktok を持つ塊
   */
  function createApp(options) {
    options = options || {};
    var CB = global.CB;
    var config = options.config || CB.CONFIG;
    var liveId = options.liveId || LIVE_ID;

    var leaderboard = new CB.Leaderboard({ config: config });
    var engine = new CB.BattleEngine({ config: config });
    var session = new CB.GameSession(engine, {
      config: config,
      leaderboard: leaderboard,
      liveId: liveId
    });
    var router = new CB.EventRouter({ config: config });
    router.attach(liveId, session);

    var avatars = new CB.AvatarCache();
    var demo = new CB.DemoDirector(session, { config: config });
    var tiktok = new CB.TikTokAdapter(router, { liveId: liveId });
    var director = CB.Director ? new CB.Director(engine, { config: config, session: session }) : null;

    var app = {
      config: config,
      liveId: liveId,
      leaderboard: leaderboard,
      engine: engine,
      session: session,
      router: router,
      avatars: avatars,
      demo: demo,
      director: director,
      tiktok: tiktok,

      /** 接続状態。画面はここを読んで表示します。 */
      status: { state: 'offline', text: '未接続' },

      /**
       * 操作画面とゲームウィンドウで共有する設定。
       * 操作画面が変えると、購読しているゲームウィンドウへ即座に届きます。
       */
      settings: {
        sfxEnabled: config.audio.enabled,
        sfxVolume: config.audio.volume,
        bgmUrl: null,
        bgmName: null,
        bgmVolume: 0.4,
        bgmPlaying: false
      },

      _settingsListeners: [],
      _statusListeners: []
    };

    /** 設定の変更を受け取る (ゲームウィンドウが購読します)。 */
    app.onSettings = function (handler) {
      app._settingsListeners.push(handler);
      handler(app.settings);
      return function () {
        var i = app._settingsListeners.indexOf(handler);
        if (i !== -1) app._settingsListeners.splice(i, 1);
      };
    };

    /** 設定を変える。触った項目だけ渡せば足ります。 */
    app.applySettings = function (patch) {
      Object.keys(patch).forEach(function (key) { app.settings[key] = patch[key]; });
      app._settingsListeners.slice().forEach(function (handler) { handler(app.settings, patch); });
      return app.settings;
    };

    app.onStatus = function (handler) {
      app._statusListeners.push(handler);
      handler(app.status);
      return function () {
        var i = app._statusListeners.indexOf(handler);
        if (i !== -1) app._statusListeners.splice(i, 1);
      };
    };

    app.setStatus = function (state, text) {
      app.status = { state: state, text: text };
      app._statusListeners.slice().forEach(function (handler) { handler(app.status); });
    };

    // --- 接続状態を TikTok アダプタから拾う
    tiktok.onStatus(function (state) {
      var live = tiktok.live || {};
      if (state !== 'connected') {
        var host = (tiktok.url || '').replace(/^https?:\/\//, '').replace(/\/events$/, '');
        app.setStatus('offline', '中継サーバー未接続' + (host ? ' (' + host + ')' : ''));
        return;
      }
      if (live.status === 'connected') app.setStatus('live', 'LIVE @' + (live.username || live.target || ''));
      else if (live.status === 'waiting') app.setStatus('waiting', '配信の開始を待っています');
      else app.setStatus('bridge', '中継サーバーに接続済み');
    });

    /**
     * 時間を進める。
     *
     * **時刻は Date.now() で統一**しています。performance.now() はウィンドウごとに
     * 原点が違うため、操作画面とゲームウィンドウの両方から呼ぶとゲーム内の時間が飛びます。
     * 引数を渡さなければエンジンが Date.now() を使います。
     *
     * 画面が 2 つあるときは、両方が毎フレームここを呼びます。進むのは実際に
     * 経過した時間ぶんだけなので速さは変わりませんが、同じ 1 フレームで 2 回
     * 計算するのは無駄です。**直前に進めたばかりなら何もしません**。
     *
     * どちらが進めるかを決め打ちにしないのは、決めた側のウィンドウが最小化
     * されると requestAnimationFrame が止まり、ゲームごと止まってしまうためです。
     * 先に来たほうが進める形にしておけば、片方が止まっても残ったほうが進めます。
     */
    var MIN_STEP_MS = 6;                  // 約 160fps 相当。これ以上細かくは進めない
    var lastStepAt = 0;

    app.update = function () {
      var now = Date.now();
      if (now - lastStepAt < MIN_STEP_MS) return false;
      lastStepAt = now;

      app.demo.update();
      if (app.director) app.director.update();
      app.engine.update();
      return true;
    };

    /** 全部やり直す。ランキングも消えます。 */
    app.reset = function () {
      app.engine.reset();
      app.leaderboard.reset();
      app.session.reset();
      if (app.director) app.director.reset();
    };

    return app;
  }

  /**
   * 操作画面が持っているゲームを探す。
   *
   * ゲームウィンドウから呼ぶと、開いてくれた画面 (opener) の塊を返します。
   * 直接 URL で開かれた場合 (OBS のブラウザソースなど) は null。
   */
  function findSharedApp(win) {
    try {
      var opener = (win || global).opener;
      if (opener && !opener.closed && opener.CB && opener.CB.app) return opener.CB.app;
    } catch (err) {
      return null;                      // 別オリジンなら触れない
    }
    return null;
  }

  global.CB = global.CB || {};
  global.CB.createApp = createApp;
  global.CB.findSharedApp = findSharedApp;
  global.CB.LIVE_ID = LIVE_ID;
})(window);
