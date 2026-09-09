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
   * 円の上に文字を出す高さ。
   *
   * 円の真ん中に出すと、その 1 秒ほどプロフィール画像が読めません。
   * 「自分の円だ」と分かることが一番大事なので、文字は必ず上へ逃がします。
   */
  function above(circle) {
    return circle.position.y - circle.radius * 1.7;
  }

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
      cannon: app.cannon,
      joinBanner: app.joinBanner,
      director: app.director,
      doc: doc,
      win: win,
      primary: Boolean(options.primary)
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

      // 背景はプレビューにも反映します (配信の見え方を確かめるため)
      config.ui.background.dim = settings.backgroundDim;
      renderer.setBackground(settings.backgroundUrl);

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

    listen(engine, 'damage', function (hit) {
      play('hit');
      // 武器で斬ったときだけ、武器ごとの斬撃・弾・衝撃を出します。
      // 本体がぶつかっただけのときに出すと、Lv1 の円まで斬撃を振ることになります。
      if (hit.source === 'weapon') renderer.attackEffect(hit.circle, hit.enemy);
    });

    // 大砲が撃った。煙と粒はここで撒きます (音も一緒に)。
    // 演出の中身は renderer が持っていて、cannon はルールだけを持ちます。
    if (app.cannon) {
      listen(app.cannon, 'fire', function (event) {
        renderer.cannonBurst(event.muzzle, app.cannon.aim(), event.shot.type);
        play(SPAWN_SFX[event.shot.sourceEvent] || 'spawn');
      });
    }

    // 最終形態の衝撃波。射程内の敵を巻き込んだときだけ出ます
    listen(engine, 'weapon:nova', function (burst) {
      var circle = burst.circle;
      var tier = renderer.weapons ? renderer.weapons.tierFor(circle.level) : null;
      renderer.flash(circle.position.x, circle.position.y,
        circle.radius * (tier && tier.hit ? tier.hit.reach : 1.7),
        (tier && tier.color) || '#facc15');
      play('rank');
    });

    listen(engine, 'enemy:killed', function (kill) {
      var type = engine.getEnemyType(kill.typeId);
      play('kill', { pitch: (type && type.killPitch) || 1 });

      // 大物だけは名前を出します。雑魚まで出すと文字で埋まります。
      if (kill.enemy.maxHp >= config.ui.bossBarMinHp) {
        renderer.float(kill.enemy.label + ' DEFEATED',
          kill.enemy.position.x, kill.enemy.position.y,
          { color: kill.enemy.color, size: 40 });
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
      renderer.float(taken.item.label, taken.circle.position.x, above(taken.circle),
        { color: taken.item.color, size: 30 });
    });

    // Lv100 は最終到達点。ここだけ他と明確に違う出し方にします
    listen(engine, 'circle:maxed', function (event) {
      var circle = event.circle;
      var tier = renderer.weapons ? renderer.weapons.tierFor(circle.level) : null;
      var color = tier ? tier.color : '#fde047';

      play('rank');
      renderer.float('LEGENDARY', circle.position.x, above(circle),
        { color: color, size: 46 });
      renderer.flash(circle.position.x, circle.position.y, circle.radius * 1.6, color);
      renderer.showStageBanner('LEVEL 100', 'LEGENDARY CORE  \u2013  NOVA', 2200);
      renderer.pushEvent(circle.ownerName, 'LEGENDARY CORE  NOVA', 'max');
    });

    // 生まれた。**自分の円が出たことが分かる**のが、次の LIKE を押す理由になります。
    listen(session, 'spawn', function (spawn) {
      // 音は大砲が撃つときに鳴らします (大砲を使わない構成のときだけここで)
      if (!app.cannon) play(SPAWN_SFX[spawn.sourceEvent] || 'spawn');

      // 入室は 1 人 1 回だけの「初めまして」なので、他の生まれ方と分けて出します。
      // 円のほうにも光る輪が出るので (renderer)、どれが自分か分かります。
      var joined = spawn.sourceEvent === 'JOIN';
      renderer.pushEvent(spawn.user.uniqueId,
        joined ? 'JOINED → Lv' + spawn.level : spawn.sourceEvent + ' → Lv' + spawn.level,
        joined ? 'join' : 'spawn');

      // 大砲があるときは、装填中に「NEW PLAYER / @名前」を出しているので
      // ここでは出しません。砲口に何人ぶんも重なって読めなくなります。
      if (joined && spawn.circle && !app.cannon) {
        var color = config.ui.join.color;
        renderer.float('WELCOME', spawn.circle.position.x, above(spawn.circle),
          { color: color, size: 34 });
        renderer.flash(spawn.circle.position.x, spawn.circle.position.y,
          spawn.circle.radius * 1.4, color);
      }
    });

    // レベルアップは 10 LIKE ごとに起きるので、行としては出しません
    // (出すと LIVE EVENT が LIKE で埋まって、他が読めなくなります)。
    listen(session, 'levelup', function (up) {
      play(SPAWN_SFX[up.sourceEvent] || 'spawn');
      // レベルの数字はその場に小さく飛ばすだけ。円のバッジも同時に変わります。
      renderer.float('Lv' + up.to, up.circle.position.x, above(up.circle),
        { color: '#7dd3fc', size: 26 });
      showWeaponUpgrade(up.circle, up.from, up.to);
    });

    /**
     * 武器の段が変わったときの演出。
     *
     * **ゲームは止めません。** 止めると、その間 TikTok の画面では何も
     * 起きていないように見えます。出すのは円のところに飛ぶ文字と閃光だけで、
     * 節目 (Lv50 / Lv100) のときだけ中央に短いバナーを足します。
     */
    function showWeaponUpgrade(circle, from, to) {
      var weapons = renderer.weapons;
      if (!weapons || !circle) return;

      var tier = weapons.tierChanged(from, to);
      if (!tier) return;
      // Lv100 は 'circle:maxed' が受け持ちます (ここでも出すと 2 重になります)
      if (tier.minLevel >= config.viewers.levels.max) return;

      renderer.float(tier.name, circle.position.x, above(circle),
        { color: tier.color, size: 38 });
      renderer.flash(circle.position.x, circle.position.y, circle.radius, tier.color);
      play('rank');

      // 能力が増える段では、何ができるようになったのかも 1 行だけ出します
      var ability = tier.ability;
      if (ability && ability.name) {
        renderer.pushEvent(circle.ownerName, tier.name + '  ' + ability.name, 'max');
      }

      // 節目だけ中央にも出します。毎段出すと 10 回ぶん画面をふさぎます
      if (config.weapons.milestones.indexOf(tier.minLevel) === -1) return;
      renderer.showStageBanner('LEVEL ' + tier.minLevel,
        tier.name + (ability ? '  \u2013  ' + ability.name : ''),
        tier.minLevel >= 100 ? 2200 : 1600);
    }

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
        { color: chained ? '#fb923c' : '#e2e8f0', size: chained ? 34 : 24 });
    });

    listen(session, 'real-event', function () {
      renderer.showNotice('VIEWERS JOINED');
    });

    // コメントはゲームには効きません。将来のコマンド用に届いていることだけ残します。
    listen(session, 'comment', function (comment) {
      console.log('[COMMENT] @' + comment.user.uniqueId + ': ' + comment.text);
    });

    // ------------------------------------------------ ラウンドと特殊イベント
    if (app.director) {
      listen(app.director, 'event', function (event) {
        renderer.showStageBanner(event.label, event.sub || '', 2200);
        renderer.pushEvent('SYSTEM', event.label, 'system');
        play('rank');
      });

      /**
       * ラウンドの終わり。
       *
       * **勝った人の名前を出します。** 数字だけ消えて次が始まると、
       * 見ていた時間が何だったのか分かりません。誰が 1 位で終わったかを
       * 出してから消します。
       */
      listen(app.director, 'round:end', function () {
        var top = app.leaderboard ? app.leaderboard.top(1) : [];
        var winner = top.length ? top[0] : null;
        renderer.showStageBanner(
          winner ? 'WINNER  @' + winner.userName : 'TIME UP',
          winner ? Math.round(winner.score).toLocaleString() + ' PTS  \u2013  NEXT ROUND STARTS SOON'
                 : 'NEXT ROUND STARTS SOON',
          config.director.resultMs || 6000);
        renderer.pushEvent(winner ? winner.userName : 'SYSTEM', 'ROUND OVER', 'system');
        play('rank');
      });

      // 消したのは app.js。ここは「また最初から」と出すだけです。
      listen(app.director, 'round:reset', function () {
        renderer.showStageBanner('NEW ROUND', 'EVERYONE STARTS FROM ZERO', 2000);
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
      if (!rank || rank <= config.ranking.size) { renderer.setSelfRank(''); return; }

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
