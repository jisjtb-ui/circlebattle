/**
 * main.js - 起動と 1 本のループ。
 *
 * 組み立ての向きは一方向です:
 *
 *   TikTokAdapter -> EventRouter -> GameSession -> BattleEngine -> Renderer
 *                                        \-> Leaderboard -> Renderer
 *
 * BattleEngine は TikTok を知らず、GameSession も TikTok を知りません
 * (知っているのは TikTokAdapter と EventRouter だけ)。
 *
 * LIVE を増やすときは、LIVE ごとに engine + session を 1 組作って
 * router.attach(liveId, session) するだけで並走させられます。
 *
 *   index.html            テストパネル付き
 *   index.html?obs=1      配信画面だけ
 *   index.html?offline=1  TikTok に繋がない
 *   index.html?demo=0     仮の視聴者を出さない
 */
(function (global) {
  'use strict';

  var LIVE_ID = 'live-1';

  document.addEventListener('DOMContentLoaded', function () {
    var CB = global.CB;
    var config = CB.CONFIG;
    var params = new URLSearchParams(global.location.search || '');

    if (params.get('demo') === '0') config.demo.enabled = false;
    if (params.get('sound') === '0' || params.get('mute') === '1') config.audio.enabled = false;
    if (params.get('ranking')) config.ui.rankingPosition = params.get('ranking');
    // 'auto' のときは CSS 側 (画面の縦横比) に任せる
    if (config.ui.rankingPosition !== 'auto') {
      document.body.dataset.ranking = config.ui.rankingPosition;
    }
    if (params.get('sort')) config.ranking.sortBy = params.get('sort');

    // --- 記録 (チームは無い。並ぶのは常に個人)
    var leaderboard = new CB.Leaderboard({ config: config });

    // --- ゲームのルール (TikTok を知らない)
    var engine = new CB.BattleEngine({ config: config });

    // --- ゲームイベント -> 円の生成 / ポイントの配分
    var session = new CB.GameSession(engine, {
      config: config,
      leaderboard: leaderboard,
      liveId: LIVE_ID
    });

    // --- TikTok イベント -> ゲームイベント の翻訳と振り分け
    var router = new CB.EventRouter({ config: config });
    router.attach(LIVE_ID, session);

    // --- 画面
    var avatars = new CB.AvatarCache();
    var renderer = new CB.Renderer(engine, {
      config: config,
      leaderboard: leaderboard,
      avatars: avatars
    });

    // --- 誰も反応していない間だけ動く仮の視聴者
    var demo = new CB.DemoDirector(session, { config: config });

    // --- 効果音
    //
    // ゲームのルールは音を知りません。engine と session が出す
    // 「起きたこと」を受け取って、鳴らすかどうかは SfxPlayer が決めます。
    var sfx = new CB.SfxPlayer({ config: config });

    engine.on('damage', function () { sfx.play('hit'); });

    engine.on('enemy:killed', function (kill) {
      var type = engine.getEnemyType(kill.typeId);
      sfx.play('kill', { pitch: (type && type.killPitch) || 1 });
    });

    engine.on('circle:removed', function (removed) {
      if (removed.reason === 'defeated') sfx.play('lose');
      if (removed.reason === 'burnout') sfx.play('kill', { pitch: 0.7 });
    });

    engine.on('item:taken', function (taken) {
      sfx.play('item');
      renderer.showNotice('@' + taken.owner.ownerName + ' → ' + taken.item.label);
    });

    session.on('spawn', function (spawn) {
      var byEvent = { LIKE: 'spawn', FOLLOW: 'follow', SHARE: 'share', GIFT: 'gift', JOIN: 'follow' };
      sfx.play(byEvent[spawn.sourceEvent] || 'spawn');
    });

    session.on('levelup', function (up) {
      var byEvent = { LIKE: 'spawn', FOLLOW: 'follow', SHARE: 'share', GIFT: 'gift' };
      sfx.play(byEvent[up.sourceEvent] || 'spawn');
    });

    // 1 位が入れ替わったときだけ鳴らす (順位が動くたびに鳴らすとうるさい)。
    //
    // 判定はフレームに 1 回だけです。ランキングはダメージが入るたびに更新されるので
    // (100 人規模だと毎秒 500 回)、更新のたびに並べ替えると描画より重くなります。
    var leaderId = null;
    function checkLeader() {
      var top = renderer.top && renderer.top[0];       // 描画側が並べ替えた結果を借りる
      var id = top ? top.userId : null;
      if (id && leaderId && id !== leaderId) sfx.play('rank');
      leaderId = id;
    }

    // ブラウザは操作前の自動再生を止める。止められている間だけバッジを出し、
    // 最初のクリック / キー操作で鳴らし始める。
    var mutedBadge = document.getElementById('muted');
    sfx.onBlocked(function (blocked) {
      if (mutedBadge) mutedBadge.hidden = !blocked || !sfx.enabled;
    });
    ['click', 'keydown', 'touchstart'].forEach(function (name) {
      global.addEventListener(name, function () { sfx.resume(); }, { passive: true });
    });
    sfx.resume();

    // --- TikTok の受信口
    var tiktok = new CB.TikTokAdapter(router, { liveId: LIVE_ID });

    // 画面に出す一時通知。ゲームの進行には影響しません。
    session.on('spawn', function (spawn) {
      renderer.showNotice('@' + spawn.user.uniqueId + ' → Lv' + spawn.level +
                          ' (' + spawn.sourceEvent + ')');
    });

    // 最大レベルに届いたときだけ知らせる (毎回のレベルアップを出すと流れ続けます)
    engine.on('circle:maxed', function (event) {
      renderer.showNotice('@' + event.circle.ownerName + ' → MAX LEVEL');
      sfx.play('rank');
    });

    // コメントは今回のゲームでは何もしません。将来のコマンド用に
    // イベントとしては届いていることが分かるよう、コンソールにだけ出します。
    session.on('comment', function (comment) {
      console.log('[COMMENT] @' + comment.user.uniqueId + ': ' + comment.text);
    });

    session.on('real-event', function () {
      renderer.showNotice('VIEWERS JOINED');
    });

    // --- 接続の状態表示
    tiktok.onStatus(function (status) {
      var live = tiktok.live || {};
      if (status !== 'connected') {
        // どこを見にいっているかを出す。繋がらないときの切り分けに要ります。
        var host = (tiktok.url || '').replace(/^https?:\/\//, '').replace(/\/events$/, '');
        renderer.setStatus('offline', '中継サーバー未接続' + (host ? ' (' + host + ')' : ''));
        return;
      }
      if (live.status === 'connected') {
        renderer.setStatus('live', 'LIVE @' + (live.username || live.target || ''));
      } else if (live.status === 'waiting') {
        renderer.setStatus('waiting', '配信の開始を待っています');
      } else {
        renderer.setStatus('bridge', '中継サーバーに接続済み');
      }
    });

    var controls = new CB.Controls({
      tiktok: tiktok,
      engine: engine,
      session: session,
      leaderboard: leaderboard,
      renderer: renderer,
      sfx: sfx
    });

    // --- 配信画面モード
    if (params.get('obs') === '1') {
      document.body.classList.add('obs');
    }

    // ------------------------------------------------------------ ループ
    //
    // このゲームの最重要仕様: TikTok のイベントが 0 件でも画面は動き続けます。
    // 敵はここで自動生成され、動き、ぶつかり、倒されます。
    engine.start(performance.now());

    function frame(now) {
      demo.update(now);
      engine.update(now);
      renderer.draw(now);
      checkLeader();
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);

    // --- TikTok へ繋ぐ (?offline=1 のときは繋がない)
    if (params.get('offline') !== '1') {
      renderer.setStatus('offline', '中継サーバーを探しています…');
      tiktok.connect().then(function (ok) {
        if (!ok) {
          console.warn('[CB] 中継サーバーが見つかりませんでした。tikhub を起動してください。' +
                       ' 別の PC で動かしている場合は ?bridge=http://その PC:8787/events を付けてください。');
        }
      });
    } else {
      renderer.setStatus('offline', 'オフライン');
    }

    // コンソール / OBS スクリプトから触れるように公開する
    global.CB.engine = engine;
    global.CB.session = session;
    global.CB.router = router;
    global.CB.renderer = renderer;
    global.CB.leaderboard = leaderboard;
    global.CB.avatars = avatars;
    global.CB.controls = controls;
    global.CB.demo = demo;
    global.CB.sfx = sfx;
    global.CB.tiktok = tiktok;
    global.CB.LIVE_ID = LIVE_ID;

    /** 全部やり直す。ランキングも消えます。 */
    global.CB.reset = function () {
      engine.reset();
      leaderboard.reset();
      session.reset();
    };
  });
})(window);
