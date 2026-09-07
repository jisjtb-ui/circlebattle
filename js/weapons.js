/**
 * weapons.js - レベルに応じた武器の見た目。
 *
 * **ここはステータスを 1 つも触りません。** HP も攻撃力も速さも半径も、
 * 決めているのは今までどおり `viewers.scaling` です。この層は
 * 「そのレベルの円がどう見えるか」だけを担当します。だから、この
 * ファイルを丸ごと消してもゲームの強さは何も変わりません。
 *
 * 描き方:
 *
 *   段ごとに「部品」を 1 回だけ小さな絵にしておき、あとは回して貼るだけです。
 *   毎フレーム線を引き直すと、円が 150 個あるときに効いてきます。
 *
 *   部品ごとに**中身が入っている範囲ぴったり**の絵を作るのが肝です。
 *   円をまるごと囲む四角で貼ると、Lv10 の小さな剣 1 本を出すために
 *   円の 12 倍の面積を塗ることになり、それだけで frame rate が半分に落ちます
 *   (実測: 58fps → 26fps)。塗るのは中身のあるところだけにします。
 *
 *   中間レベルの成長は**貼り方**（濃さ・大きさ・軌跡）だけで表します。
 *   段の数だけ絵を持てばよく、レベル 100 種類ぶんは要りません。
 *
 *   絵は円の**外側**にだけ描きます。プロフィール画像はこのゲームで一番
 *   大事な情報なので、武器で隠すことはありません。描く順番も円より先です。
 */
(function (global) {
  'use strict';

  /**
   * 段の引き当ては js/game.js が持っています。ここはそれを借りるだけです。
   * 借りられない場合 (単体で読み込んだとき) だけ同じ計算をします。
   */
  function tierForLevel(level, weapons) {
    var rules = (global.CB && global.CB.weaponTierFor) ||
      (typeof require === 'function' ? require('./game.js').weaponTierFor : null);
    if (rules) return rules(level, weapons);

    var tiers = weapons.tiers;
    var found = tiers[0];
    for (var i = 0; i < tiers.length; i += 1) {
      if (level >= tiers[i].minLevel) found = tiers[i]; else break;
    }
    return found;
  }

  /** 絵の中での「円の半径」。実際の半径に合わせて縮めて貼ります。 */
  var UNIT = 40;
  /**
   * 絵の余白。にじみ (影) のぶんだけ広く取ります。
   * ここが足りないと、絵の端で武器が切り落とされます。
   */
  var PAD = 1.35;

  // ------------------------------------------------------------ 描き方
  //
  // 各段は a (ゆっくり回る本体) と b (速く回る周回物) を持てます。
  // 座標は「円の半径 = u」。1.0 が円のふちなので、武器は必ず 1.0 より外に置きます。
  //
  // 回転は貼るときに掛けるので、ここでは 0 度の姿だけ描きます。

  /** 先の尖った刃。根元 (from) から先 (to) へ細くなります。 */
  function blade(ctx, u, from, to, width) {
    ctx.beginPath();
    ctx.moveTo(from * u, -width * u);
    ctx.lineTo(to * u, 0);
    ctx.lineTo(from * u, width * u);
    ctx.closePath();
    ctx.fill();
  }

  /** 三日月形の刃 (斧・鎌)。内側と外側の弧で挟みます。 */
  function crescent(ctx, u, inner, outer, from, to) {
    ctx.beginPath();
    ctx.arc(0, 0, outer * u, from, to);
    ctx.arc(0, 0, inner * u, to, from, true);
    ctx.closePath();
    ctx.fill();
  }

  /** 円の中心から distance だけ離した位置に小さい円。 */
  function orb(ctx, u, angle, distance, size, hollow) {
    var x = Math.cos(angle) * distance * u;
    var y = Math.sin(angle) * distance * u;
    ctx.beginPath();
    ctx.arc(x, y, size * u, 0, Math.PI * 2);
    if (hollow) { ctx.lineWidth = size * u * 0.45; ctx.stroke(); } else { ctx.fill(); }
  }

  /** 角度 angle の向きに部品を 1 つ描く (回して描くための入れ物)。 */
  function at(ctx, angle, paint) {
    ctx.save();
    ctx.rotate(angle);
    paint();
    ctx.restore();
  }

  /**
   * 段ごとの部品。
   *
   *   a … ゆっくり回る本体   b … 速く回る周回物
   *
   * それぞれ「部品を描く関数」の配列です。**1 つの関数 = 1 枚の絵**になり、
   * 中身の入っている範囲だけを切り出して貼ります。だから、部品を分けるほど
   * 塗る面積が減ります (2 本の剣を 1 枚にすると、間の空白まで塗ることになります)。
   *
   * 座標はどれも「円の半径 = u」。1.0 が円のふちなので、部品は必ず 1.0 より
   * 外側に置きます。回転は貼るときに掛けるので、ここでは 0 度の姿だけ描きます。
   */
  var PAINTERS = {
    // Lv1-9: 武器なし。円だけの状態を残しておかないと、育った差が出ません。
    none: {},

    // Lv10-19: 小さい光る剣が 1 本
    blade: {
      a: [function (ctx, u) {
        blade(ctx, u, 1.05, 1.6, 0.11);
        ctx.fillRect(1.0 * u, -0.05 * u, 0.1 * u, 0.1 * u);       // つば
      }]
    },

    // Lv20-29: 2 本になる
    twin: {
      a: [0, Math.PI].map(function (angle) {
        return function (ctx, u) {
          at(ctx, angle, function () {
            blade(ctx, u, 1.05, 1.66, 0.10);
            ctx.fillRect(1.0 * u, -0.045 * u, 0.09 * u, 0.09 * u);
          });
        };
      })
    },

    // Lv30-39: 長いエネルギー槍
    spear: {
      a: [function (ctx, u) {
        ctx.fillRect(0.98 * u, -0.08 * u, 0.46 * u, 0.16 * u);    // 柄
        blade(ctx, u, 1.34, 1.79, 0.26);                          // 穂先
        blade(ctx, u, 1.34, 1.08, 0.18);                          // 返し
        ctx.fillRect(0.98 * u, -0.19 * u, 0.09 * u, 0.38 * u);    // 石突き
      }]
    },

    // Lv40-49: 大型のエネルギー斧
    axe: {
      a: [function (ctx, u) {
        ctx.fillRect(1.0 * u, -0.045 * u, 0.5 * u, 0.09 * u);
        crescent(ctx, u, 1.4, 1.78, -0.42, 0.42);
      }]
    },

    // Lv50-59: 大型の鎌。円のまわりを大きく回ります
    scythe: {
      a: [function (ctx, u) {
        ctx.fillRect(1.0 * u, -0.04 * u, 0.42 * u, 0.08 * u);
        crescent(ctx, u, 1.34, 1.7, -0.15, 1.15);                 // 長く伸びる刃
        blade(ctx, u, 1.34, 1.58, 0.1);                           // 石突き側の返し
      }]
    },

    // Lv60-69: 2 つの円刃が旋回する
    chakram: {
      b: [0, Math.PI].map(function (angle) {
        return function (ctx, u) {
          orb(ctx, u, angle, 1.46, 0.34, true);
          // 円刃から突き出す刃。ただの輪だと遠目にアイテムと紛れます
          at(ctx, angle, function () {
            blade(ctx, u, 1.44, 1.79, 0.16);
            blade(ctx, u, 1.44, 1.02, 0.16);
          });
        };
      })
    },

    // Lv70-79: 円の横に大型のエネルギー砲
    cannon: {
      a: [-Math.PI / 2, Math.PI / 2].map(function (angle) {
        return function (ctx, u) {
          at(ctx, angle, function () {
            ctx.fillRect(1.0 * u, -0.17 * u, 0.55 * u, 0.34 * u); // 砲身
            ctx.fillRect(1.5 * u, -0.22 * u, 0.16 * u, 0.44 * u); // 砲口
          });
        };
      })
    },

    // Lv80-89: 武器 + 背後のエネルギー翼
    //
    // 羽根は塗り潰しではなく細い刃を扇状に並べます。塗り潰すと光を足したときに
    // 真っ白な塊になって、円の中身まで見えなくなります。
    wings: {
      a: (function () {
        var feathers = [[0.00, 1.5], [0.20, 1.72], [0.42, 1.79], [0.64, 1.6], [0.84, 1.34]];
        var parts = [];
        [-1, 1].forEach(function (side) {
          // 片翼を 1 枚の絵にまとめます (羽根 1 枚ずつだと貼る回数が増えすぎます)
          parts.push(function (ctx, u) {
            at(ctx, side * (Math.PI * 2 / 3), function () {
              feathers.forEach(function (feather) {
                at(ctx, feather[0] * side, function () { blade(ctx, u, 1.02, feather[1], 0.075); });
              });
            });
          });
        });
        parts.push(function (ctx, u) { blade(ctx, u, 1.03, 1.62, 0.12); });
        return parts;
      })()
    },

    // Lv90-99: 複数の攻撃用オーブが周回する
    orbital: {
      a: [0, Math.PI].map(function (angle) {
        return function (ctx, u) {
          at(ctx, angle, function () { blade(ctx, u, 1.03, 1.46, 0.13); });
        };
      }),
      b: (function () {
        var parts = [function (ctx, u) {                          // 軌道の輪
          ctx.lineWidth = 0.035 * u;
          ctx.beginPath();
          ctx.arc(0, 0, 1.55 * u, 0, Math.PI * 2);
          ctx.stroke();
        }];
        for (var i = 0; i < 5; i += 1) {
          parts.push((function (index) {
            return function (ctx, u) { orb(ctx, u, (index / 5) * Math.PI * 2, 1.55, 0.22); };
          })(i));
        }
        return parts;
      })()
    },

    // Lv100: 最終形態。武器ではなくコアそのもの
    core: {
      a: (function () {
        // 内側の欠片。虹色オーラ (renderer 側) の内側に収まる位置に置きます
        var parts = [];
        for (var i = 0; i < 6; i += 1) {
          parts.push((function (index) {
            return function (ctx, u) {
              at(ctx, (index / 6) * Math.PI * 2, function () { blade(ctx, u, 1.06, 1.3, 0.09); });
            };
          })(i));
        }
        return parts;
      })(),
      b: (function () {
        var parts = [function (ctx, u) {
          ctx.lineWidth = 0.05 * u;
          ctx.beginPath();
          ctx.arc(0, 0, 1.52 * u, 0, Math.PI * 2);
          ctx.stroke();
        }];
        for (var i = 0; i < 3; i += 1) {
          parts.push((function (index) {
            return function (ctx, u) {
              var angle = (index / 3) * Math.PI * 2;
              orb(ctx, u, angle, 1.52, 0.19);
              at(ctx, angle, function () { blade(ctx, u, 1.52, 1.8, 0.08); });
            };
          })(i));
        }
        return parts;
      })()
    }
  };

  // ------------------------------------------------------------ 本体

  /**
   * @param {object} options { config, doc }
   */
  function Weapons(options) {
    options = options || {};
    this.config = options.config;
    this.settings = this.config.weapons;
    this.doc = options.doc || global.document;

    /** 段ごとの絵。key = id:layer:color */
    this._sprites = {};
    /** レベル -> 段。100 個しかないので全部持っておきます。 */
    this._byLevel = {};
  }

  /**
   * そのレベルの段。
   *
   * 段の引き当ては**ルール側 (js/game.js) の関数をそのまま使います**。
   * 武器は当たり判定と特殊能力を持つので、見た目とルールで別々に計算すると、
   * 見えている武器と当たる武器がずれます。
   */
  Weapons.prototype.tierFor = function (level) {
    var cached = this._byLevel[level];
    if (cached) return cached;
    this._byLevel[level] = tierForLevel(level, this.settings);
    return this._byLevel[level];
  };

  /**
   * 段の中でどこまで来たか (0〜1)。
   *
   * 中間レベルの成長はこれ 1 つで表します。Lv11〜14 で光が強くなり、
   * Lv15 で軌跡が出て、Lv16〜19 で軌跡が伸びる、という具合です。
   * レベルごとに絵を持たなくて済むので、段が増えても重くなりません。
   */
  Weapons.prototype.progressFor = function (level) {
    var tier = this.tierFor(level);
    var tiers = this.settings.tiers;
    var index = tiers.indexOf(tier);
    var next = tiers[index + 1];
    if (!next) return 1;
    var span = next.minLevel - tier.minLevel;
    return span > 0 ? Math.min(1, (level - tier.minLevel) / span) : 1;
  };

  /**
   * そのレベルの武器の大きさ (円の半径に対する倍率)。
   *
   * レベルに対してまっすぐ増えます。段ごとの階段にしないのは、
   * 段の終わり (Lv19) の武器が次の段の頭 (Lv20) より大きく見えてしまうと、
   * 「育つほど強そう」が崩れるためです。
   */
  Weapons.prototype.scaleFor = function (level) {
    var max = this.config.viewers.levels.max;
    var lv = Math.max(1, Math.min(max, level));
    var min = this.settings.minScale;
    return min + ((lv - 1) / (max - 1)) * (this.settings.maxScale - min);
  };

  /** 次の段まであと何レベルか (0 なら最終段)。 */
  Weapons.prototype.levelsToNextTier = function (level) {
    var tiers = this.settings.tiers;
    var index = tiers.indexOf(this.tierFor(level));
    var next = tiers[index + 1];
    return next ? next.minLevel - level : 0;
  };

  /** 段が変わったか (レベルアップの演出を出す判断に使う)。 */
  Weapons.prototype.tierChanged = function (from, to) {
    if (to <= from) return null;
    var before = this.tierFor(from);
    var after = this.tierFor(to);
    return before === after ? null : after;
  };

  /**
   * 段 x 層 x 色 の部品をまとめて作る (作るのは最初の 1 回だけ)。
   *
   * 部品を大きな四角に描いてから、**中身の入っている範囲を測って切り出します**。
   * 範囲を手で書くと、書き間違えたぶんだけ武器の端が切れます。測れば必ず合い、
   * しかも余白ゼロなので塗る面積が最小になります。
   *
   * @returns {Array} [{ canvas, x, y, w, h }] x/y/w/h は「円の半径 = 1」の単位
   */
  Weapons.prototype._parts = function (tier, layer, color) {
    var key = tier.id + ':' + layer + ':' + color;
    var cached = this._sprites[key];
    if (cached !== undefined) return cached;

    var painters = (PAINTERS[tier.id] || {})[layer];
    if (!painters || !painters.length || !this.doc) {
      this._sprites[key] = null;
      return null;
    }

    var half = Math.ceil(UNIT * this.settings.extent * PAD);
    var blur = UNIT * 0.28;
    // 上の段ほど強く光らせます。同じ絵を重ねるだけなので、形は変わりません。
    // 9:16 の縦画面を遠くから見たとき、レベルの高さがまず光の量で分かるように。
    var passes = 1 + Math.min(2, Math.floor(this.settings.tiers.indexOf(tier) / 4));

    var parts = [];
    for (var i = 0; i < painters.length; i += 1) {
      var part = this._buildPart(painters[i], half, blur, color, passes);
      if (part) parts.push(part);
    }

    this._sprites[key] = parts.length ? parts : null;
    return this._sprites[key];
  };

  /** 部品 1 つを描いて、中身のあるところだけ切り出す。 */
  Weapons.prototype._buildPart = function (painter, half, blur, color, passes) {
    var scratch = this.doc.createElement('canvas');
    scratch.width = half * 2;
    scratch.height = half * 2;

    var ctx = scratch.getContext('2d');
    ctx.translate(half, half);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;

    for (var pass = 0; pass < passes; pass += 1) {
      if (pass > 0) {
        // 濃い色を上限まで足すと、何色でも白くなります。段の色が分からなく
        // なると「どの武器か」が読めないので、重ねるぶんは薄くします。
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4;
      }
      painter(ctx, UNIT);
    }

    var bounds = inkBounds(ctx, half * 2);
    if (!bounds) return null;

    var canvas = this.doc.createElement('canvas');
    canvas.width = bounds.w;
    canvas.height = bounds.h;
    canvas.getContext('2d').drawImage(scratch, bounds.x, bounds.y, bounds.w, bounds.h,
      0, 0, bounds.w, bounds.h);

    return {
      canvas: canvas,
      // 「円の半径 = 1」に直しておくと、貼るときは半径を掛けるだけで済みます
      x: (bounds.x - half) / UNIT,
      y: (bounds.y - half) / UNIT,
      w: bounds.w / UNIT,
      h: bounds.h / UNIT
    };
  };

  /** 実際に色が乗っている範囲を測る。空なら null。 */
  function inkBounds(ctx, size) {
    var data;
    try {
      data = ctx.getImageData(0, 0, size, size).data;
    } catch (err) {
      return { x: 0, y: 0, w: size, h: size };   // 読めない環境では切り出さない
    }

    var minX = size, minY = size, maxX = -1, maxY = -1;
    for (var y = 0; y < size; y += 1) {
      var row = y * size * 4;
      for (var x = 0; x < size; x += 1) {
        if (data[row + x * 4 + 3] < 4) continue;              // ほぼ透明は無視
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /**
   * 部品をまとめて 1 回転ぶん貼る。
   *
   * 回転と移動は層ごとに 1 回だけ掛け、部品はその中で位置をずらして貼ります。
   */
  Weapons.prototype._stamp = function (ctx, parts, x, y, r, angle, alpha, scale) {
    var k = r * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      ctx.drawImage(part.canvas, part.x * k, part.y * k, part.w * k, part.h * k);
    }
    ctx.restore();
  };

  /**
   * 円 1 つぶんの武器を描く。**円より先に呼びます** (プロフィール画像を隠さないため)。
   *
   * @param {number} r     画面上での円の半径 (px)
   * @param {number} scale フィールド座標 → 画面 px の倍率
   */
  Weapons.prototype.draw = function (ctx, circle, x, y, r, now, scale) {
    var settings = this.settings;
    if (!settings.enabled || r < settings.minRadiusPx) return;

    var tier = this.tierFor(circle.level);
    var painters = PAINTERS[tier.id] || {};
    if (!painters.a && !painters.b) return;                 // Lv1〜9 は武器なし

    var color = circle.demo ? settings.npcColor : tier.color;
    var progress = this.progressFor(circle.level);

    // 段の中での成長。濃さはこの段の進み具合、大きさはレベルそのもので決めます
    var alpha = 0.82 + progress * 0.18;
    var grow = this.scaleFor(circle.level);
    // NPC は同じレベルの本物より必ず控えめに見えるようにします
    if (circle.demo) alpha *= settings.npcAlpha;

    /*
     * 回転の角度は**円が持っているもの**をそのまま使います。ここで時刻から
     * 計算し直すと、当たり判定 (engine 側) と 1 フレームぶんずれて、
     * 「当たったように見えたのに当たらない」が起きます。
     */
    var angle = circle.weaponAngle || 0;
    var counter = angle * (settings.counterSpin || 0);
    var hitLayer = (tier.hit && tier.hit.layer) || 'a';

    // 軌跡は段の後半から (Lv15 / Lv25 …)。速さと向きは円が持っているので、
    // 履歴を貯めなくても「さっきまで居た場所」に貼るだけで出せます。
    // 小さく映っている円では、貼るぶんだけ塗る面積が増えるので出しません。
    var trail = r >= settings.detailRadiusPx && progress >= settings.trailFrom
      ? (progress - settings.trailFrom) / (1 - settings.trailFrom)
      : 0;

    // 当たる側の層は当たり判定と同じ角度で、もう一方はゆっくり逆に回します
    var layers = [
      { parts: this._parts(tier, 'a', color), angle: hitLayer === 'a' ? angle : counter },
      { parts: this._parts(tier, 'b', color), angle: hitLayer === 'b' ? angle : counter }
    ];

    for (var i = 0; i < layers.length; i += 1) {
      var layer = layers[i];
      if (!layer.parts) continue;

      if (trail > 0) {
        var back = 0.06 * trail;
        this._stamp(ctx, layer.parts,
          x - circle.velocity.x * scale * back,
          y - circle.velocity.y * scale * back,
          r, layer.angle - tier.spin * back, alpha * 0.3 * trail, grow);
      }

      this._stamp(ctx, layer.parts, x, y, r, layer.angle, alpha, grow);
    }
  };

  // -------------------------------------------------------- 攻撃エフェクト

  /**
   * 攻撃の見え方。武器ごとに形を変えます。
   *
   * 描くのは**円と敵が触れた場所**です。円の真上に描くとプロフィール画像に
   * かぶるので、必ず接点側へ寄せます。どれも 0.22 秒で消えます。
   *
   * @param {object} effect { kind, x, y, angle, radius, color, at }
   */
  Weapons.prototype.drawAttack = function (ctx, effect, scale, now) {
    var life = this.settings.attackEffects.lifeMs;
    var age = now - effect.at;
    if (age > life) return false;

    var t = age / life;
    var r = effect.radius * scale;
    var x = effect.x * scale;
    var y = effect.y * scale;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(effect.angle);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = effect.color;
    ctx.fillStyle = effect.color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, r * 0.22);

    switch (effect.kind) {
      case 'slash':                          // 斬撃トレイル
        arc(ctx, r * (0.9 + t * 0.5), -0.8 + t * 1.2, 0.5 + t * 1.2);
        break;

      case 'twin':                           // 2 方向からの斬撃
        arc(ctx, r * (0.9 + t * 0.5), -1.1 + t * 1.1, -0.1 + t * 1.1);
        arc(ctx, r * (0.9 + t * 0.5), Math.PI - 1.1 + t * 1.1, Math.PI - 0.1 + t * 1.1);
        break;

      case 'thrust':                         // 突進 (まっすぐ伸びる線)
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, 0);
        ctx.lineTo(r * (0.6 + t * 1.4), 0);
        ctx.stroke();
        break;

      case 'impact':                         // 大きなインパクト (二重の衝撃波)
        ctx.lineWidth = Math.max(2.5, r * 0.34 * (1 - t));
        arc(ctx, r * (0.7 + t * 1.2), -0.95, 0.95);
        ctx.lineWidth = Math.max(1.5, r * 0.14 * (1 - t));
        arc(ctx, r * (0.5 + t * 0.7), -0.6, 0.6);
        break;

      case 'sweep':                          // 円形の斬撃
        ctx.lineWidth = Math.max(1.5, r * 0.18);
        arc(ctx, r * (1.0 + t * 0.6), t * 6.283, t * 6.283 + 4.4);
        break;

      case 'spin':                           // 回転する攻撃
        arc(ctx, r * 1.1, t * 9, t * 9 + 1.5);
        arc(ctx, r * 1.1, t * 9 + Math.PI, t * 9 + Math.PI + 1.5);
        break;

      case 'bolt': {                         // エネルギー弾 (尾を引いて飛ぶ)
        var head = r * (0.3 + t * 1.8);
        ctx.lineWidth = Math.max(2, r * 0.26 * (1 - t * 0.6));
        ctx.beginPath();
        ctx.moveTo(head - r * 0.7, 0);
        ctx.lineTo(head, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(head, 0, Math.max(2, r * 0.22 * (1 - t * 0.5)), 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'wing':                           // 幅の広いエネルギー攻撃
        ctx.lineWidth = Math.max(2, r * 0.24 * (1 - t));
        arc(ctx, r * (0.8 + t * 1.2), -1.35, 1.35);
        break;

      case 'multi':                          // 複数方向からの攻撃
        for (var i = 0; i < 3; i += 1) {
          var a = (i / 3) * Math.PI * 2 + t * 3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5);
          ctx.lineTo(Math.cos(a) * r * (1.5 - t * 1.5), Math.sin(a) * r * (1.5 - t * 1.5));
          ctx.stroke();
        }
        break;

      case 'core':                           // 最終形態専用
        ctx.lineWidth = Math.max(2, r * 0.2 * (1 - t));
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.5 + t * 1.6), 0, Math.PI * 2);
        ctx.stroke();
        for (var k = 0; k < 4; k += 1) {
          var ka = (k / 4) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ka) * r * 0.4, Math.sin(ka) * r * 0.4);
          ctx.lineTo(Math.cos(ka) * r * (0.9 + t * 1.3), Math.sin(ka) * r * (0.9 + t * 1.3));
          ctx.stroke();
        }
        break;

      default:
        break;
    }

    ctx.restore();
    return true;
  };

  function arc(ctx, radius, from, to) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, from, to);
    ctx.stroke();
  }

  global.CB = global.CB || {};
  global.CB.Weapons = Weapons;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Weapons: Weapons };
  }
})(typeof window !== 'undefined' ? window : this);
