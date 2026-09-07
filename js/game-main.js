/**
 * game-main.js - ゲームウィンドウ (game.html) の起動。
 *
 * 開かれ方は 2 通りあります。どちらでも同じ画面になります。
 *
 *   1. 操作画面の [ OPEN GAME WINDOW ] から開かれた
 *      → 操作画面が持っているゲームをそのまま描きます (別プロセスにはしません)。
 *        設定・音量・接続は操作画面のものがそのまま効きます。
 *
 *   2. URL で直接開かれた (OBS のブラウザソースなど)
 *      → 相手が居ないので、この画面が自分でゲームを組み立てて動かします。
 *
 *   game.html?offline=1  TikTok に繋がない (1 のときだけ)
 *   game.html?demo=0     仮の視聴者を出さない
 *
 * 操作画面を読み込み直すと、あちらのゲームは**作り直されます**。
 * こちらが古いほうを掴んだままだと、2 つの画面で別々のゲームが動いてしまうので、
 * 入れ替わりを見張って、新しいほうへ繋ぎ直します (watchOpener)。
 */
(function (global) {
  'use strict';

  /** 操作画面の入れ替わりを見にいく間隔 (ミリ秒)。 */
  var WATCH_MS = 800;

  document.addEventListener('DOMContentLoaded', function () {
    var CB = global.CB;
    var params = new URLSearchParams(global.location.search || '');

    // 操作画面が持っているゲームを探す
    var shared = CB.findSharedApp(global);
    var standalone = !shared;
    var app = shared;

    if (standalone) {
      // 単独で開かれた。この画面が持ち主になります。
      var config = CB.CONFIG;
      if (params.get('demo') === '0') config.demo.enabled = false;
      // OBS のブラウザソースから背景を指定できるようにする
      if (params.get('bg')) config.ui.background.url = params.get('bg');
      if (params.get('dim')) config.ui.background.dim = Number(params.get('dim'));
      app = CB.createApp({ config: config });
      global.CB.app = app;
      app.engine.start(Date.now());

      if (params.get('offline') !== '1') {
        app.setStatus('offline', '中継サーバーを探しています…');
        app.tiktok.connect();
      } else {
        app.setStatus('offline', 'オフライン');
      }
    }

    var view = null;
    var bound = null;

    /** ゲーム 1 つに画面を繋ぐ。前のがあれば先に外します。 */
    function mount(next) {
      if (view) view.stop();
      bound = next;
      // 配信に映す本番の画面。盤面の縦横比をこの画面に合わせます
      view = CB.createGameView(next, { doc: document, win: global, primary: true }).start();

      global.CB.view = view;
      global.CB.renderer = view.renderer;
      global.CB.app = next;
    }

    mount(app);
    global.CB.sharedApp = !standalone;

    // 閉じるときに購読を外す。外さないと、閉じたウィンドウの DOM を
    // 触りにいって操作画面側でエラーが出続けます。
    global.addEventListener('pagehide', function () { if (view) view.stop(); });

    if (standalone) return;                 // 見張る相手がいません

    /**
     * 操作画面のゲームが入れ替わっていないか見にいく。
     *
     * 起きるのはこの 2 つです:
     *   - 操作画面が読み込み直された → 新しいゲームへ繋ぎ直す
     *   - 操作画面が閉じられた       → こちらだけでは続けられないので知らせる
     *
     * 黙って古いほうを描き続けると、2 つの画面で別々のゲームが動いていることに
     * 気づけません (配信にはそちらが映ります)。
     */
    var lost = false;
    global.setInterval(function () {
      var current = CB.findSharedApp(global);

      if (current && current !== bound) {
        mount(current);                     // 操作画面が読み込み直された
        lost = false;
        view.renderer.showNotice('RECONNECTED TO CONTROL WINDOW');
        return;
      }

      if (!current && !lost) {
        lost = true;
        if (view) view.stop();              // 消えたゲームを触り続けない
        view.renderer.setStatus('offline', '操作画面が閉じられました');
        view.renderer.showStageBanner('CONTROL WINDOW CLOSED',
          'REOPEN IT FROM index.html', 60000);
      }
    }, WATCH_MS);
  });
})(window);
