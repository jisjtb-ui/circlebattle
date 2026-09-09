/**
 * renderer.js - 画面を描く。
 *
 * ここは engine と leaderboard を「読むだけ」です。ルールを 1 つも持たないので、
 * 見た目を全部書き換えてもゲームの挙動は変わりません。
 *
 *   バトルフィールド … canvas (敵と視聴者円)
 *   まわりの表示     … DOM (ENEMIES DEFEATED / TOP 10 / 通知)
 */
(function (global) {
  'use strict';

  /**
   * このレンダラーは「どのウィンドウにでも描ける」ようにしてあります。
   *
   * 配信用のゲームウィンドウ (game.html) は、操作画面 (index.html) が持っている
   * のと同じ engine / leaderboard を読み、自分のウィンドウの canvas へ描きます。
   * そのため document と window は外から渡せるようにしてあります。
   */

  /**
   * ユーザー ID から色を作る。同じ人はいつも同じ色になります。
   *
   * FNV-1a で散らしてから黄金角 (137.5 度) 刻みに割り当てます。
   * viewer1 / viewer2 のように似た ID が続いても色が固まりません。
   */
  function ownerHue(id) {
    var hash = 2166136261;
    for (var i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.round((Math.abs(hash % 1000) * 137.508) % 360);
  }

  function initial(name) {
    var text = String(name || '?').replace(/^@/, '');
    return text.charAt(0).toUpperCase() || '?';
  }

  /**
   * 長い名前を切り詰める。
   *
   * 大砲は画面の端にあるので、長い名前をそのまま出すと画面の外へ出て
   * 読めなくなります。切るなら前を残します (@ から数文字で誰か分かるため)。
   */
  function clip(name, max) {
    var text = String(name || '');
    return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
  }

  function Renderer(engine, options) {
    options = options || {};
    this.engine = engine;
    this.config = options.config || engine.config;
    this.leaderboard = options.leaderboard || null;
    this.avatars = options.avatars || null;

    /**
     * 配信に映す本番の画面かどうか。
     * true のときだけ、盤面の縦横比を自分の canvas に合わせます。
     */
    this.primary = Boolean(options.primary);
    /** 盤面を中央に寄せるためのずれ (px)。primary では 0。 */
    this.originX = 0;
    this.originY = 0;

    /** 描き込む先のウィンドウ。省略するとこのページ。 */
    this.doc = options.doc || document;
    this.win = options.win || this.doc.defaultView || global;

    var doc = this.doc;
    var $ = function (id) { return doc.getElementById(id); };

    this.el = {
      canvas: $('field'),
      defeated: $('defeated'),
      enemiesAlive: $('enemies-alive'),
      circlesAlive: $('circles-alive'),
      players: $('players'),
      rankingList: $('ranking-list'),
      rankingMetric: $('ranking-metric'),
      rankingEmpty: $('ranking-empty'),
      selfRank: $('self-rank'),
      eventFeed: $('event-feed'),
      bossBar: $('boss-bar'),
      bossBarLabel: $('boss-bar-label'),
      bossBarFill: $('boss-bar-fill'),
      bossBarValue: $('boss-bar-value'),
      roundTime: $('round-time'),
      roundBox: $('round-box'),
      notice: $('notice'),
      stageBanner: $('stage-banner'),
      stageBannerMain: $('stage-banner-main'),
      stageBannerSub: $('stage-banner-sub'),
      joinBanner: $('join-banner'),
      joinBannerName: $('join-banner-name'),
      joinBannerLabel: $('join-banner-label'),
      joinBannerMore: $('join-banner-more'),
      status: $('status'),
      statusText: $('status-text')
    };

    /** 画面に出ているイベント (最新数件だけ)。 */
    this._events = [];

    this.ctx = this.el.canvas ? this.el.canvas.getContext('2d') : null;
    this.scale = 1;
    this._cssWidth = 0;
    this._cssHeight = 0;

    /** 撃破の閃光。見た目だけの短命なリスト。 */
    this._bursts = [];
    /** 「+1 KILL」のように飛ぶ短い文字。見た目だけです。 */
    this._floats = [];
    /** 攻撃したときの短い線。使い回すので配列は伸び縮みしません。 */
    this._attacks = [];
    /** 発射の煙と粒。見た目だけの短命なリストです。 */
    this._sparks = [];
    /** 円を撃ち出す大砲 (js/cannon.js)。状態を読んで描くだけです。 */
    this.cannon = options.cannon || null;
    /** 入室した人の名前を中央に出す係 (js/join-banner.js)。同じく読むだけです。 */
    this.joinBanner = options.joinBanner || null;
    /** ラウンドの残り時間を持っている進行役 (js/director.js)。読むだけです。 */
    this.director = options.director || null;
    /** 今 DOM に出している残り秒。変わったときだけ書き換えます。 */
    this._roundLeft = -1;
    /** 今 DOM に出している名前の通し番号。変わったときだけ出し直します。 */
    this._joinSerial = -1;
    /** 中央バナーと重ならないように下へ逃がしているか。 */
    this._joinLow = false;

    /**
     * 武器の見た目。レベルだけを見て描き、ステータスには一切触りません。
     * 絵はこのウィンドウの document で作るので、ウィンドウごとに 1 つ持ちます。
     */
    this.weapons = this.config.weapons
      ? new (options.Weapons || global.CB.Weapons)({ config: this.config, doc: this.doc })
      : null;
    this._rankingVersion = -1;
    this._rows = [];
    this._noticeTimer = null;

    var self = this;
    engine.on('item:taken', function (taken) {
      self._bursts.push({
        x: taken.circle.position.x,
        y: taken.circle.position.y,
        radius: taken.circle.radius,
        color: taken.item.color,
        at: taken.at || Date.now()
      });
      if (self._bursts.length > 40) self._bursts.shift();
    });

    engine.on('enemy:killed', function (kill) {
      self._bursts.push({
        x: kill.enemy.position.x,
        y: kill.enemy.position.y,
        radius: kill.enemy.radius,
        color: kill.enemy.color,
        at: kill.at || Date.now()
      });
      if (self._bursts.length > 40) self._bursts.shift();
    });

    this._buildRanking();
  }

  // ------------------------------------------------------------ canvas

  Renderer.prototype._resize = function () {
    var canvas = this.el.canvas;
    if (!canvas) return;

    var rect = canvas.getBoundingClientRect();
    var dpr = this.win.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;

    var resized = rect.width !== this._cssWidth || rect.height !== this._cssHeight ||
                  canvas.width !== Math.round(rect.width * dpr);
    if (resized) {
      this._cssWidth = rect.width;
      this._cssHeight = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    /*
     * 配信に映す画面 (primary) では、**盤面を画面の比に合わせます**。
     * 合わせないと上下か左右に隙間ができて「画面一面がスタジアム」になりません。
     * 操作画面のプレビューは合わせません (小さい窓の比に盤面が引きずられると、
     * 配信の見え方と違ってしまうため)。
     */
    if (this.primary && this.engine.setFieldAspect) {
      this.engine.setFieldAspect(rect.width / rect.height);
    }

    var field = this.engine.field;
    this.scale = Math.min(rect.width / field.width, rect.height / field.height);

    // 盤面が画面より小さいときは中央に置きます (プレビュー用)。
    // ずらしたぶんは transform に入れるので、描く側は気にしなくて済みます。
    this.originX = (rect.width - field.width * this.scale) / 2;
    this.originY = (rect.height - field.height * this.scale) / 2;
    this.ctx.setTransform(dpr, 0, 0, dpr, this.originX * dpr, this.originY * dpr);
  };

  Renderer.prototype.draw = function (now) {
    if (!this.ctx) return;
    this._resize();

    var ctx = this.ctx;
    var scale = this.scale;
    var w = this.engine.field.width * scale;
    var h = this.engine.field.height * scale;

    this._drawBackground(ctx, w, h);      // 不透明なので clearRect は要りません

    var state = this.engine.getState();
    var i;

    // アイテムは一番下に描く。円と重なっても、拾う側が隠れないように。
    for (i = 0; i < state.items.length; i += 1) {
      this._drawItem(ctx, state.items[i], scale, now);
    }
    for (i = 0; i < state.enemies.length; i += 1) {
      this._drawEnemy(ctx, state.enemies[i], scale);
    }
    // 大砲は盤面の一部。円や敵より先に描いて、上に重ならないようにします。
    if (this.cannon) this._drawCannon(ctx, scale, now);

    // 入室した人の円を目立たせる輪。円より先に描くので、
    // どれだけ光っても顔が隠れることはありません。
    if (this.config.ui.join.highlightMs > 0) {
      for (i = 0; i < state.circles.length; i += 1) {
        this._drawJoinRing(ctx, state.circles[i], scale, now);
      }
    }
    // 撃ち出されて飛んでいる円の速度線。円より先に描いて尾に見せます。
    for (i = 0; i < state.circles.length; i += 1) {
      this._drawLaunchTrail(ctx, state.circles[i], scale, now);
    }
    // 武器は円より**先に**描きます。あとから円を描けば、どんな武器でも
    // プロフィール画像の上に来ることがありません。
    if (this.weapons) {
      for (i = 0; i < state.circles.length; i += 1) {
        var armed = state.circles[i];
        this.weapons.draw(ctx, armed, armed.position.x * scale, armed.position.y * scale,
          armed.radius * scale, now, scale);
      }
    }
    for (i = 0; i < state.circles.length; i += 1) {
      this._drawCircle(ctx, state.circles[i], scale, now);
    }
    this._drawAttacks(ctx, scale, now);
    this._drawSparks(ctx, scale, now);
    if (this.debugHits) this._drawHitboxes(ctx, state.circles, scale);
    // レベルは円を全部描いたあとに描きます。円と一緒に描くと、
    // あとから描かれた円の下に隠れて読めなくなるためです。
    for (i = 0; i < state.circles.length; i += 1) {
      this._drawLevel(ctx, state.circles[i], scale);
    }
    // 名前は円を全部描いたあとに。円の下に隠れると誰の円か分かりません。
    if (this.config.ui.nameTagMs > 0) {
      for (i = 0; i < state.circles.length; i += 1) {
        this._drawNameTag(ctx, state.circles[i], scale, now);
      }
    }
    if (this.config.ui.join.highlightMs > 0) {
      for (i = 0; i < state.circles.length; i += 1) {
        this._drawJoinLabel(ctx, state.circles[i], scale, now);
      }
    }
    this._drawBursts(ctx, scale, now);
    this._drawFloats(ctx, scale, now);
    this._syncJoinBanner(now);
    this._syncRoundTime(now);
    this._drawHud(state);
    this.renderRanking();
    this._expireEvents(now);
  };

  /**
   * 背景 (下地と罫線) は毎フレーム同じなので、1 枚作っておいて貼るだけにします。
   * 下地は不透明なので、貼れば前のフレームも消えます (clearRect が要りません)。
   */
  Renderer.prototype._drawBackground = function (ctx, w, h) {
    var settings = this.config.ui.background || {};
    var image = this._bgImage;
    var key = (image ? image.src : '') + ':' + settings.dim;

    if (!this._bg || this._bgWidth !== w || this._bgHeight !== h || this._bgKey !== key) {
      var canvas = this.doc.createElement('canvas');
      var dpr = this.win.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      var bg = canvas.getContext('2d');
      bg.setTransform(dpr, 0, 0, dpr, 0, 0);

      bg.fillStyle = settings.color || '#090a18';
      bg.fillRect(0, 0, w, h);

      if (image) {
        // 1080x1920 の絵をフィールドいっぱいに敷きます。座標は 1 対 1 なので、
        // 絵の中の位置がそのまま盤面の位置になります。
        bg.drawImage(image, 0, 0, w, h);
        // 円と敵を見やすくするための暗幕。濃さは config で変えられます。
        if (settings.dim > 0) {
          bg.fillStyle = 'rgba(4, 5, 14, ' + settings.dim + ')';
          bg.fillRect(0, 0, w, h);
        }
      } else {
        bg.strokeStyle = 'rgba(120, 140, 255, 0.10)';
        bg.lineWidth = 1;
        var step = w / 10;
        for (var i = 1; i * step < h; i += 1) {
          bg.beginPath();
          bg.moveTo(0, i * step);
          bg.lineTo(w, i * step);
          bg.stroke();
        }
        for (var k = 1; k < 10; k += 1) {
          bg.beginPath();
          bg.moveTo(k * step, 0);
          bg.lineTo(k * step, h);
          bg.stroke();
        }
      }

      this._bg = canvas;
      this._bgWidth = w;
      this._bgHeight = h;
      this._bgKey = key;
    }

    // 盤面が画面より小さいとき、外側に前のフレームが残らないように塗ります
    if (this.originX > 0.5 || this.originY > 0.5) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04050e';
      ctx.fillRect(0, 0, this.el.canvas.width, this.el.canvas.height);
      ctx.restore();
    }

    ctx.drawImage(this._bg, 0, 0, w, h);
  };

  /**
   * 盤面の背景に画像を敷く。
   *
   * 1080x1920 で作ると、絵の座標とフィールドの座標がそのまま一致します。
   * 読み込みに失敗しても既定の下地に戻るだけで、ゲームは止まりません。
   *
   * @param {string|null} url null で既定の下地に戻します
   */
  Renderer.prototype.setBackground = function (url) {
    if (!url) {
      this._bgImage = null;
      this._bg = null;
      return this;
    }
    if (this._bgImage && this._bgImage.src === url) return this;

    var self = this;
    var image = new this.win.Image();
    image.onload = function () {
      self._bgImage = image;
      self._bg = null;                  // 作り直させる
    };
    image.onerror = function () {
      console.warn('[CB] 背景画像を読み込めませんでした:', url);
      self._bgImage = null;
      self._bg = null;
    };
    image.src = url;
    return this;
  };

  Renderer.prototype._drawEnemy = function (ctx, enemy, scale) {
    var x = enemy.position.x * scale;
    var y = enemy.position.y * scale;
    var r = enemy.radius * scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = enemy.color;
    ctx.globalAlpha = 0.26;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.strokeStyle = enemy.color;
    ctx.stroke();

    // 残り HP を外周のリングで見せる
    var ratio = Math.max(0, enemy.hp / enemy.maxHp);
    if (ratio < 1) {
      ctx.beginPath();
      ctx.arc(x, y, r + ctx.lineWidth, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1.2, r * 0.07);
      ctx.stroke();
    }

    if (r > 22) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold ' + Math.round(r * 0.38) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(enemy.label, x, y);
    }
    ctx.restore();
  };

  Renderer.prototype._drawCircle = function (ctx, circle, scale, now) {
    var x = circle.position.x * scale;
    var y = circle.position.y * scale;
    var r = circle.radius * scale;
    var hue = ownerHue(circle.ownerId);
    var color = 'hsl(' + hue + ', 90%, 65%)';

    if (circle.maxedAt != null) this._drawAura(ctx, circle, x, y, r, now);

    var image = this.avatars ? this.avatars.get(circle.profileImageUrl) : null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    if (image) {
      // 画像はキャッシュ側で丸く切り抜き済み。ここでは貼るだけです。
      // 毎フレーム ctx.clip() を呼ぶと、円が数百個あるときに効いてきます。
      ctx.drawImage(image, x - r, y - r, r * 2, r * 2);
    } else {
      // 取れなかった / まだ読み込めていない場合の既定アイコン
      ctx.fillStyle = 'hsl(' + hue + ', 60%, 28%)';
      ctx.fill();
      if (r > 7) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = 'bold ' + Math.round(r * 1.0) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial(circle.ownerName), x, y + r * 0.04);
      }
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.13);
    ctx.strokeStyle = color;
    // 仮の視聴者 (NPC) は破線。武器も灰色にしてあるので、実際の視聴者の円と
    // 見間違えません。誰も居ない間も盤面は動いていますが、それが本物の
    // 視聴者の成果に見えてしまうと、ランキングの意味が薄れます。
    if (circle.demo) ctx.setLineDash([r * 0.5, r * 0.34]);
    ctx.stroke();
    ctx.setLineDash([]);

    var ratio = Math.max(0, circle.hp / circle.maxHp);
    if (ratio < 1) {
      ctx.beginPath();
      ctx.arc(x, y, r + ctx.lineWidth, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, r * 0.10);
      ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * レベルのバッジ。円の下に小さく出します。
   *
   * 育てるゲームなので、自分の円が今いくつなのかが見えないと張り合いが
   * ありません。最大レベルは色を変えて、育てきったことが分かるようにします。
   */
  Renderer.prototype._drawLevel = function (ctx, circle, scale) {
    var r = circle.radius * scale;
    if (r < 11) return;                     // 小さすぎて読めないものは出さない

    var badge = this._levelBadge(circle.level);
    if (!badge) return;

    // バッジは**円の中**に収めます。円の外に出すと、円が密集したときに
    // 隣の円のバッジと重なって、画面が数字で埋まってしまいます。
    //
    // 高さにも上限を掛けます。'MAX' は 'Lv50' より短いぶん、幅から高さを
    // 決めると縦に大きくなり、プロフィール画像の顔をふさいでしまいます。
    var width = Math.min(r * 1.5, r * 2 * 0.92);
    var height = Math.min(width / badge.ratio, r * 0.46);
    width = height * badge.ratio;
    var x = circle.position.x * scale - width / 2;
    var y = circle.position.y * scale + r - height * 1.2;

    ctx.drawImage(badge.canvas, x, y, width, height);
  };

  /**
   * レベルのバッジは 1 段階につき 1 枚だけ作って使い回します。
   *
   * 文字を毎フレーム組むと、円が 200 個あるだけで 1ms 近くかかります
   * (実測で描画時間の 4 割)。絵にしておけば貼るだけで済みます。
   */
  Renderer.prototype._levelBadge = function (level) {
    if (!this._badges) this._badges = {};
    if (this._badges[level]) return this._badges[level];
    if (!this.doc) return null;

    var max = this.engine.maxLevel ? this.engine.maxLevel() : 100;
    var maxed = level >= max;
    var text = maxed ? 'MAX' : 'Lv' + level;

    // 元絵は大きめに作り、貼るときに縮めます (拡大するとぼやけるため)
    var font = 44;
    var measure = this.doc.createElement('canvas').getContext('2d');
    measure.font = 'bold ' + font + 'px system-ui, sans-serif';
    var width = Math.ceil(measure.measureText(text).width + font * 0.9);
    var height = Math.ceil(font * 1.5);

    var canvas = this.doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.font = 'bold ' + font + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var radius = height / 2;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(width - radius, 0);
    ctx.arc(width - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(radius, height);
    ctx.arc(radius, radius, radius, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = maxed ? '#facc15' : 'rgba(8, 10, 24, 0.82)';
    ctx.fill();

    ctx.fillStyle = maxed ? '#1b1200' : '#ffffff';
    ctx.fillText(text, width / 2, height / 2 + 1);

    this._badges[level] = { canvas: canvas, ratio: width / height };
    return this._badges[level];
  };

  /**
   * アイテム。ゆっくり回る菱形で、円とも敵とも見た目を変えています。
   * 消える少し前から点滅させて、取り逃しが分かるようにしています。
   */
  Renderer.prototype._drawItem = function (ctx, item, scale, now) {
    var x = item.position.x * scale;
    var y = item.position.y * scale;
    var r = item.radius * scale;
    var age = (now - item.bornAt) / 1000;

    // 残りが短くなったら点滅
    var remaining = item.expiresAt - now;
    var alpha = remaining < 4000 ? 0.35 + 0.65 * Math.abs(Math.sin(now / 160)) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(age * 0.6);

    // 光の輪
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.25 + Math.sin(now / 300) * 0.08), 0, Math.PI * 2);
    ctx.strokeStyle = item.color;
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.stroke();
    ctx.globalAlpha = alpha;

    // 菱形
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.globalAlpha = alpha * 0.85;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();

    // 名前は回さず、菱形の下に置く (中に入れると形からはみ出て読めない)
    if (r > 12) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold ' + Math.round(r * 0.5) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.strokeStyle = 'rgba(6, 8, 20, 0.9)';
      ctx.strokeText(item.label, x, y + r * 1.35);      // 暗い縁取りで背景から浮かせる
      ctx.fillStyle = item.color;
      ctx.fillText(item.label, x, y + r * 1.35);
      ctx.restore();
    }
  };

  /**
   * 最大レベルの円のオーラ。
   *
   * 虹色のリングが回り、その外側に「暴れていられる残り時間」が出ます。
   * 画面のどれが今いちばん危険な円なのかが、ひと目で分かります。
   */
  Renderer.prototype._drawAura = function (ctx, circle, x, y, r, now) {
    var spin = now / 900;
    var pulse = 1 + Math.sin(now / 160) * 0.05;
    var outer = r * 1.42 * pulse;
    var steps = 12;

    ctx.save();

    // 虹色のリング (円弧を 12 本つないで作ります)
    ctx.lineWidth = Math.max(2.5, r * 0.3);
    ctx.lineCap = 'butt';
    for (var i = 0; i < steps; i += 1) {
      var from = spin + (i / steps) * Math.PI * 2;
      var to = spin + ((i + 1.15) / steps) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x, y, outer, from, to);
      ctx.strokeStyle = 'hsla(' + Math.round((i / steps) * 360 + now / 12) % 360 + ', 100%, 62%, 0.85)';
      ctx.stroke();
    }

    // 残り時間 (延ばせるので、いっぱいのときは 1 周のまま)
    if (circle.burstUntil != null && circle.burstUntil !== Infinity) {
      var total = this.config.viewers.levels.maxDurationMs;
      var left = Math.max(0, Math.min(1, (circle.burstUntil - now) / total));
      ctx.beginPath();
      ctx.arc(x, y, outer + ctx.lineWidth * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * その場に広がる閃光を 1 つ足す。武器が変わった瞬間などに使います。
   * 撃破の閃光と同じ仕組みなので、新しく作るものはありません。
   */
  Renderer.prototype.flash = function (x, y, radius, color) {
    this._bursts.push({ x: x, y: y, radius: radius, color: color, at: Date.now() });
    if (this._bursts.length > 40) this._bursts.shift();
    return this;
  };

  Renderer.prototype._drawBursts = function (ctx, scale, now) {
    var life = 420;
    for (var i = this._bursts.length - 1; i >= 0; i -= 1) {
      var burst = this._bursts[i];
      var age = now - burst.at;
      if (age > life) { this._bursts.splice(i, 1); continue; }

      var t = age / life;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(burst.x * scale, burst.y * scale, burst.radius * scale * (1 + t * 1.6), 0, Math.PI * 2);
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  };

  // ------------------------------------------------------- PLAYER CANNON

  /**
   * 大砲を描く。
   *
   * 状態 (段階・大きさ・装填中の人) は cannon.js が持っていて、ここは
   * それを読むだけです。だから演出を変えてもゲームのルールには触りません。
   *
   * 通常時は小さく出します。**消しはしません。** 「ここから入ってくる」と
   * 初見でも分かることのほうが、少しの場所を空けるより大事だからです。
   */
  Renderer.prototype._drawCannon = function (ctx, scale, now) {
    var cannon = this.cannon;
    if (!cannon || !cannon.settings.enabled) return;

    var type = (cannon.shot && cannon.shot.type) ||
               (cannon.lastShot && cannon.lastShot.type) || cannon.settings.types.normal;
    var base = cannon.anchor();
    var aim = cannon.aim();
    var grow = cannon.scale(now);
    var length = cannon.settings.size * grow * scale;
    var x = base.x * scale;
    var y = base.y * scale;

    // 発射直後だけ、反動で少し後ろへ下がります
    var since = now - cannon.firedAt;
    var recoil = since >= 0 && since < 160 ? (1 - since / 160) * length * 0.24 : 0;
    var bx = x - Math.cos(aim) * recoil;
    var by = y - Math.sin(aim) * recoil;

    var w = length;
    var h = length * 0.5;
    var lit = cannon.phase === 'idle' ? 0.35 : 1;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(aim);
    ctx.lineJoin = 'round';

    // --- 台座。砲身の後ろに置いて、据え付けられている感じを出します
    ctx.fillStyle = 'rgba(12, 16, 38, 0.94)';
    ctx.strokeStyle = type.color;
    ctx.lineWidth = Math.max(2, h * 0.13);
    ctx.globalAlpha = 0.55 + lit * 0.45;
    ctx.shadowColor = type.color;
    ctx.shadowBlur = h * 0.5 * lit;
    roundRect(ctx, -w * 0.5, -h * 0.62, w * 0.6, h * 1.24, h * 0.3);
    ctx.fill();
    ctx.stroke();

    // --- 砲身。先へ向かって少し細くなる台形で、向きが一目で分かります
    ctx.beginPath();
    ctx.moveTo(w * 0.02, -h * 0.42);
    ctx.lineTo(w * 0.98, -h * 0.3);
    ctx.lineTo(w * 0.98, h * 0.3);
    ctx.lineTo(w * 0.02, h * 0.42);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 26, 58, 0.96)';
    ctx.fill();
    ctx.stroke();

    // 砲身の上を走る光の線。ネオンらしさを出しつつ、向きも強調します
    ctx.beginPath();
    ctx.moveTo(w * 0.1, -h * 0.16);
    ctx.lineTo(w * 0.92, -h * 0.1);
    ctx.lineWidth = Math.max(1.5, h * 0.08);
    ctx.globalAlpha = 0.4 + lit * 0.6;
    ctx.stroke();

    // --- 砲口。装填が進むほど強く光ります
    ctx.globalAlpha = 1;
    ctx.fillStyle = type.color;
    ctx.shadowBlur = h * (0.5 + lit * 1.2);
    roundRect(ctx, w * 0.94, -h * 0.34, h * 0.26, h * 0.68, h * 0.12);
    ctx.fill();
    ctx.restore();

    this._drawCannonLabel(ctx, bx, by, length, aim, type, cannon);
    this._drawCannonLoad(ctx, scale, now, aim, length);
    this._drawMuzzleFlash(ctx, scale, now, aim, type);
  };

  /** 大砲の下に出す小さな名札。 */
  Renderer.prototype._drawCannonLabel = function (ctx, x, y, length, aim, type, cannon) {
    var px = Math.max(9, length * 0.19);
    // 砲身が伸びているのと**反対側**に出します。同じ側だと重なって読めません。
    var lx = x - Math.cos(aim) * length * 0.55;
    var ly = y - Math.sin(aim) * length * 0.55 + px * 1.5;

    ctx.save();
    ctx.font = 'bold ' + px.toFixed(1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = cannon.phase === 'idle' ? 0.7 : 1;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(type.label, lx, ly);
    ctx.fillStyle = type.color;
    ctx.fillText(type.label, lx, ly);
    ctx.restore();
  };

  /**
   * 装填中の表示。誰が入ってくるのかを、撃つ前に見せます。
   *
   * アイコンは既存のキャッシュから借ります。まだ読めていなければ頭文字です。
   * **読み込みを待ちません。** 待つとその間ゲームが止まって見えます。
   */
  Renderer.prototype._drawCannonLoad = function (ctx, scale, now, aim, length) {
    var cannon = this.cannon;
    var shot = cannon.shot;
    if (!shot || cannon.phase !== 'load') return;

    var t = Math.min(1, (now - cannon.phaseAt) / Math.max(1, cannon._loadMs()));
    var muzzle = cannon.muzzle(cannon.scale(now));
    var r = length * 0.34;
    // 砲身の中を進んで砲口へ出ていくように見せます
    var x = (muzzle.x * scale) - Math.cos(aim) * r * (1 - t) * 1.6;
    var y = (muzzle.y * scale) - Math.sin(aim) * r * (1 - t) * 1.6;

    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 3);

    var image = this.avatars ? this.avatars.get(shot.user.profileImageUrl) : null;
    var hue = ownerHue(String(shot.user.id));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (image) {
      ctx.drawImage(image, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = 'hsl(' + hue + ', 60%, 30%)';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold ' + Math.round(r) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial(shot.user.uniqueId), x, y);
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.strokeStyle = shot.type.color;
    ctx.stroke();

    // 名前と、入室のときだけ出す短い知らせ
    var px = Math.max(9, r * 0.62);
    var notice = cannon.noticeFor(shot.sourceEvent);
    ctx.textAlign = 'center';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';

    var lineY = y - r - px * 0.5;
    var write = function (text, size, color) {
      ctx.font = 'bold ' + size.toFixed(1) + 'px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.strokeText(text, x, lineY);
      ctx.fillStyle = color;
      ctx.fillText(text, x, lineY);
      lineY -= size * 1.15;
    };

    write('@' + clip(shot.user.uniqueId, 16), px, '#ffffff');
    if (notice && notice.main) {
      write(notice.sub, px * 0.8, '#94a3b8');
      write(notice.main, px * 1.1, shot.type.color);
    }
    ctx.restore();
  };

  /** 発射の瞬間の閃光・衝撃波・煙。 */
  Renderer.prototype._drawMuzzleFlash = function (ctx, scale, now, aim, type) {
    var cannon = this.cannon;
    var life = 260;
    var age = now - cannon.firedAt;
    if (age < 0 || age > life) return;

    var t = age / life;
    var muzzle = cannon.muzzle(cannon.settings.loadScale);
    var x = muzzle.x * scale;
    var y = muzzle.y * scale;
    var size = cannon.settings.size * scale;

    ctx.save();
    ctx.globalAlpha = 1 - t;

    // 衝撃波の輪
    ctx.strokeStyle = type.color;
    ctx.lineWidth = Math.max(2, size * 0.12 * (1 - t));
    ctx.beginPath();
    ctx.arc(x, y, size * (0.2 + t * 1.5) * type.shockwave, 0, Math.PI * 2);
    ctx.stroke();

    // 砲口の炎
    ctx.translate(x, y);
    ctx.rotate(aim);
    ctx.fillStyle = type.color;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.3 * (1 - t));
    ctx.lineTo(size * 0.9 * (1 - t * 0.5), 0);
    ctx.lineTo(0, size * 0.3 * (1 - t));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  /**
   * 発射の煙と粒を撒く。cannon の 'fire' を受けて呼ばれます。
   * 使い回しの配列で、上限を超えたら古いものから捨てます。
   */
  Renderer.prototype.cannonBurst = function (muzzle, aim, type) {
    var count = Math.min(type.particles || 12, 40);
    var now = Date.now();
    for (var i = 0; i < count; i += 1) {
      var spread = (Math.random() * 2 - 1) * 0.7;
      var speed = 60 + Math.random() * 260;
      this._sparks.push({
        x: muzzle.x,
        y: muzzle.y,
        vx: Math.cos(aim + spread) * speed,
        vy: Math.sin(aim + spread) * speed,
        life: 260 + Math.random() * 420,
        size: 2 + Math.random() * 5,
        smoke: Math.random() < 0.45,
        color: type.color,
        at: now
      });
    }
    while (this._sparks.length > 160) this._sparks.shift();
    return this;
  };

  Renderer.prototype._drawSparks = function (ctx, scale, now) {
    for (var i = this._sparks.length - 1; i >= 0; i -= 1) {
      var p = this._sparks[i];
      var age = now - p.at;
      if (age > p.life) { this._sparks.splice(i, 1); continue; }

      var t = age / p.life;
      var seconds = age / 1000;
      var x = (p.x + p.vx * seconds) * scale;
      var y = (p.y + p.vy * seconds) * scale;

      ctx.save();
      if (p.smoke) {
        // 煙はふくらみながら薄くなります
        ctx.globalAlpha = (1 - t) * 0.34;
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(x, y, p.size * scale * (1 + t * 3), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, p.size * scale * (1 - t * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  /** 撃ち出されて飛んでいる円の尾。 */
  Renderer.prototype._drawLaunchTrail = function (ctx, circle, scale, now) {
    if (circle.launchUntil == null || now >= circle.launchUntil) return;

    var speed = Math.sqrt(circle.velocity.x * circle.velocity.x +
                          circle.velocity.y * circle.velocity.y) || 1;
    var r = circle.radius * scale;
    var x = circle.position.x * scale;
    var y = circle.position.y * scale;
    var back = Math.min(r * 5, speed * scale * 0.12);
    var tx = x - (circle.velocity.x / speed) * back;
    var ty = y - (circle.velocity.y / speed) * back;

    var gradient = ctx.createLinearGradient(x, y, tx, ty);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.save();
    ctx.strokeStyle = gradient;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  };

  /** 角の丸い四角。大砲の各部で使います。 */
  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /**
   * 入室 (JOIN) で生まれた円か。生まれてから少しの間だけ true。
   *
   * @returns {number} 0〜1 の残り具合。0 なら対象外
   */
  Renderer.prototype._joinGlow = function (circle, now) {
    if (circle.sourceEvent !== 'JOIN') return 0;
    var life = this.config.ui.join.highlightMs;
    var age = now - circle.bornAt;
    if (age < 0 || age > life) return 0;
    return 1 - age / life;
  };

  /**
   * 入室した人の円を囲む光の輪。
   *
   * JOIN は 1 人 1 回だけの「初めまして」です。入ってきた人が自分の円を
   * 見つけられるように、少しの間だけはっきり目立たせます。
   * **円より先に描く**ので、どれだけ光ってもプロフィール画像は隠れません。
   */
  Renderer.prototype._drawJoinRing = function (ctx, circle, scale, now) {
    var left = this._joinGlow(circle, now);
    if (!left) return;

    var settings = this.config.ui.join;
    var x = circle.position.x * scale;
    var y = circle.position.y * scale;
    var r = circle.radius * scale;

    // 生まれた瞬間に大きく広がって、そのあとは脈打つだけ。
    // ずっと同じ強さで光らせると、ただの飾りに見えて目を引きません。
    var burst = Math.max(0, 1 - (now - circle.bornAt) / 600);
    var pulse = 1 + Math.sin(now / 220) * 0.06;
    var outer = r * (1.28 + burst * 1.2) * pulse;

    ctx.save();
    ctx.strokeStyle = settings.color;
    ctx.globalAlpha = Math.min(1, left * 1.6);

    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.beginPath();
    ctx.arc(x, y, outer, 0, Math.PI * 2);
    ctx.stroke();

    // 内側にもう 1 本。1 本だけだと敵の HP リングと見分けが付きません。
    ctx.globalAlpha = Math.min(1, left * 0.9);
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.beginPath();
    ctx.arc(x, y, outer + ctx.lineWidth * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  /** 入室した円の上に出す短い文字。 */
  Renderer.prototype._drawJoinLabel = function (ctx, circle, scale, now) {
    var left = this._joinGlow(circle, now);
    if (!left) return;

    var settings = this.config.ui.join;
    var r = circle.radius * scale;
    var px = Math.max(10, r * 0.62);
    var x = circle.position.x * scale;
    // 名前が円の下に出るので、こちらは上に置きます (重ならないように)
    var y = circle.position.y * scale - r - px * 0.9;

    ctx.save();
    ctx.globalAlpha = Math.min(1, left * 2);
    ctx.font = 'bold ' + px.toFixed(1) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(settings.label, x, y);
    ctx.fillStyle = settings.color;
    ctx.fillText(settings.label, x, y);
    ctx.restore();
  };

  /**
   * 生まれたばかりの円に、誰のものかを出す。
   *
   * 自分が押した LIKE で自分の円が生まれたことが分かるのが、続けて押す一番の
   * 理由になります。ずっと出しっぱなしにすると名前で埋まるので、数秒で消します。
   */
  Renderer.prototype._drawNameTag = function (ctx, circle, scale, now) {
    var age = now - circle.bornAt;
    var life = this.config.ui.nameTagMs;
    if (age > life) return;

    var r = circle.radius * scale;
    var x = circle.position.x * scale;
    var y = circle.position.y * scale + r + Math.max(11, r * 0.5);
    // 最後の 1/4 で薄くして消す (ぱっと消えると点滅して見えます)
    var alpha = Math.min(1, (life - age) / (life * 0.25));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold ' + Math.max(10, Math.round(r * 0.5)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText('@' + circle.ownerName, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('@' + circle.ownerName, x, y);
    ctx.restore();
  };

  /**
   * 「+1 KILL」のような短い文字をフィールド上に飛ばす。
   *
   * 何かをした結果がその場で見えないと、押した意味が分かりません。
   * ゲームの状態は一切変えません (消えても進行に影響しません)。
   *
   * @param {string} text  出す文字
   * @param {number} x     フィールド座標
   * @param {number} y     フィールド座標
   * @param {object} [options] { color, size } size は**フィールド座標での大きさ**。
   *        画面の px ではありません。スマホでも 1080 幅でも、円との
   *        大きさの比が変わらないようにするためです。
   */
  Renderer.prototype.float = function (text, x, y, options) {
    options = options || {};
    this._floats.push({
      text: String(text),
      x: x,
      y: y,
      at: Date.now(),
      color: options.color || '#ffffff',
      size: options.size || 34
    });
    // 大量撃破で文字だらけになるので、古いものから捨てます
    while (this._floats.length > (this.config.ui.floatMax || 14)) this._floats.shift();
  };

  /**
   * 攻撃したことを、円と敵が触れた場所に短く出す。
   *
   * 円の真ん中ではなく**接点側**に描きます。真ん中に描くと、一番大事な
   * プロフィール画像の上に線が乗ってしまうためです。
   *
   * @param {object} circle 攻撃した円
   * @param {object} target 殴られた敵
   */
  Renderer.prototype.attackEffect = function (circle, target) {
    var weapons = this.weapons;
    if (!weapons) return;

    var settings = this.config.weapons.attackEffects;
    if (circle.radius * this.scale < settings.minRadiusPx) return;

    var tier = weapons.tierFor(circle.level);
    if (!tier.attack) return;                       // Lv1〜9 は武器が無いので出しません

    var dx = target.position.x - circle.position.x;
    var dy = target.position.y - circle.position.y;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;

    // 刃が敵に当たったところに出します。円のふちに出すと、離れた敵を
    // 斬ったときに「当たっていないのに斬撃だけ出ている」ように見えます。
    // プロフィール画像にかぶらないよう、円のふちより内側には入れません。
    var reach = tier.hit ? circle.radius * tier.hit.reach : circle.radius;
    var at = Math.max(circle.radius * 0.95, Math.min(length - target.radius, reach));

    this._attacks.push({
      kind: tier.attack,
      color: circle.demo ? this.config.weapons.npcColor : tier.color,
      x: circle.position.x + dx / length * at,
      y: circle.position.y + dy / length * at,
      angle: Math.atan2(dy, dx),
      radius: circle.radius,
      at: Date.now()
    });

    // 増えすぎると画面が線で埋まるので、古いものから捨てます
    while (this._attacks.length > settings.max) this._attacks.shift();
  };

  /**
   * 当たり判定を線で出す (確認用)。
   *
   * `CB.renderer.debugHits = true` で出ます。配信では使いません。
   * 見えている武器と当たる場所が合っているかを、目で確かめるためのものです。
   */
  Renderer.prototype._drawHitboxes = function (ctx, circles, scale) {
    var engine = this.engine;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;

    for (var i = 0; i < circles.length; i += 1) {
      var circle = circles[i];
      var tier = engine.weaponTier ? engine.weaponTier(circle.level) : null;
      var hit = tier && tier.hit;
      if (!hit) continue;

      var x = circle.position.x * scale;
      var y = circle.position.y * scale;
      var inner = circle.radius * this.config.weapons.combat.innerReach * scale;
      var outer = circle.radius * hit.reach * scale;

      for (var k = 0; k < hit.arms; k += 1) {
        var mid = circle.weaponAngle + (hit.offset || 0) + k * (Math.PI * 2 / hit.arms);
        ctx.beginPath();
        ctx.arc(x, y, outer, mid - hit.arc, mid + hit.arc);
        ctx.arc(x, y, inner, mid + hit.arc, mid - hit.arc, true);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  Renderer.prototype._drawAttacks = function (ctx, scale, now) {
    if (!this.weapons) return;
    for (var i = this._attacks.length - 1; i >= 0; i -= 1) {
      if (!this.weapons.drawAttack(ctx, this._attacks[i], scale, now)) {
        this._attacks.splice(i, 1);
      }
    }
  };

  Renderer.prototype._drawFloats = function (ctx, scale, now) {
    var life = this.config.ui.floatMs || 1100;

    for (var i = this._floats.length - 1; i >= 0; i -= 1) {
      var item = this._floats[i];
      var age = now - item.at;
      if (age > life) { this._floats.splice(i, 1); continue; }

      var t = age / life;
      ctx.save();
      ctx.globalAlpha = 1 - t * t;                      // 最後に一気に消す
      // 小さい画面でも読めるところまでは縮めない
      var px = Math.max(9, item.size * scale);
      ctx.font = 'bold ' + px.toFixed(1) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';

      // 端で切れないように、画面の中へ寄せます。端で起きたことほど
      // 見逃されやすいので、切って読めなくするのは避けます。
      var half = ctx.measureText(item.text).width / 2 + px * 0.2;
      var limit = this.engine.field.width * scale;
      var x = Math.max(half, Math.min(item.x * scale, limit - half));
      var y = item.y * scale - t * px * 1.6;            // ゆっくり上へ
      ctx.strokeText(item.text, x, y);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, x, y);
      ctx.restore();
    }
  };

  // --------------------------------------------------------------- HUD

  Renderer.prototype._drawHud = function (state) {
    if (this.el.defeated) this.el.defeated.textContent = state.defeated.toLocaleString();
    if (this.el.enemiesAlive) this.el.enemiesAlive.textContent = state.enemiesAlive;
    if (this.el.circlesAlive) this.el.circlesAlive.textContent = state.circlesAlive;
    if (this.el.players && this.leaderboard) {
      this.el.players.textContent = this.leaderboard.count();
    }
    this._drawBossBar(state);
  };

  /**
   * 大物が居るときだけ、画面上部に残り HP を出す。
   *
   * 「あと少し」が見えると、みんなで殴りにいく理由になります。
   * 居ないときは消すので、常時 BOSS の圧を出しません。
   */
  Renderer.prototype._drawBossBar = function (state) {
    var bar = this.el.bossBar;
    if (!bar) return;

    var minHp = this.config.ui.bossBarMinHp || 1000;
    var boss = null;
    for (var i = 0; i < state.enemies.length; i += 1) {
      var enemy = state.enemies[i];
      if (enemy.maxHp < minHp) continue;
      if (!boss || enemy.maxHp > boss.maxHp) boss = enemy;
    }

    if (!boss) { bar.hidden = true; return; }

    var ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    bar.hidden = false;
    bar.style.setProperty('--color', boss.color);
    if (this.el.bossBarLabel) this.el.bossBarLabel.textContent = boss.label;
    if (this.el.bossBarFill) this.el.bossBarFill.style.width = (ratio * 100).toFixed(1) + '%';
    if (this.el.bossBarValue) {
      this.el.bossBarValue.textContent = Math.ceil(boss.hp).toLocaleString();
    }
  };

  /**
   * ラウンドの残り時間。
   *
   * ウェーブの通し番号をやめて、ここを残り時間にしました。数が積み上がると
   * あとから来た人には「もう遅い」に見えますが、残り時間なら**いつ来ても
   * 意味が同じ**で、しかも減っていくぶん急かされます。
   *
   * 秒が変わったときだけ書き換えます。毎フレーム書くと、この 1 行のために
   * レイアウトが毎回組み直されます。
   */
  Renderer.prototype._syncRoundTime = function (now) {
    var el = this.el.roundTime;
    if (!el || !this.director) return;

    var left = this.director.remainingMs(now);
    // 終わりを決めていないとき (roundMs: 0) は行ごと出しません
    if (!isFinite(left)) {
      if (this.el.roundBox && !this.el.roundBox.hidden) this.el.roundBox.hidden = true;
      return;
    }
    if (this.el.roundBox && this.el.roundBox.hidden) this.el.roundBox.hidden = false;

    var seconds = Math.ceil(left / 1000);
    if (seconds === this._roundLeft) return;
    this._roundLeft = seconds;

    var mm = Math.floor(seconds / 60);
    var ss = seconds % 60;
    el.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;

    // 残り 10 秒からは色を変えます (終わりが来ることが見えるように)
    if (this.el.roundBox) {
      if (seconds <= 10) this.el.roundBox.classList.add('status__round--soon');
      else this.el.roundBox.classList.remove('status__round--soon');
    }
  };

  /**
   * TOP10 に入っていない人へ「YOU #23」と出す。
   *
   * 圏外の人にも順位が見えないと、追いかける目標がありません。
   * text が空なら消します。
   */
  Renderer.prototype.setSelfRank = function (text) {
    var el = this.el.selfRank;
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  };

  // ----------------------------------------------------------- ranking

  /** 行は最初に作っておき、あとは中身だけ書き換える (毎フレーム作り直さない)。 */
  Renderer.prototype._buildRanking = function () {
    var list = this.el.rankingList;
    if (!list) return;
    var size = this.config.ranking.size;

    list.innerHTML = '';
    this._rows = [];

    for (var i = 0; i < size; i += 1) {
      var row = this.doc.createElement('li');
      row.className = 'rank';
      row.hidden = true;
      row.innerHTML =
        '<span class="rank__no">' + (i + 1) + '</span>' +
        '<span class="rank__avatar"><img alt="" hidden><span class="rank__initial"></span></span>' +
        '<span class="rank__name"></span>' +
        '<span class="rank__level"></span>' +
        '<span class="rank__value"></span>';

      list.appendChild(row);
      this._rows.push({
        el: row,
        img: row.querySelector('img'),
        initial: row.querySelector('.rank__initial'),
        name: row.querySelector('.rank__name'),
        level: row.querySelector('.rank__level'),
        value: row.querySelector('.rank__value'),
        userId: null,
        src: null
      });
    }
  };

  /**
   * ランキングを描き直す。
   * leaderboard の version が変わったときだけ動くので、毎フレーム呼んで構いません。
   */
  Renderer.prototype.renderRanking = function (force) {
    if (!this.leaderboard) return;
    if (!force && this.leaderboard.version === this._rankingVersion) return;
    this._rankingVersion = this.leaderboard.version;

    var top = this.leaderboard.top();
    var metric = this.leaderboard.sortBy;
    /** いま画面に出ている順位。並べ替えを何度もやらないよう、他からはこれを見ます。 */
    this.top = top;

    // ランキングの枠を持たない画面 (操作画面のプレビュー) はここまで。
    // 並べ替えた結果は上で公開してあるので、順位の変化は拾えます。
    if (!this._rows.length) return;

    if (this.el.rankingMetric) this.el.rankingMetric.textContent = metric.toUpperCase();
    if (this.el.rankingEmpty) {
      this.el.rankingEmpty.hidden = top.length > 0;
      // 誰も居ないときだけ、何をすると何が起きるかを出します。
      // 遊んでいる人が居るのに出し続けると、ただの文字の壁になります。
      if (!top.length) this.el.rankingEmpty.textContent = this._howToPlay();
    }

    for (var i = 0; i < this._rows.length; i += 1) {
      var row = this._rows[i];
      var record = top[i];

      if (!record) { row.el.hidden = true; continue; }
      row.el.hidden = false;

      if (row.userId !== record.userId) {
        row.userId = record.userId;
        row.name.textContent = '@' + record.userName;
        row.initial.textContent = initial(record.userName);
        row.el.style.setProperty('--hue', ownerHue(record.userId));

        // 行は使い回すので、前に居た人の画像をいったん外す。
        // 外さないと、画像を持っていない人のところに他人のアイコンが残ります。
        row.src = null;
        row.img.hidden = true;
        row.img.removeAttribute('src');
      }

      if (record.profileImageUrl && row.src !== record.profileImageUrl) {
        row.src = record.profileImageUrl;
        row.img.src = record.profileImageUrl;
        row.img.hidden = false;
        row.img.onerror = function () { this.hidden = true; };   // 取れなければ頭文字に戻す
      }

      if (record.maxLevel > 0) {
        // 順番待ちがあれば「Lv100 +2」のように出します
        row.level.textContent = 'Lv' + record.maxLevel + (record.queued > 0 ? ' +' + record.queued : '');
        row.level.hidden = false;
      } else {
        row.level.hidden = true;
      }

      var value = metric === 'kills' ? record.kills
        : metric === 'damage' ? Math.round(record.damage)
          : Math.round(record.score);
      // 数字だけにします。何の数字かは見出し (TOP 5 … SCORE) に出ているので、
      // 1 行ごとに繰り返すと、その幅のぶん名前が削られて読めなくなります。
      row.value.textContent = value.toLocaleString();
    }
  };

  /**
   * 「何をすると何が起きるか」の 1 行。config から作るので、
   * 設定を変えれば表示も変わります (説明と実際がずれません)。
   */
  Renderer.prototype._howToPlay = function () {
    var levels = this.config.viewers.levels;
    return 'LIKE \u00d7' + levels.likesPerLevel + ' \u2192 Lv+1' +
           '   FOLLOW \u2192 Lv+' + levels.follow +
           '   SHARE \u2192 Lv+' + levels.share +
           '   GIFT \u2192 Lv+' + levels.giftLevelsPerCoin + '/coin';
  };

  // ---------------------------------------------------------- 通知/状態

  /** 画面上部の一時通知。ゲームの進行には影響しません。 */
  Renderer.prototype.showNotice = function (text) {
    var el = this.el.notice;
    if (!el || !text) return;

    el.textContent = text;
    el.hidden = false;
    el.classList.remove('notice--in');
    void el.offsetWidth;                 // アニメーションをやり直させる
    el.classList.add('notice--in');

    this.win.clearTimeout(this._noticeTimer);
    var self = this;
    this._noticeTimer = this.win.setTimeout(function () {
      el.hidden = true;
    }, this.config.ui.noticeMs);
  };

  /**
   * 画面下の LIVE EVENT。最新の数件だけを出し、古いものから消します。
   *
   * ログを流し続けると小さい画面が埋まるので、件数と寿命の両方で絞ります。
   *
   * @param {string} user  @ 抜きのユーザー名
   * @param {string} text  '+10 LIKE' など
   * @param {string} [kind] 'like' | 'follow' | 'share' | 'gift' | 'join' | 'max'
   */
  Renderer.prototype.pushEvent = function (user, text, kind) {
    var feed = this.el.eventFeed;
    if (!feed) return;

    var max = this.config.ui.eventLines || 3;
    var row = this.doc.createElement('li');
    row.className = 'event' + (kind ? ' event--' + kind : '');
    row.innerHTML = '<span class="event__user"></span><span class="event__text"></span>';
    row.firstChild.textContent = '@' + user;
    row.lastChild.textContent = text;

    feed.insertBefore(row, feed.firstChild);
    this._events.unshift({ el: row, at: Date.now() });

    while (this._events.length > max) {
      var old = this._events.pop();
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
  };

  /** 時間が経ったイベントを消す (draw から毎フレーム呼ばれます)。 */
  Renderer.prototype._expireEvents = function (now) {
    var life = this.config.ui.eventLifeMs || 9000;
    for (var i = this._events.length - 1; i >= 0; i -= 1) {
      if (now - this._events[i].at < life) continue;
      var gone = this._events.splice(i, 1)[0];
      if (gone.el.parentNode) gone.el.parentNode.removeChild(gone.el);
    }
  };

  /**
   * 入室した人の名前を画面中央に出す。
   *
   * **誰を出すかは決めません。** js/join-banner.js が持っている「今この人」を
   * 読んで DOM に写すだけです。ここで順番や時間を持たせると、画面が 2 つある
   * ときに別々の名前が出てしまいます。
   *
   * canvas ではなく DOM に出すのは、盤面をどれだけ拡大しても文字がぼやけず、
   * 縦長でも横長でも中央に居続けるからです。
   */
  Renderer.prototype._syncJoinBanner = function (now) {
    var el = this.el.joinBanner;
    if (!el || !this.joinBanner) return;

    var shown = this.joinBanner.active(now);
    if (!shown) {
      if (!el.hidden) {
        el.hidden = true;
        this._joinSerial = -1;
      }
      return;
    }

    if (shown.serial !== this._joinSerial) {
      this._joinSerial = shown.serial;
      this.el.joinBannerName.textContent = '@' + shown.name;
      if (this.el.joinBannerLabel) {
        this.el.joinBannerLabel.textContent = this.config.ui.join.banner.label || 'JOIN';
      }
      // あふれたぶんの人数。0 のときは行ごと消します (空行が残ると位置がずれます)
      var more = this.el.joinBannerMore;
      if (more) {
        more.textContent = shown.more > 0 ? '+' + shown.more + ' MORE JOINED' : '';
        more.hidden = !(shown.more > 0);
      }

      // 出す時間は混み具合で変わるので、アニメーションもその長さに合わせます。
      // 固定にすると、短い表示のときに消えたあとも動きだけが残ります。
      el.style.animationDuration = Math.max(1, shown.until - shown.shownAt) + 'ms';
      el.hidden = false;
      el.classList.remove('join-banner--in');
      void el.offsetWidth;               // アニメーションをやり直させる
      el.classList.add('join-banner--in');
    }

    // 中央バナー (ラウンド結果など) が出ている間だけ下へ逃がします。重ねると
    // どちらも読めなくなり、「目立つ」どころではなくなります。
    var busy = Boolean(this.el.stageBanner && !this.el.stageBanner.hidden);
    if (busy !== this._joinLow) {
      this._joinLow = busy;
      if (busy) el.classList.add('join-banner--low');
      else el.classList.remove('join-banner--low');
    }
  };

  /**
   * フィールドが広がった / 戻ったときの告知。
   *
   * ズームと同じ時間だけ出して消えます (CSS の stage-pop)。
   */
  Renderer.prototype.showStageBanner = function (main, sub, durationMs) {
    var el = this.el.stageBanner;
    if (!el) return;

    this.el.stageBannerMain.textContent = main;
    this.el.stageBannerSub.textContent = sub || '';
    el.hidden = false;
    el.classList.remove('stage-banner--in');
    void el.offsetWidth;                 // アニメーションをやり直させる
    el.classList.add('stage-banner--in');

    this.win.clearTimeout(this._stageTimer);
    this._stageTimer = this.win.setTimeout(function () { el.hidden = true; }, durationMs || 2000);
  };

  /** 中継サーバー / 配信の状態表示。 */
  Renderer.prototype.setStatus = function (state, text) {
    if (this.el.status) this.el.status.dataset.state = state;
    if (this.el.statusText) this.el.statusText.textContent = text;
  };

  global.CB = global.CB || {};
  global.CB.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : this);
