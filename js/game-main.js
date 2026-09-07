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
 */
(function (global) {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var CB = global.CB;
    var params = new URLSearchParams(global.location.search || '');

    // 操作画面が持っているゲームを探す
    var shared = CB.findSharedApp(global);
    var app = shared;

    if (!app) {
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

    // 配信に映す本番の画面。盤面の縦横比をこの画面に合わせます
    var view = CB.createGameView(app, { doc: document, win: global, primary: true }).start();

    // 閉じるときに購読を外す。外さないと、閉じたウィンドウの DOM を
    // 触りにいって操作画面側でエラーが出続けます。
    global.addEventListener('pagehide', function () { view.stop(); });

    global.CB.view = view;
    global.CB.renderer = view.renderer;
    global.CB.sharedApp = Boolean(shared);
  });
})(window);
