/**
 * game-view.js - 「見せる側」ひとまとめ。
 *
 * ゲームの状態 (app.js) を受け取って、渡されたウィンドウへ描き、音を鳴らします。
 * ルールは 1 つも持ちません。ここを丸ごと消してもゲームは動きます (誰も見えないだけ)。
 *
 *   操作画面 (index.html)  … 小さいプレビューとして持つ
 *   ゲーム画面 (game.html) … 配信に映す本番として持つ
 *
 * 同じ app に対して 2 つ作れます。状態は 1 つなので、両方に同じ盤面が出ます。
 *
 * ここが担当するのは「今なにが起きたか」を一目で分かるようにすることです:
 *
 *   生まれた   … 円にアイコンと名前が出る + LIVE EVENT に 1 行
 *   倒した     … その場に +KILL / +SCORE が飛ぶ
 *   連続撃破   … COMBO x3 (3 連続から)
 *   順位が動いた … NEW RANK #7 / 圏外の人には YOU #23
 *   大物が出た … 上部に HP ゲージ (居る間だけ)
 *
 * どれも短く、盤面を止めません。止めてしまうと、その間ゲームを見られません。
 */
(function (global) {
  'use strict';

  /** LIVE EVENT に出す文言。COMMENT はゲームに影響しないので出しません。 */
  var SPAWN_SFX = { LIKE: 'spawn', FOLLOW: 'follow', SHARE: 'share', GIFT: 'gift', JOIN: 'follow' };

  /**
   * @param {object} app     CB.createApp() が返す塊 (共有されているもの)
   * @param {object} options { doc, win, preview }
   *        preview: true なら操作画面の中の小さい表示。音は鳴らしません
   *        (ゲームウィンドウと二重に鳴るため)。
   */
  function createGameView(app, options) {
    options = options || {};
    var CB = global.CB;
    var doc = options.doc || global.document;
    var win = options.win || doc.defaultView || global;
    var config = app.config;
    var preview = Boolean(options.preview);

    var renderer = new CB.Renderer(app.engine, {
      config: config,
      leaderboard: app.leaderboard,
      avatars: app.avatars,
      doc: doc,
      win: win
    });

    var sfx = new CB.SfxPlayer({ config: config });
    var bgm = null;                       // 使うときに作ります
    var unsubscribe = [];
    var running = true;
    var frameId = null;

    /**
     * 購読を 1 つ登録して、外し方を控えておく。
     *
     * ゲームウィンドウは閉じられます。閉じたあとも handler が残っていると、
     * 既に無いウィンドウの音や DOM を触りにいって、**残っている操作画面側で**
     * エラーが出続けます (エンジンは 2 つの画面で共有しているためです)。
     */
    function listen(source, name, handler) {
      source.on(name, handler);
      unsubscribe.push(function () { source.off(name, handler); });
    }

    var view = {
      app: app,
      renderer: renderer,
      sfx: sfx,
      doc: doc,
      win: win,
      preview: preview
    };

    // ------------------------------------------------------------- 音
    //
    // 操作画面のプレビューでは鳴らしません。2 つのウィンドウで同じ音が
    // わずかにずれて鳴ると、それだけで聞き苦しくなります。
    function play(name, opts) {
      if (!preview) sfx.play(name, opts);
    }

    /** BGM は <audio> 1 つ。ユーザーが選んだ MP3 をそのまま鳴らします。 */
    function ensureBgm() {
      if (bgm || preview) return bgm;
      bgm = doc.createElement('audio');
      bgm.loop = true;
      bgm.hidden = true;
      doc.body.appendChild(bgm);
      return bgm;
    }

    function applySettings(settings) {
      sfx.setEnabled(settings.sfxEnabled);
      sfx.setVolume(settings.sfxVolume);
      if (preview) return;

      var player = settings.bgmUrl ? ensureBgm() : bgm;
      if (!player) return;

      if (settings.bgmUrl && player.getAttribute('src') !== settings.bgmUrl) {
        player.src = settings.bgmUrl;
      }
      player.volume = settings.bgmVolume;

      if (settings.bgmPlaying && settings.bgmUrl) {
        // 自動再生を止められることがあります。止められても他は動くので握りつぶします。
        var promise = player.play();
        if (promise && promise.catch) promise.catch(function () {});
      } else {
        player.pause();
      }
    }
    unsubscribe.push(app.onSettings(applySettings));

    unsubscribe.push(app.onStatus(function (status) {
      renderer.setStatus(status.state, status.text);
    }));

    // ブラウザは操作前の自動再生を止めます。止められている間だけバッジを出し、
    // 最初のクリック / キー操作で鳴らし始めます。
    var mutedBadge = doc.getElementById('muted');
    sfx.onBlocked(function (blocked) {
      if (mutedBadge) mutedBadge.hidden = !blocked || !sfx.enabled;
    });
    ['click', 'keydown', 'touchstart'].forEach(function (name) {
      win.addEventListener(name, function () { sfx.resume(); }, { passive: true });
    });
    sfx.resume();

    // --------------------------------------------------- 起きたことを見せる

    var engine = app.engine;
    var session = app.session;

    listen(engine, 'damage', function () { play('hit'); });

    listen(engine, 'enemy:killed', function (kill) {
      var type = engine.getEnemyType(kill.typeId);
      play('kill', { pitch: (type && type.killPitch) || 1 });

      // 大物だけは名前を出します。雑魚まで出すと文字で埋まります。
      if (kill.enemy.maxHp >= config.ui.bossBarMinHp) {
        renderer.float(kill.enemy.label + ' DEFEATED',
          kill.enemy.position.x, kill.enemy.position.y,
          { color: kill.enemy.color, size: 52 });
      }
    });

    listen(engine, 'circle:removed', function (removed) {
      if (removed.reason === 'defeated') play('lose');
      if (removed.reason === 'burnout') play('kill', { pitch: 0.7 });
    });

    listen(engine, 'stage:change', function (change) {
      if (change.growing) {
        renderer.showStageBanner('STAGE EXPANDED',
          'MORE ROOM – STAGE ' + (change.stage + 1) + ' ×' + change.scale.toFixed(2),
          change.durationMs);
      } else {
        renderer.showStageBanner('STAGE SHRINKING',
          change.stage === 0 ? 'BACK TO NORMAL SIZE'
            : 'STAGE ' + (change.stage + 1) + ' ×' + change.scale.toFixed(2),
          change.durationMs);
      }
      play('rank');
    });

    listen(engine, 'item:taken', function (taken) {
      play('item');
      renderer.float(taken.item.label, taken.circle.position.x, taken.circle.position.y,
        { color: taken.item.color, size: 36 });
    });

    listen(engine, 'circle:maxed', function (event) {
      play('rank');
      renderer.float('MAX LEVEL', event.circle.position.x, event.circle.position.y,
        { color: '#fde047', size: 46 });
      renderer.pushEvent(event.circle.ownerName, 'MAX LEVEL', 'max');
    });

    // 生まれた。**自分の円が出たことが分かる**のが、次の LIKE を押す理由になります。
    listen(session, 'spawn', function (spawn) {
      play(SPAWN_SFX[spawn.sourceEvent] || 'spawn');
      renderer.pushEvent(spawn.user.uniqueId,
        spawn.sourceEvent + ' → Lv' + spawn.level, 'spawn');
    });

    // レベルアップは 10 LIKE ごとに起きるので、行としては出しません
    // (出すと LIVE EVENT が LIKE で埋まって、他が読めなくなります)。
    listen(session, 'levelup', function (up) {
      play(SPAWN_SFX[up.sourceEvent] || 'spawn');
      // レベルの数字はその場に小さく飛ばすだけ。円のバッジも同時に変わります。
      renderer.float('Lv' + up.to, up.circle.position.x, up.circle.position.y,
        { color: '#7dd3fc', size: 30 });
    });

    // 順番待ちに入った。押した操作が捨てられていないことを見せます。
    listen(session, 'queued', function (queued) {
      renderer.pushEvent(queued.user.uniqueId, 'QUEUED ×' + queued.waiting, 'queue');
    });

    listen(session, 'kill', function (kill) {
      var enemy = kill.enemy;
      if (!enemy) return;

      // 連続撃破のときだけ大きく出します。毎回大きく出すと、
      // 撃破が多い時間帯に文字だけの画面になってフィールドが見えません。
      var chained = kill.combo >= (config.combo.showFrom || 3);
      renderer.float(
        '+' + Math.round(kill.points) + (chained ? '  COMBO x' + kill.combo : ''),
        enemy.position.x, enemy.position.y,
        { color: chained ? '#fb923c' : '#e2e8f0', size: chained ? 42 : 28 });
    });

    listen(session, 'real-event', function () {
      renderer.showNotice('VIEWERS JOINED');
    });

    // コメントはゲームには効きません。将来のコマンド用に届いていることだけ残します。
    listen(session, 'comment', function (comment) {
      console.log('[COMMENT] @' + comment.user.uniqueId + ': ' + comment.text);
    });

    // ------------------------------------------------ ウェーブと特殊イベント
    if (app.director) {
      renderer.setWave(app.director.wave);

      listen(app.director, 'wave', function (wave) {
        renderer.setWave(wave.wave);
        // 特殊イベントが起きる回は、そちらの文字を優先します (2 枚重ねない)
        if (!wave.event) {
          renderer.showStageBanner('WAVE ' + wave.wave, 'THE ENEMY KEEPS COMING', 1800);
          play('rank');
        }
      });

      listen(app.director, 'event', function (event) {
        renderer.showStageBanner(event.label, event.sub || '', 2200);
        renderer.pushEvent('SYSTEM', event.label, 'system');
        play('rank');
      });
    }

    // --------------------------------------------------------- 順位の変化
    //
    // 順位はダメージが入るたびに動くので (100 人規模だと毎秒 500 回)、
    // 変化を見るのはフレームに 1 回だけにします。並べ替えは leaderboard 側で
    // 1 回だけ行われ、ここはその結果を借ります。
    var leaderId = null;
    /**
     * 前のフレームの順位。**この画面ごとに**持ちます。
     *
     * ランキング自体は 2 つの画面で共有ですが、「前に何位だったか」は
     * 見ている画面ごとの話です。共有側に置くと、先に見たほうが変化を
     * 食べてしまい、もう片方に演出が出なくなります。
     */
    var previousRanks = null;

    function checkRanks() {
      var top = renderer.top;
      if (!top) return;

      var leader = top[0];
      var id = leader ? leader.userId : null;
      if (id && leaderId && id !== leaderId) play('rank');
      leaderId = id;

      var current = {};
      for (var i = 0; i < top.length; i += 1) current[top[i].userId] = i + 1;

      // 初回は何も出しません。開いた瞬間に全員ぶん流れるのを避けます。
      if (previousRanks) {
        for (var j = 0; j < top.length; j += 1) {
          var record = top[j];
          var rank = j + 1;
          var from = previousRanks[record.userId] || 0;
          if (from === rank) continue;

          // 動いた人を全部出すと毎フレーム流れます。**上がった実感**が要るだけなので、
          // 新規ランクインと TOP3 内での上昇に絞ります。
          var rankedIn = from === 0;
          if (!rankedIn && (rank > 3 || from < rank)) continue;

          renderer.pushEvent(record.userName,
            (rankedIn ? 'NEW RANK #' : 'RANK UP #') + rank, 'rank');
        }
      }
      previousRanks = current;
    }

    /**
     * TOP10 の外に居る人へ、自分の順位を出す。
     *
     * 常に全員ぶんは出せないので、**直近に動いた人**を 1 人だけ出します。
     * 追いかける目標が見えないと、圏外の人はそこで見るのをやめます。
     */
    var selfRankAt = 0;

    function updateSelfRank(now) {
      // 出す相手は 2 秒に 1 回だけ選び直します。毎フレーム選ぶと、
      // 視聴者が多いときに名前がちらついて誰の順位だか読めません。
      if (now - selfRankAt < 2000) return;
      selfRankAt = now;

      var recent = app.leaderboard.mostRecent && app.leaderboard.mostRecent();
      if (!recent) { renderer.setSelfRank(''); return; }

      var rank = app.leaderboard.rankOf(recent.userId);
      if (!rank || rank <= config.ui.rankingSize) { renderer.setSelfRank(''); return; }

      // 「あと少し」を 1 つだけ添えます。2 つ以上並べると、どちらも読まれません。
      var top = renderer.top || [];
      var target = top[top.length - 1];
      var gap = target ? Math.max(0, Math.round(target.score - recent.score)) : 0;
      var hint = gap > 0
        ? gap.toLocaleString() + ' TO TOP10'
        : app.session.likesToNextLevel(recent.userId) + ' LIKES TO Lv' + (recent.level + 1);

      renderer.setSelfRank('@' + recent.userName + ' #' + rank + '  –  ' + hint);
    }

    // ------------------------------------------------------------ ループ
    //
    // 時刻は Date.now() で統一します。performance.now() はウィンドウごとに
    // 原点が違うため、操作画面とゲームウィンドウの両方から回すと時間が飛びます。
    function frame() {
      if (!running) return;
      var now = Date.now();
      app.update();
      renderer.draw(now);
      checkRanks();
      updateSelfRank(now);
      frameId = win.requestAnimationFrame(frame);
    }

    view.start = function () {
      if (frameId != null) return view;
      running = true;
      frameId = win.requestAnimationFrame(frame);
      return view;
    };

    /** ウィンドウを閉じるときに呼びます。購読を外さないと閉じたあとも呼ばれます。 */
    view.stop = function () {
      running = false;
      if (frameId != null) win.cancelAnimationFrame(frameId);
      frameId = null;
      unsubscribe.forEach(function (off) { off(); });
      unsubscribe = [];
      if (bgm) bgm.pause();
      return view;
    };

    return view;
  }

  global.CB = global.CB || {};
  global.CB.createGameView = createGameView;
})(window);
