/**
 * main.js - 操作画面 (index.html) の起動。
 *
 * 組み立ての向きは一方向のままです:
 *
 *   TikTokAdapter -> EventRouter -> GameSession -> BattleEngine -> Renderer
 *                                        \-> Leaderboard -> Renderer
 *
 * BattleEngine は TikTok を知らず、GameSession も TikTok を知りません
 * (知っているのは TikTokAdapter と EventRouter だけ)。
 *
 * この画面が**ゲームの持ち主**です。ゲームウィンドウ (game.html) は
 * window.opener.CB.app からここのゲームを読んで描くだけなので、
 * ゲームが 2 つ動くことはありません。
 *
 *   index.html?offline=1  TikTok に繋がない
 *   index.html?demo=0     仮の視聴者を出さない
 *   index.html?game=1     開いた直後にゲームウィンドウも開く
 */
(function (global) {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var CB = global.CB;
    var config = CB.CONFIG;
    var params = new URLSearchParams(global.location.search || '');

    if (params.get('demo') === '0') config.demo.enabled = false;
    if (params.get('sound') === '0' || params.get('mute') === '1') config.audio.enabled = false;
    if (params.get('sort')) config.ranking.sortBy = params.get('sort');

    // --- ゲーム本体 (この 1 つだけ)
    var app = CB.createApp({ config: config });
    global.CB.app = app;                 // ゲームウィンドウはここを読みます

    // --- 操作画面の中の小さいプレビュー。音は鳴らしません
    //     (ゲームウィンドウと二重に鳴るため)。
    var view = CB.createGameView(app, { doc: document, win: global, preview: true });

    var controls = new CB.Controls({ app: app });
    var panel = new CB.ControlPanel(app, view);

    // ------------------------------------------------------------ ループ
    //
    // このゲームの最重要仕様: TikTok のイベントが 0 件でも画面は動き続けます。
    // 敵はここで自動生成され、動き、ぶつかり、倒されます。
    //
    // 時刻は Date.now() で統一しています。ゲームウィンドウからも同じゲームを
    // 進めるので、ウィンドウごとに原点が違う performance.now() は使えません。
    app.engine.start(Date.now());
    view.start();

    // --- TikTok へ繋ぐ (?offline=1 のときは繋がない)
    if (params.get('offline') !== '1') {
      app.setStatus('offline', '中継サーバーを探しています…');
      app.tiktok.connect().then(function (ok) {
        if (!ok) {
          console.warn('[CB] 中継サーバーが見つかりませんでした。tikhub を起動してください。' +
                       ' 別の PC で動かしている場合は ?bridge=http://その PC:8787/events を付けてください。');
        }
      });
    } else {
      app.setStatus('offline', 'オフライン');
    }

    if (params.get('game') === '1') panel.openGameWindow();

    // コンソール / OBS スクリプトから触れるように公開する
    global.CB.engine = app.engine;
    global.CB.session = app.session;
    global.CB.router = app.router;
    global.CB.leaderboard = app.leaderboard;
    global.CB.avatars = app.avatars;
    global.CB.demo = app.demo;
    global.CB.director = app.director;
    global.CB.tiktok = app.tiktok;
    global.CB.renderer = view.renderer;
    global.CB.sfx = view.sfx;
    global.CB.view = view;
    global.CB.controls = controls;
    global.CB.panel = panel;
    global.CB.reset = app.reset;
  });
})(window);
