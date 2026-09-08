/**
 * game.js - バトルエンジン。
 *
 *   自動生成される敵  VS  視聴者が生成した円
 *
 * このファイルは TikTok を知りません。知っているのは
 * 「円を出してくれ」「時間が進んだ」の 2 つだけです。
 *
 *   engine.spawnCircle({ ownerId, ownerName, level, ... });
 *   engine.update(nowMs);
 *
 * 得点の配り方もランキングも持ちません。敵が倒れたら
 * 「誰がどれだけ削ったか」を付けて 'enemy:killed' を出すだけで、
 * それをどう点にするかは game-session.js の仕事です。
 *
 * Node からも読めます:  require('./js/game.js').BattleEngine
 */
(function (global) {
  'use strict';

  /**
   * レベルから円の各値を出す。
   *
   *   value = base * level ^ exp
   *
   * LIKE も FOLLOW も GIFT も、違うのは「何レベル上がるか」だけです。
   * 円の強さはレベルだけで決まるので、育て方が変わっても
   * ここから先を触る必要はありません。
   *
   * @param {number} level    1 〜 levels.max
   * @param {object} viewers  CONFIG.viewers
   */
  /**
   * そのレベルの武器の段を返す。
   *
   * 武器は見た目だけでなく**当たり判定と特殊能力**を持つので、段の引き当ては
   * ルール側 (ここ) が持ちます。描画側 (js/weapons.js) はこれを読むだけです。
   * 2 か所で別々に計算すると、見えている武器と当たる武器がずれます。
   */
  function weaponTierFor(level, weapons) {
    var tiers = (weapons && weapons.tiers) || [];
    var found = tiers[0] || null;
    for (var i = 0; i < tiers.length; i += 1) {
      if (level >= tiers[i].minLevel) found = tiers[i]; else break;
    }
    return found;
  }

  /** 角度の差を -π〜π に畳む。 */
  function angleDelta(a, b) {
    var d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function statsForLevel(level, viewers) {
    var scaling = viewers.scaling;
    var lv = clampLevel(level, viewers);
    var base = viewers.base;

    return {
      level: lv,
      hp: Math.round(base.hp * Math.pow(lv, scaling.hpExp)),
      attack: Math.round(base.attack * Math.pow(lv, scaling.attackExp)),
      radius: Math.min(base.radius * Math.pow(lv, scaling.radiusExp), scaling.maxRadius),
      speed: Math.max(base.speed * Math.pow(lv, scaling.speedExp), scaling.minSpeed),
      attackIntervalMs: base.attackIntervalMs
    };
  }

  /** 1 〜 上限に収める。 */
  function clampLevel(level, viewers) {
    var max = viewers.levels.max;
    var lv = Math.floor(Number(level) || 1);
    return Math.max(1, Math.min(lv, max));
  }

  /**
   * ギフトのコイン価値 -> 上がるレベル。
   *
   *   levels = coins * giftLevelsPerCoin
   *
   * GIFT イベントからも、アイテム (「100 コインギフト相当」) からも
   * ここを通します。式が 2 箇所にあると、片方だけ変えたときにずれるためです。
   */
  function levelsFromGift(coins, viewers) {
    var levels = viewers.levels;
    var value = Math.max(0, Number(coins) || 0) * levels.giftLevelsPerCoin;
    return Math.max(levels.giftMinLevels, Math.ceil(value));
  }

  /**
   * @param {object} [options] { config, now, random }
   */
  function BattleEngine(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.CONFIG);
    if (!this.config) throw new Error('BattleEngine: config が渡されていません');

    this.now = options.now || function () { return Date.now(); };
    this.random = options.random || Math.random;

    this.field = { width: this.config.field.width, height: this.config.field.height };
    /** 縦横比 (幅 ÷ 高さ)。画面の比に合わせて変えられます。 */
    this.fieldAspect = this.field.width / this.field.height;
    /** 何段階広がっているか (0 = 元の大きさ)。 */
    this.stage = 0;
    this._stageFrom = this.field.width;
    this._stageTo = this.field.width;
    this._stageAt = null;
    this._stageReadyAt = 0;
    this.enemyTypes = this.config.enemies.types.slice();

    this.enemies = [];
    this.circles = [];
    /** フィールドに落ちているアイテム。視聴者の円だけが拾えます。 */
    this.items = [];
    this.itemTypes = (this.config.items && this.config.items.types || []).slice();

    this.stats = {
      defeated: 0,        // 倒した敵の総数 (画面の ENEMIES DEFEATED)
      spawned: 0,
      circlesSpawned: 0,
      damage: 0,
      itemsTaken: 0
    };

    this._seq = 0;
    this._lastUpdate = null;
    this._nextSpawnAt = null;
    this._nextItemAt = null;
    this._listeners = {};
  }

  BattleEngine.statsForLevel = statsForLevel;
  BattleEngine.levelsFromGift = levelsFromGift;

  /** ギフトのコイン価値 -> 上がるレベル。GIFT もアイテムもここを通します。 */
  BattleEngine.prototype.levelsFromGift = function (coins) {
    return levelsFromGift(coins, this.config.viewers);
  };

  /** レベルの上限。 */
  BattleEngine.prototype.maxLevel = function () {
    return this.config.viewers.levels.max;
  };

  /**
   * その円の武器の段。レベルごとに覚えておきます (段は 11 個しかありません)。
   */
  BattleEngine.prototype.weaponTier = function (level) {
    var weapons = this.config.weapons;
    if (!weapons || !weapons.enabled) return null;
    if (!this._tiers) this._tiers = {};
    if (this._tiers[level] === undefined) {
      this._tiers[level] = weaponTierFor(level, weapons);
    }
    return this._tiers[level];
  };

  /** その円の特殊能力 (無ければ null)。 */
  BattleEngine.prototype.abilityOf = function (circle) {
    var tier = this.weaponTier(circle.level);
    return tier ? tier.ability : null;
  };

  // ------------------------------------------------------------- events

  BattleEngine.prototype.on = function (name, handler) {
    (this._listeners[name] || (this._listeners[name] = [])).push(handler);
    return this;
  };

  /**
   * 購読をやめる。
   *
   * 画面は 2 つ (操作画面 / ゲームウィンドウ) あり、ゲームウィンドウは
   * 閉じられます。閉じた画面の handler を残したままにすると、
   * 既に無いウィンドウの音や DOM を触りにいってエラーになります。
   */
  BattleEngine.prototype.off = function (name, handler) {
    var handlers = this._listeners[name];
    if (!handlers) return this;
    var i = handlers.indexOf(handler);
    if (i !== -1) handlers.splice(i, 1);
    return this;
  };

  BattleEngine.prototype.emit = function (name, payload) {
    var handlers = this._listeners[name];
    if (!handlers) return;
    handlers.slice().forEach(function (handler) { handler(payload); });
  };

  // -------------------------------------------------------- enemy types

  /**
   * 敵の種類を足す。config を書き換えずに、あとから増やせます。
   * (イベントボス、期間限定の敵などを想定)
   */
  BattleEngine.prototype.addEnemyType = function (type) {
    this.enemyTypes.push(type);
    return this;
  };

  BattleEngine.prototype.getEnemyType = function (id) {
    for (var i = 0; i < this.enemyTypes.length; i += 1) {
      if (this.enemyTypes[i].id === id) return this.enemyTypes[i];
    }
    return null;
  };

  // ------------------------------------------------------------- stage

  /** 円と敵が床のどれだけを占めているか (0 〜 1)。 */
  BattleEngine.prototype.coverage = function () {
    var area = 0;
    var i;
    for (i = 0; i < this.circles.length; i += 1) {
      area += Math.PI * this.circles[i].radius * this.circles[i].radius;
    }
    for (i = 0; i < this.enemies.length; i += 1) {
      area += Math.PI * this.enemies[i].radius * this.enemies[i].radius;
    }
    return area / (this.field.width * this.field.height);
  };

  /**
   * フィールドの縦横比を画面に合わせる。
   *
   * 配信に映すゲーム画面が「自分の canvas の比」を渡します。合わせておくと、
   * 盤面が画面いっぱいに広がり、上下や左右に隙間ができません。
   * 幅はそのままで高さだけを変えるので、横方向の配置は動きません。
   *
   * @param {number} aspect 幅 ÷ 高さ
   */
  BattleEngine.prototype.setFieldAspect = function (aspect) {
    if (!(aspect > 0) || !isFinite(aspect)) return this;
    if (Math.abs(aspect - this.fieldAspect) < 0.0005) return this;

    this.fieldAspect = aspect;
    this._resizeField(this.field.width, this.field.width / aspect);
    return this;
  };

  /** その段階でのフィールドの広さ。 */
  BattleEngine.prototype.stageWidth = function (stage) {
    return this.config.field.width * Math.pow(this.config.field.expand.step, stage);
  };

  /**
   * 混み具合を見てフィールドの広さを変える。
   *
   * 変化は一瞬ではなく durationMs をかけて進みます。座標も同じ割合で広げるので、
   * 画面は静かにズームアウト / ズームインし、円の位置関係は変わりません。
   */
  BattleEngine.prototype._stageTick = function (now) {
    var expand = this.config.field.expand;
    if (!expand || !expand.enabled) return;

    // --- 進行中の変化を進める
    if (this._stageAt != null) {
      var t = Math.min(1, (now - this._stageAt) / expand.durationMs);
      // ゆっくり始まってゆっくり終わる (急に動くと目が追えないため)
      var eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this._resizeField(this._stageFrom + (this._stageTo - this._stageFrom) * eased);

      if (t >= 1) {
        this._stageAt = null;
        this._stageReadyAt = now + expand.cooldownMs;
        this.emit('stage:settled', { stage: this.stage, width: this.field.width });
      }
      return;
    }

    if (now < this._stageReadyAt) return;

    // --- 広げる / 戻すの判定
    var coverage = this.coverage();
    var next = this.stage;
    if (coverage > expand.growAt && this.stage < expand.maxSteps) next = this.stage + 1;
    else if (coverage < expand.shrinkAt && this.stage > 0) next = this.stage - 1;
    if (next === this.stage) return;

    var growing = next > this.stage;
    this.stage = next;
    this._stageFrom = this.field.width;
    this._stageTo = this.stageWidth(next);
    this._stageAt = now;

    this.emit('stage:change', {
      stage: next,
      growing: growing,
      from: this._stageFrom,
      to: this._stageTo,
      scale: this._stageTo / this.config.field.width,
      durationMs: expand.durationMs,
      coverage: coverage,
      at: now
    });
  };

  /**
   * フィールドの広さを変える。
   *
   * 中にいるものの座標も同じ割合で動かします。そうしないと、広げたときに
   * 全員が元の範囲に固まったままになり、外側に誰も居ない空き地ができます。
   * 半径と速さは変えないので、広いほど散らばって見えます。
   */
  BattleEngine.prototype._resizeField = function (width, height) {
    var target = { width: width, height: height != null ? height : width / this.fieldAspect };
    var wRatio = target.width / this.field.width;
    var hRatio = target.height / this.field.height;
    if (!isFinite(wRatio) || !isFinite(hRatio)) return;
    if (wRatio === 1 && hRatio === 1) return;

    this.field.width = target.width;
    this.field.height = target.height;

    // 縦と横で別々に伸ばします。まとめて 1 つの倍率にすると、画面の比に
    // 合わせて高さだけ変えたときに、横方向まで動いて配置が崩れます。
    var i;
    for (i = 0; i < this.circles.length; i += 1) {
      this.circles[i].position.x *= wRatio;
      this.circles[i].position.y *= hRatio;
    }
    for (i = 0; i < this.enemies.length; i += 1) {
      this.enemies[i].position.x *= wRatio;
      this.enemies[i].position.y *= hRatio;
    }
    for (i = 0; i < this.items.length; i += 1) {
      this.items[i].position.x *= wRatio;
      this.items[i].position.y *= hRatio;
    }
  };

  /**
   * 敵の HP 倍率。
   *
   * フィールドにいる視聴者円の合計レベルから決めます。誰も育っていなければ 1 倍、
   * 育った円が並ぶほど硬くなります。撃破ポイントは変わらないので、
   * 強い人がいるほど 1 体あたりの価値が上がるわけではありません。
   */
  BattleEngine.prototype.enemyHpMultiplier = function () {
    var scale = this.config.enemies.scale;
    if (!scale || !(scale.hpPerTotalLevel > 0)) return 1;

    var total = 0;
    for (var i = 0; i < this.circles.length; i += 1) total += this.circles[i].level;
    return Math.min(1 + total / scale.hpPerTotalLevel, scale.maxHpMultiplier);
  };

  /** weight に比例した抽選。 */
  BattleEngine.prototype.pickEnemyType = function () {
    var total = 0;
    var i;
    for (i = 0; i < this.enemyTypes.length; i += 1) {
      total += Math.max(0, Number(this.enemyTypes[i].weight) || 0);
    }
    if (total <= 0) return this.enemyTypes[0];

    var roll = this.random() * total;
    for (i = 0; i < this.enemyTypes.length; i += 1) {
      roll -= Math.max(0, Number(this.enemyTypes[i].weight) || 0);
      if (roll < 0) return this.enemyTypes[i];
    }
    return this.enemyTypes[this.enemyTypes.length - 1];
  };

  // ------------------------------------------------------------- spawn

  BattleEngine.prototype._id = function (prefix) {
    this._seq += 1;
    return prefix + '-' + this._seq;
  };

  /**
   * 生まれた円が進む向きを決める。
   *
   * 中央へ向けて撃ち出します。壁の反射は速度の x と y の大きさを変えないので、
   * **最初の向きがそのまま一生の軌道になります**。ここで壁沿いの向きを
   * 与えてしまうと、その円は二度と真ん中を通りません。
   */
  BattleEngine.prototype._launchHeading = function (position) {
    var motion = this.config.motion;
    var toCenter = Math.atan2(this.field.height / 2 - position.y,
                              this.field.width / 2 - position.x);
    var spread = (1 - motion.aimAtCenter) * Math.PI;
    var heading = toCenter + (this.random() * 2 - 1) * spread;
    return this._avoidWallParallel(heading);
  };

  /** 縦や横にまっすぐな向き (= 壁をなぞる向き) を避ける。 */
  BattleEngine.prototype._avoidWallParallel = function (heading) {
    var min = this.config.motion.minWallAngleDeg * Math.PI / 180;
    var quarter = Math.PI / 2;
    var nearest = Math.round(heading / quarter);
    var diff = heading - nearest * quarter;
    if (Math.abs(diff) < min) heading = nearest * quarter + (diff < 0 ? -min : min);
    return heading;
  };

  /**
   * 壁際に居座っている円を、中央へ向け直す。
   *
   * 生まれる向きを中央へ向けても、他の円とぶつかった拍子に壁沿いの向きへ
   * 変わることがあります。そのときの保険です。すぐには向きを変えず、
   * 一定時間ずっと壁際にいた円だけを向け直すので、普通に往復している円は
   * 影響を受けません。
   */
  BattleEngine.prototype._recenterTick = function (list, now) {
    var motion = this.config.motion;
    if (!(motion.recenterAfterMs > 0)) return;

    for (var i = 0; i < list.length; i += 1) {
      var entity = list[i];
      var band = entity.radius * motion.wallBand;
      var p = entity.position;
      var nearWall = p.x < band || p.x > this.field.width - band ||
                     p.y < band || p.y > this.field.height - band;

      if (!nearWall) { entity.wallSince = null; continue; }
      if (entity.wallSince == null) { entity.wallSince = now; continue; }
      if (now - entity.wallSince < motion.recenterAfterMs) continue;

      var heading = this._launchHeading(p);
      entity.velocity.x = Math.cos(heading) * entity.speed;
      entity.velocity.y = Math.sin(heading) * entity.speed;
      entity.wallSince = null;
    }
  };

  /**
   * 他の敵と重ならない場所を探して返す。
   *
   * 端に大きい敵が居座っていると、そこへ湧いた小さい敵がそのまま
   * 中に埋まって見えなくなります。数回試して空いている場所を選び、
   * **どこも空いていなければ何も返しません** (今回は湧かせない)。
   * 無理に置くくらいなら、次の間隔まで待つほうがきれいです。
   *
   * @returns {object|null}
   */
  BattleEngine.prototype._freeEdgePosition = function (radius) {
    var best = null;
    var bestClearance = -Infinity;
    // 少しだけ (半径の 2 割) なら重なりを許す。すぐ押し離されます。
    var allowed = -radius * 0.2;

    for (var attempt = 0; attempt < 12; attempt += 1) {
      var pos = this._edgePosition(radius);
      var clearance = Infinity;

      for (var i = 0; i < this.enemies.length; i += 1) {
        var enemy = this.enemies[i];
        var dx = enemy.position.x - pos.x;
        var dy = enemy.position.y - pos.y;
        var gap = Math.sqrt(dx * dx + dy * dy) - (enemy.radius + radius);
        if (gap < clearance) clearance = gap;
      }

      if (clearance > 0) return pos;                 // 誰とも重ならない場所
      if (clearance > bestClearance) { bestClearance = clearance; best = pos; }
    }
    return bestClearance >= allowed ? best : null;
  };

  /**
   * 敵が湧く場所。
   *
   * 外側から出しますが、**壁の上には置きません**。壁に貼り付いた状態で湧かせると、
   * 敵は倒されるまでの短い間ずっと端に居ることになり、画面が端に偏ります。
   * 辺に沿う位置も端 10% を避けるので、角にも固まりません。
   */
  BattleEngine.prototype._edgePosition = function (radius) {
    var spawn = this.config.enemies.spawn;
    var w = this.field.width;
    var h = this.field.height;

    var inset = Math.max(radius * 1.2, spawn.edgeInset * Math.min(w, h));
    var depth = inset + this.random() * inset * 0.5;
    var along = 0.1 + this.random() * 0.8;
    var side = Math.floor(this.random() * 4);

    if (side === 0) return { x: along * w, y: depth };
    if (side === 1) return { x: w - depth, y: along * h };
    if (side === 2) return { x: along * w, y: h - depth };
    return { x: depth, y: along * h };
  };

  /**
   * 敵を 1 体出す。
   * @param {string} [typeId] 指定しなければ weight で抽選します。
   */
  BattleEngine.prototype.spawnEnemy = function (typeId, at) {
    var type = typeId ? this.getEnemyType(typeId) : null;
    if (!type) type = this.pickEnemyType();
    if (!type) return null;

    var now = at != null ? at : this.now();
    var pos = this._freeEdgePosition(type.radius);
    // 置ける場所が無いほど混んでいる。次の間隔まで待ちます。
    if (!pos) return null;
    var heading = this._launchHeading(pos);
    var hp = Math.round(type.hp * this.enemyHpMultiplier());

    var enemy = {
      id: this._id('enemy'),
      typeId: type.id,
      label: type.label || type.id,
      color: type.color,
      hp: hp,
      maxHp: hp,
      radius: type.radius,
      speed: type.speed,
      attack: type.attack,
      attackIntervalMs: type.attackIntervalMs,
      points: type.points,
      position: { x: pos.x, y: pos.y },
      velocity: { x: Math.cos(heading) * type.speed, y: Math.sin(heading) * type.speed },
      bornAt: now,
      turnAt: now,
      lastAttackAt: 0,
      /** 誰がどれだけ削ったか。ownerId -> { ownerId, ownerName, profileImageUrl, damage } */
      contributions: {},
      /** とどめ候補。LAST HIT 方式のときに使います。 */
      lastHitBy: null,
      dead: false
    };

    this.enemies.push(enemy);
    this.stats.spawned += 1;
    this.emit('enemy:spawn', enemy);
    return enemy;
  };

  /**
   * 視聴者の円を 1 つ出す。
   *
   * @param {object} spec
   *   ownerId, ownerName, displayName, profileImageUrl, sourceEvent, level, demo
   */
  BattleEngine.prototype.spawnCircle = function (spec, at) {
    var viewers = this.config.viewers;
    var limits = viewers.limits;
    var now = at != null ? at : this.now();

    var ownerId = String(spec.ownerId);

    // 1 人が持てる数の上限。いっぱいなら出しません (null を返します)。
    // 押し出さないのは、育てた円が新しい円のせいで消えるのを避けるためです。
    // 出せなかったぶんをどうするか (順番待ちにする) は game-session.js が決めます。
    if (this.circleCountOf(ownerId) >= limits.maxPerUser) return null;

    // フィールド全体の上限。古いものから消します。
    while (this.circles.length >= limits.maxCircles) {
      this._removeCircle(this.circles[0], 'evicted');
    }

    var stats = statsForLevel(spec.level != null ? spec.level : 1, viewers);
    var position = {
      x: spec.x != null ? spec.x : stats.radius + this.random() * (this.field.width - stats.radius * 2),
      y: spec.y != null ? spec.y : stats.radius + this.random() * (this.field.height - stats.radius * 2)
    };
    // 大砲から撃つときは向きを指定します (中央へ向かって飛び込ませるため)。
    // 指定が無ければ今までどおり、中央寄りのランダムな向きです。
    var heading = spec.heading != null ? spec.heading : this._launchHeading(position);
    var launchMs = spec.launchMs > 0 ? spec.launchMs : 0;
    var launchSpeed = launchMs > 0 ? (spec.launchSpeed || 1) : 1;

    var circle = {
      id: this._id('circle'),
      ownerId: ownerId,
      ownerName: spec.ownerName || ownerId,
      displayName: spec.displayName || spec.ownerName || ownerId,
      profileImageUrl: spec.profileImageUrl || null,
      /** 'LIKE' | 'FOLLOW' | 'SHARE' | 'GIFT' | 'JOIN' | ... どのイベントで生まれたか。 */
      sourceEvent: spec.sourceEvent || null,
      /** 1 〜 100。育つほど強く、大きくなります。 */
      level: stats.level,
      hp: stats.hp,
      maxHp: stats.hp,
      attack: stats.attack,
      radius: stats.radius,
      speed: stats.speed,
      /** 生まれたときの速さ。速度アイテムの上限をここから決めます。 */
      baseSpeed: stats.speed,
      attackIntervalMs: stats.attackIntervalMs,
      position: position,
      velocity: {
        x: Math.cos(heading) * stats.speed * launchSpeed,
        y: Math.sin(heading) * stats.speed * launchSpeed
      },
      /**
       * 大砲から飛んでいる間の終わり時刻。null なら通常の円です。
       *
       * この間は戦わず、他ともぶつかりません。撃ち出した先に円が詰まっていると、
       * 出た瞬間に弾かれて「大砲から飛び込んだ」ように見えないためです。
       */
      launchUntil: launchMs > 0 ? now + launchMs : null,
      kills: 0,
      damage: 0,
      bornAt: now,
      /** 最大レベルで暴れ始めた時刻。まだなら null。 */
      maxedAt: null,
      /** 暴れる時間の終わり。Infinity なら無期限。 */
      burstUntil: null,
      lastAttackAt: 0,
      /**
       * 武器の向き (ラジアン)。**当たり判定も描画もこの 1 つを見ます。**
       * 生まれた向きは円ごとにずらします (全部が揃って回ると作り物に見えます)。
       */
      weaponAngle: this.random() * Math.PI * 2,
      /** 武器で最後に殴った時刻。本体の殴り合いとは別に数えます。 */
      lastWeaponAt: 0,
      /**
       * 衝撃波 (NOVA) を最後に出した時刻。
       * 0 で始めるので、最大レベルに届いた瞬間に 1 発目が出ます (区切りの演出)。
       */
      lastNovaAt: 0,
      demo: Boolean(spec.demo),
      dead: false
    };

    this.circles.push(circle);
    this.stats.circlesSpawned += 1;
    this.emit('circle:spawn', circle);
    // 高額ギフトなどで、いきなり最大レベルで生まれることもあります
    if (circle.level >= this.maxLevel()) this._enterBurst(circle, now);
    return circle;
  };

  /**
   * 条件に合う円を消す。
   * (デモ視聴者の円を、本物の視聴者が来たあと少しずつ引き上げるのに使います)
   *
   * @param {function} predicate
   * @param {number} [limit] 一度に消す数。省略すると全部
   */
  BattleEngine.prototype.removeCirclesWhere = function (predicate, limit) {
    var doomed = this.circles.filter(predicate);
    if (limit > 0) doomed = doomed.slice(0, limit);
    for (var i = 0; i < doomed.length; i += 1) this._removeCircle(doomed[i], 'retired');
    return doomed.length;
  };

  // -------------------------------------------------------------- items

  /**
   * アイテムの種類を足す。敵と同じで、config に 1 行足すだけでも増やせます。
   */
  BattleEngine.prototype.addItemType = function (type) {
    this.itemTypes.push(type);
    return this;
  };

  BattleEngine.prototype.getItemType = function (id) {
    for (var i = 0; i < this.itemTypes.length; i += 1) {
      if (this.itemTypes[i].id === id) return this.itemTypes[i];
    }
    return null;
  };

  BattleEngine.prototype.pickItemType = function () {
    var total = 0;
    var i;
    for (i = 0; i < this.itemTypes.length; i += 1) {
      total += Math.max(0, Number(this.itemTypes[i].weight) || 0);
    }
    if (total <= 0) return this.itemTypes[0] || null;

    var roll = this.random() * total;
    for (i = 0; i < this.itemTypes.length; i += 1) {
      roll -= Math.max(0, Number(this.itemTypes[i].weight) || 0);
      if (roll < 0) return this.itemTypes[i];
    }
    return this.itemTypes[this.itemTypes.length - 1];
  };

  /**
   * アイテムを 1 つ置く。
   *
   * 置く場所はフィールドの内側だけで、壁際には寄せません。
   * 壁に張り付いていると、跳ね返る円が触れにくくなるためです。
   */
  BattleEngine.prototype.spawnItem = function (typeId, at) {
    var settings = this.config.items;
    var type = typeId ? this.getItemType(typeId) : null;
    if (!type) type = this.pickItemType();
    if (!type) return null;

    var now = at != null ? at : this.now();
    var radius = type.radius || settings.radius;
    var margin = radius * 3;

    var item = {
      id: this._id('item'),
      typeId: type.id,
      label: type.label || type.id,
      color: type.color,
      radius: radius,
      effect: type.effect,
      position: {
        x: margin + this.random() * (this.field.width - margin * 2),
        y: margin + this.random() * (this.field.height - margin * 2)
      },
      bornAt: now,
      /** 拾われないまま残り続けないように、時間で消えます。 */
      expiresAt: settings.lifetimeMs > 0 ? now + settings.lifetimeMs : Infinity
    };

    this.items.push(item);
    this.emit('item:spawn', item);
    return item;
  };

  /** 一定間隔でアイテムを置き、時間切れのものを片付ける。 */
  BattleEngine.prototype._itemsTick = function (now) {
    var settings = this.config.items;
    if (!settings || !settings.enabled) return;

    for (var i = this.items.length - 1; i >= 0; i -= 1) {
      if (now >= this.items[i].expiresAt) {
        var expired = this.items.splice(i, 1)[0];
        this.emit('item:expired', expired);
      }
    }

    if (this._nextItemAt == null) this._nextItemAt = now + settings.spawn.firstDelayMs;
    while (now >= this._nextItemAt) {
      if (this.items.length < settings.spawn.maxAlive) this.spawnItem(null, now);
      this._nextItemAt += settings.spawn.intervalMs;
    }
  };

  /**
   * アイテムの効果をかける。
   *
   * **視聴者に不利になることはしません。** 弱くなる値は 1 つも書けないよう、
   * どの値も「今の値と比べて大きいほう」しか採りません。
   * 例えば強くなると本来は少し遅くなりますが、アイテムでは遅くなりません。
   */
  BattleEngine.prototype._applyItem = function (circle, item, now) {
    var viewers = this.config.viewers;
    var effect = item.effect || {};
    var before = {
      level: circle.level, hp: circle.hp, maxHp: circle.maxHp,
      attack: circle.attack, radius: circle.radius, speed: circle.speed,
      burstUntil: circle.burstUntil
    };

    if (effect.type === 'level') {
      // 「100 コインギフト相当のレベル」。ギフトと同じ式を通します。
      var levels = effect.levels != null
        ? effect.levels
        : levelsFromGift(effect.giftCoins, viewers);

      var stats = statsForLevel(Math.max(circle.level, clampLevel(levels, viewers)), viewers);
      circle.level = Math.max(circle.level, stats.level);
      circle.maxHp = Math.max(circle.maxHp, stats.hp);
      circle.attack = Math.max(circle.attack, stats.attack);
      circle.radius = Math.max(circle.radius, stats.radius);
      circle.speed = Math.max(circle.speed, stats.speed);
      // 拾ったごほうびとして全快させる (減ることはありません)
      circle.hp = circle.maxHp;
      // 最大レベルに届いたなら、ギフトで届いたときと同じように暴れ始めます
      if (circle.level >= this.maxLevel()) this._enterBurst(circle, now);

    } else if (effect.type === 'heal') {
      // HP を回復し、暴れている最中なら、その時間を延ばします。
      // 運よく拾えた円は長く暴れ続けられます。
      circle.hp = Math.min(circle.maxHp, circle.hp + circle.maxHp * (effect.ratio || 1));
      if (circle.burstUntil != null && circle.burstUntil !== Infinity && effect.extendMs > 0) {
        var limit = now + (effect.maxRemainingMs || effect.extendMs * 3);
        circle.burstUntil = Math.min(circle.burstUntil + effect.extendMs, limit);
      }

    } else if (effect.type === 'speed') {
      var cap = circle.baseSpeed * (effect.maxMultiplier || 1);
      circle.speed = Math.max(circle.speed, Math.min(circle.speed * effect.multiplier, cap));
      this._restoreSpeed(circle);
    }

    this.stats.itemsTaken += 1;
    this.emit('item:taken', {
      item: item, circle: circle, before: before, at: now,
      owner: {
        ownerId: circle.ownerId, ownerName: circle.ownerName,
        displayName: circle.displayName, profileImageUrl: circle.profileImageUrl,
        demo: circle.demo
      }
    });
  };

  /**
   * 拾えるのは視聴者の円だけです。敵は触れても素通りします
   * (敵が強くなると視聴者の不利益になるため)。
   */
  BattleEngine.prototype._collectItems = function (circle, now) {
    for (var i = this.items.length - 1; i >= 0; i -= 1) {
      var item = this.items[i];
      var dx = item.position.x - circle.position.x;
      var dy = item.position.y - circle.position.y;
      if (dx * dx + dy * dy > (item.radius + circle.radius) * (item.radius + circle.radius)) continue;

      this.items.splice(i, 1);
      this._applyItem(circle, item, now);
    }
  };

  /**
   * 円を育てる。
   *
   * 新しい円を出すのではなく、その人が今持っている円のレベルを上げます。
   * 上限に達している円は育ちません (呼び出し側が新しい円を作ります)。
   *
   * 増えたぶんの HP はそのまま回復します。育てたのに打たれ弱くなる、
   * という損をしないためです。
   *
   * @returns {number} 実際に上がったレベル数 (0 なら上限で上がらなかった)
   */
  BattleEngine.prototype.levelUp = function (circle, levels, at) {
    var viewers = this.config.viewers;
    var max = viewers.levels.max;
    if (circle.level >= max) return 0;

    var before = circle.level;
    var stats = statsForLevel(circle.level + Math.max(0, Math.floor(levels)), viewers);
    var gainedHp = stats.hp - circle.maxHp;

    circle.level = stats.level;
    circle.maxHp = stats.hp;
    circle.hp = Math.min(circle.maxHp, circle.hp + Math.max(0, gainedHp));
    circle.attack = stats.attack;
    circle.radius = stats.radius;
    circle.speed = stats.speed;
    circle.leveledAt = at != null ? at : this.now();
    this._restoreSpeed(circle);

    this.emit('circle:levelup', { circle: circle, from: before, to: circle.level, at: circle.leveledAt });
    if (circle.level >= max) this._enterBurst(circle, circle.leveledAt);
    return circle.level - before;
  };

  /**
   * 最大レベルの円が暴れ始める。
   *
   * 育てきった円をそのまま置いておくと、画面がだんだん最大レベルの円で
   * 埋まっていき、見せ場もありません。短い間だけとんでもなく強く・速くして
   * 稼がせ、時間が来たら燃え尽きて消えます。
   */
  BattleEngine.prototype._enterBurst = function (circle, at) {
    if (circle.maxedAt != null) return circle;

    var levels = this.config.viewers.levels;
    var bonus = levels.maxBonus || {};
    var now = at != null ? at : this.now();

    circle.maxedAt = now;
    circle.burstUntil = levels.maxDurationMs > 0 ? now + levels.maxDurationMs : Infinity;
    circle.attack = Math.round(circle.attack * (bonus.attack || 1));
    circle.speed = Math.min(circle.speed * (bonus.speed || 1), this.config.viewers.scaling.maxSpeed);
    circle.hp = circle.maxHp;
    this._restoreSpeed(circle);

    this.emit('circle:maxed', { circle: circle, until: circle.burstUntil, at: now });
    return circle;
  };

  /** 暴れる時間が終わった円を燃え尽きさせる。 */
  BattleEngine.prototype._burstTick = function (now) {
    for (var i = this.circles.length - 1; i >= 0; i -= 1) {
      var circle = this.circles[i];
      if (circle.burstUntil == null || now < circle.burstUntil) continue;
      this.circles.splice(i, 1);
      circle.dead = true;
      this.emit('circle:removed', { circle: circle, reason: 'burnout' });
    }
  };

  /** その人がフィールドに持っている円の数。 */
  BattleEngine.prototype.circleCountOf = function (ownerId) {
    var count = 0;
    for (var i = 0; i < this.circles.length; i += 1) {
      if (this.circles[i].ownerId === ownerId) count += 1;
    }
    return count;
  };

  /** その人がいま育てている円 (最新の 1 つ)。 */
  BattleEngine.prototype.circleOf = function (ownerId, id) {
    for (var i = this.circles.length - 1; i >= 0; i -= 1) {
      var circle = this.circles[i];
      if (circle.ownerId === ownerId && (!id || circle.id === id)) return circle;
    }
    return null;
  };

  BattleEngine.prototype._removeCircle = function (circle, reason) {
    var index = this.circles.indexOf(circle);
    if (index === -1) return;
    this.circles.splice(index, 1);
    circle.dead = true;
    this.emit('circle:removed', { circle: circle, reason: reason });
  };

  // -------------------------------------------------------------- loop

  /** 最初の敵を置いて時計を合わせる。 */
  BattleEngine.prototype.start = function (at) {
    var now = at != null ? at : this.now();
    this._lastUpdate = now;
    this._nextSpawnAt = now + this.config.enemies.spawn.intervalMs;
    // 最初のアイテムは起動から firstDelayMs 後。ここで決めておくと、
    // 最初の 1 フレームが何ミリ秒だったかに左右されません。
    if (this.config.items) this._nextItemAt = now + this.config.items.spawn.firstDelayMs;

    for (var i = 0; i < this.config.enemies.spawn.initialCount; i += 1) {
      this.spawnEnemy(null, now);
    }
    return this;
  };

  /**
   * 時間を進める。画面がある側 (main.js) が毎フレーム呼びます。
   *
   * TikTok のイベントが 1 件も来なくても、ここだけで
   * 「敵が出る / 動く / ぶつかる / 倒れる」は回り続けます。
   */
  BattleEngine.prototype.update = function (at) {
    var now = at != null ? at : this.now();

    if (this._lastUpdate == null) { this.start(now); return this; }

    var dt = Math.min(now - this._lastUpdate, this.config.loop.maxDeltaMs) / 1000;
    this._lastUpdate = now;
    if (dt <= 0) return this;

    this._stageTick(now);
    this._spawnTick(now);
    this._itemsTick(now);
    this._moveEnemies(dt, now);
    this._moveCirclesAndFight(dt, now);
    this._collideAll(this.enemies, dt);
    this._collideAll(this.circles, dt);
    this._recenterTick(this.enemies, now);
    this._recenterTick(this.circles, now);
    this._burstTick(now);
    this._cleanup();

    this.emit('tick', { at: now, dt: dt });
    return this;
  };

  /**
   * 常にフィールドに居てほしい敵の数。
   * 視聴者が増えるほど増やして、敵が一瞬で溶ける状態を避けます。
   */
  BattleEngine.prototype.targetAlive = function () {
    var spawn = this.config.enemies.spawn;
    var extra = spawn.circlesPerExtraEnemy > 0
      ? Math.floor(this.circles.length / spawn.circlesPerExtraEnemy)
      : 0;
    return Math.min(spawn.minAlive + extra, spawn.maxAlive);
  };

  /** 一定間隔で敵を補充する。数が下限を割ったら間隔を待ちません。 */
  BattleEngine.prototype._spawnTick = function (now) {
    var spawn = this.config.enemies.spawn;
    var target = this.targetAlive();
    var i;

    if (this.enemies.length < target) {
      for (i = this.enemies.length; i < target; i += 1) this.spawnEnemy(null, now);
      this._nextSpawnAt = now + spawn.intervalMs;
      return;
    }

    if (this._nextSpawnAt == null) this._nextSpawnAt = now + spawn.intervalMs;
    while (now >= this._nextSpawnAt) {
      for (i = 0; i < spawn.batch; i += 1) {
        if (this.enemies.length >= spawn.maxAlive) break;
        this.spawnEnemy(null, now);
      }
      this._nextSpawnAt += spawn.intervalMs;
    }
  };

  /** 壁で跳ね返す。フィールドの外へは出しません。 */
  BattleEngine.prototype._contain = function (entity) {
    var p = entity.position;
    var v = entity.velocity;
    var r = entity.radius;

    if (p.x < r) { p.x = r; v.x = Math.abs(v.x); }
    else if (p.x > this.field.width - r) { p.x = this.field.width - r; v.x = -Math.abs(v.x); }

    if (p.y < r) { p.y = r; v.y = Math.abs(v.y); }
    else if (p.y > this.field.height - r) { p.y = this.field.height - r; v.y = -Math.abs(v.y); }
  };

  /**
   * 敵の動き。
   *
   * 既定 (movement.mode = 'linear') は等速直線運動です。速さも向きも変えず、
   * 壁で反射するだけなので、どこへ向かっているのかが見て分かります。
   * 'wander' にすると、ふらふら向きを変えつつ視聴者円へ寄っていきます。
   */
  BattleEngine.prototype._moveEnemies = function (dt, now) {
    var movement = this.config.enemies.movement;
    var turn = movement.turnIntervalMs;
    var wander = movement.mode === 'wander';

    for (var i = 0; i < this.enemies.length; i += 1) {
      var enemy = this.enemies[i];

      if (!wander) {
        // 等速直線運動。壁で反射する以外、速度に触りません。
        enemy.position.x += enemy.velocity.x * dt;
        enemy.position.y += enemy.velocity.y * dt;
        this._contain(enemy);
        continue;
      }

      if (now >= enemy.turnAt) {
        var heading = this.random() * Math.PI * 2;
        enemy.velocity.x = Math.cos(heading) * enemy.speed;
        enemy.velocity.y = Math.sin(heading) * enemy.speed;
        enemy.turnAt = now + turn.min + this.random() * (turn.max - turn.min);
      }

      if (movement.chase > 0) {
        var target = this._nearestCircle(enemy);
        if (target) {
          var dx = target.position.x - enemy.position.x;
          var dy = target.position.y - enemy.position.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          enemy.velocity.x += (dx / dist * enemy.speed - enemy.velocity.x) * movement.chase * dt;
          enemy.velocity.y += (dy / dist * enemy.speed - enemy.velocity.y) * movement.chase * dt;
        }
      }

      enemy.position.x += enemy.velocity.x * dt;
      enemy.position.y += enemy.velocity.y * dt;
      this._contain(enemy);
    }
  };

  BattleEngine.prototype._nearestCircle = function (enemy) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < this.circles.length; i += 1) {
      var circle = this.circles[i];
      var dx = circle.position.x - enemy.position.x;
      var dy = circle.position.y - enemy.position.y;
      var dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = circle; }
    }
    return best;
  };

  /**
   * 視聴者円の動きと戦闘。
   *
   * 既定 (viewers.movement.mode = 'linear') は敵と同じ等速直線運動です。
   * 追いかけないぶん当たるかどうかは運になりますが、盤面が読めます。
   * 'seek' にすると最寄りの敵へまっすぐ向かいます。
   *
   * 1 回のループで「触れている敵を殴る」と「最寄りの敵を探す」を同時に済ませます。
   * 円 150 個 x 敵 36 体でも 1 万回未満の距離計算なので、毎フレームで足ります。
   */
  BattleEngine.prototype._moveCirclesAndFight = function (dt, now) {
    var seek = (this.config.viewers.movement || {}).mode === 'seek';

    var combat = (this.config.weapons && this.config.weapons.combat) || null;
    var weaponsOn = combat && combat.enabled && this.config.weapons.enabled;

    for (var i = 0; i < this.circles.length; i += 1) {
      var circle = this.circles[i];
      if (circle.dead) continue;

      // --- 大砲から飛んでいる間は戦いません。
      //     撃ち出した先が混んでいると、出た瞬間に殴り合いが始まって
      //     「飛び込んできた」ように見えないためです。時間が来たら
      //     速さを元に戻して、普通の円として振る舞い始めます。
      if (circle.launchUntil != null) {
        if (now < circle.launchUntil) {
          circle.position.x += circle.velocity.x * dt;
          circle.position.y += circle.velocity.y * dt;
          this._contain(circle);
          continue;
        }
        circle.launchUntil = null;
        this._restoreSpeed(circle);
        this.emit('circle:landed', { circle: circle, at: now });
      }

      var nearest = null;
      var nearestDist = Infinity;

      // --- 武器を回す。当たり判定も描画もこの角度 1 つを見ます
      var tier = weaponsOn ? this.weaponTier(circle.level) : null;
      var hit = tier && tier.hit;
      var ability = (tier && tier.ability) || null;
      if (tier) circle.weaponAngle += tier.spin * dt;

      // 武器が振れる状態か (間隔は特殊能力の rate で縮みます)
      var swingReady = false;
      var weaponReach = 0;
      var innerReach = 0;
      var swings = 0;
      var maxSwings = 0;
      if (hit) {
        var interval = combat.intervalMs * ((ability && ability.rate) || 1);
        swingReady = now - circle.lastWeaponAt >= interval;
        weaponReach = circle.radius * hit.reach;
        innerReach = circle.radius * combat.innerReach;
        maxSwings = (ability && ability.maxTargets) || 1;
      }

      // 衝撃波 (NOVA) の番か。射程内の敵を全部まとめて殴ります
      var nova = ability && ability.nova;
      var novaReady = nova && now - circle.lastNovaAt >= nova.intervalMs;
      var novaHits = 0;

      for (var j = 0; j < this.enemies.length; j += 1) {
        var enemy = this.enemies[j];
        if (enemy.dead) continue;

        var dx = enemy.position.x - circle.position.x;
        var dy = enemy.position.y - circle.position.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (seek && dist < nearestDist) { nearestDist = dist; nearest = enemy; }

        // --- 武器の間合い。角度を出すのは間合いに入っている敵だけです
        //     (全部の組み合わせで atan2 を呼ぶと、円 150 個で効いてきます)
        if (hit && dist <= weaponReach + enemy.radius && dist + enemy.radius >= innerReach) {
          if (novaReady) {
            this._damageEnemy(enemy, circle, circle.attack * nova.damage, now, 'nova');
            novaHits += 1;
            if (enemy.dead) continue;
          }
          if (swingReady && swings < maxSwings && this._weaponCovers(circle, hit, dx, dy, dist, enemy.radius)) {
            var dealt = circle.attack * combat.damage * hit.damage;
            this._damageEnemy(enemy, circle, dealt, now, 'weapon');
            swings += 1;
            // 鎌やコアは斬ったぶんだけ自分の HP が戻ります
            if (ability && ability.lifesteal) {
              circle.hp = Math.min(circle.maxHp, circle.hp + dealt * ability.lifesteal);
            }
            if (enemy.dead) continue;
          }
        }

        // 接触したら殴り合う。どちらも自分の間隔でしか殴れません。
        if (dist <= enemy.radius + circle.radius) {
          if (now - circle.lastAttackAt >= circle.attackIntervalMs) {
            circle.lastAttackAt = now;
            this._damageEnemy(enemy, circle, circle.attack, now);
          }
          if (now - enemy.lastAttackAt >= enemy.attackIntervalMs) {
            enemy.lastAttackAt = now;
            this._damageCircle(circle, enemy.attack);
          }
          // 敵にも跳ね返る。倒した相手からは跳ねません (もう居ないので)。
          // 既定では敵は押されません (collision.enemiesArePushed)。
          if (!enemy.dead && !circle.dead) {
            this._resolveContact(circle, enemy, dt, !this.config.collision.enemiesArePushed);
          }
          if (circle.dead) break;        // 力尽きた円はもう動かない
        }
      }

      if (swings > 0) circle.lastWeaponAt = now;
      if (novaReady) {
        circle.lastNovaAt = now;
        if (novaHits > 0) this.emit('weapon:nova', { circle: circle, hits: novaHits, at: now });
      }

      // 'seek' のときだけ最寄りの敵へ向き直す。
      // 'linear' では速度に触らないので、等速のまままっすぐ進みます。
      if (seek && nearest && !circle.dead) {
        var tx = nearest.position.x - circle.position.x;
        var ty = nearest.position.y - circle.position.y;
        var len = Math.sqrt(tx * tx + ty * ty) || 1;
        circle.velocity.x = tx / len * circle.speed;
        circle.velocity.y = ty / len * circle.speed;
      }

      circle.position.x += circle.velocity.x * dt;
      circle.position.y += circle.velocity.y * dt;
      this._contain(circle);
      if (this.items.length) this._collectItems(circle, now);
    }
  };

  /**
   * 武器の刃が、その敵の方向を通っているか。
   *
   * 腕は等間隔に並んでいるので、いちばん近い腕との角度差だけを見れば足ります
   * (腕が 6 本でも比較は 1 回)。敵の大きさぶんだけ当たり判定を広げます。
   */
  BattleEngine.prototype._weaponCovers = function (circle, hit, dx, dy, dist, enemyRadius) {
    var step = Math.PI * 2 / hit.arms;
    var toEnemy = Math.atan2(dy, dx);

    // いちばん近い腕までの角度差。offset は「絵で腕が生えている向き」で、
    // これを入れないと、見えている刃と当たる場所が食い違います。
    var offset = angleDelta(toEnemy, circle.weaponAngle + (hit.offset || 0));
    var nearest = Math.abs(offset - Math.round(offset / step) * step);

    // 近くにいる敵ほど角度の幅が要る (同じ大きさでも見込む角が大きくなるため)
    var margin = dist > 0 ? Math.atan2(enemyRadius, Math.max(dist, 1)) : Math.PI;
    return nearest <= hit.arc + margin;
  };

  /**
   * 敵にダメージを与え、貢献度を記録する。
   * HP が 0 になったら 'enemy:killed' を出します。
   *
   * @param {string} [source] 'body' | 'weapon' | 'nova' … 画面が見せ方を変えます
   */
  BattleEngine.prototype._damageEnemy = function (enemy, circle, amount, now, source) {
    var dealt = Math.min(amount, enemy.hp);
    if (dealt <= 0) return;

    enemy.hp -= dealt;
    circle.damage += dealt;
    this.stats.damage += dealt;

    var contribution = enemy.contributions[circle.ownerId];
    if (!contribution) {
      contribution = enemy.contributions[circle.ownerId] = {
        ownerId: circle.ownerId,
        ownerName: circle.ownerName,
        displayName: circle.displayName,
        profileImageUrl: circle.profileImageUrl,
        demo: circle.demo,
        damage: 0
      };
    } else {
      // 名前とアイコンは新しいほうへ寄せる (途中で変わることがあるため)
      contribution.ownerName = circle.ownerName;
      if (circle.profileImageUrl) contribution.profileImageUrl = circle.profileImageUrl;
    }
    contribution.damage += dealt;

    enemy.lastHitBy = contribution;

    this.emit('damage', {
      owner: contribution,
      amount: dealt,
      enemy: enemy,
      circle: circle,
      /** どこから当たったか。'body' は円そのもの、'weapon' は回っている武器。 */
      source: source || 'body',
      at: now
    });

    if (enemy.hp <= 0) this._killEnemy(enemy, circle, now);
  };

  BattleEngine.prototype._killEnemy = function (enemy, circle, now) {
    if (enemy.dead) return;
    enemy.dead = true;
    enemy.hp = 0;
    this.stats.defeated += 1;
    if (circle) circle.kills += 1;

    var contributions = Object.keys(enemy.contributions).map(function (id) {
      return enemy.contributions[id];
    });

    this.emit('enemy:killed', {
      enemy: enemy,
      typeId: enemy.typeId,
      points: enemy.points,
      /** とどめを刺した人。 */
      lastHit: enemy.lastHitBy,
      /** 参加した全員と、その与ダメージ。ポイントの分配はここから作れます。 */
      contributions: contributions,
      totalDamage: enemy.maxHp,
      at: now
    });
  };

  BattleEngine.prototype._damageCircle = function (circle, amount) {
    // AEGIS など、受けるダメージを減らす特殊能力
    var ability = this.abilityOf(circle);
    if (ability && ability.damageTaken != null) amount *= ability.damageTaken;

    circle.hp -= amount;
    if (circle.hp <= 0) {
      circle.hp = 0;
      circle.dead = true;      // 実際の除去は _cleanup で行う
    }
  };

  /**
   * 2 つの円をぶつける。
   *
   *   1. めり込んだぶんだけ押し離す (重なったまま止まらないように)
   *   2. ぶつかった向きへ跳ね返す (ビリヤードと同じ)
   *
   * 質量は半径から決めます (massFromRadius)。大きい円ほど押し勝つので、
   * ボスに小さい円が当たれば、跳ね返るのは小さいほうだけです。
   *
   * 跳ね返ったあとに速さを戻す (keepSpeed) のは、当たりどころによって
   * 円が止まってしまわないようにするためです。向きだけが変わり、
   * 速さは変わらないので、動きは等速のまま読めます。
   */
  BattleEngine.prototype._resolveContact = function (a, b, dt, bIsFixed) {
    var collision = this.config.collision;

    var dx = b.position.x - a.position.x;
    var dy = b.position.y - a.position.y;
    var min = a.radius + b.radius;
    var distSq = dx * dx + dy * dy;
    if (distSq >= min * min) return false;

    var dist = Math.sqrt(distSq);
    if (dist === 0) {
      // 完全に同じ位置。向きが決まらないので、そのときだけ乱数で決める。
      var heading = this.random() * Math.PI * 2;
      dx = Math.cos(heading);
      dy = Math.sin(heading);
      dist = 1;
    }

    var nx = dx / dist;
    var ny = dy / dist;

    var ma = collision.massFromRadius ? a.radius * a.radius : 1;
    var mb = collision.massFromRadius ? b.radius * b.radius : 1;
    // bIsFixed のときは b を「動かないもの」として扱う (壁と同じ)
    var invMa = 1 / ma;
    var invMb = bIsFixed ? 0 : 1 / mb;
    var shareA = bIsFixed ? 1 : mb / (ma + mb);
    var shareB = bIsFixed ? 0 : ma / (ma + mb);

    // --- 1. 押し離す
    //
    // 動く量は重さで分けます。大きい円はほとんど動かず、小さい円が出ていくので、
    // ボスの中に雑魚が埋まったままになりません。
    //
    // さらに、壁に押し付けられていて動けなかったぶんは相手側へ回します。
    // これをしないと、角で「押しても壁に戻される」状態になり、重なったまま
    // 止まってしまいます (角に敵が固まって見える原因)。
    var overlap = min - dist;
    var step = Math.min(overlap, Math.max(collision.separation * dt, overlap * collision.separationRatio));

    var shortfall = this._push(a, -nx, -ny, step * shareA);
    if (!bIsFixed) {
      shortfall = this._push(b, nx, ny, step * shareB + shortfall);
      if (shortfall > 0) this._push(a, -nx, -ny, shortfall);
    }

    if (!collision.bounce) return true;

    // --- 2. 跳ね返す
    var rvx = b.velocity.x - a.velocity.x;
    var rvy = b.velocity.y - a.velocity.y;
    var along = rvx * nx + rvy * ny;
    if (along > 0) return true;          // すでに離れつつある。二重に跳ねさせない。

    var impulse = -(1 + collision.restitution) * along / (invMa + invMb);

    a.velocity.x -= impulse * nx * invMa;
    a.velocity.y -= impulse * ny * invMa;
    if (!bIsFixed) {
      b.velocity.x += impulse * nx * invMb;
      b.velocity.y += impulse * ny * invMb;
    }

    if (collision.keepSpeed) {
      this._restoreSpeed(a);
      if (!bIsFixed) this._restoreSpeed(b);
    }
    return true;
  };

  /**
   * 円を (nx, ny) 方向へ distance だけ動かす。
   * 壁に阻まれて動けなかったぶんを返します (相手側へ回すため)。
   */
  BattleEngine.prototype._push = function (entity, nx, ny, distance) {
    if (!(distance > 0)) return 0;

    var beforeX = entity.position.x;
    var beforeY = entity.position.y;

    entity.position.x += nx * distance;
    entity.position.y += ny * distance;
    this._contain(entity);

    var moved = (entity.position.x - beforeX) * nx + (entity.position.y - beforeY) * ny;
    return Math.max(0, distance - moved);
  };

  /** 向きはそのままに、速さを元に戻す (止まった円を作らない)。 */
  BattleEngine.prototype._restoreSpeed = function (entity) {
    var v = entity.velocity;
    var length = Math.sqrt(v.x * v.x + v.y * v.y);
    if (length === 0) {
      var heading = this.random() * Math.PI * 2;
      v.x = Math.cos(heading) * entity.speed;
      v.y = Math.sin(heading) * entity.speed;
      return;
    }
    var scale = entity.speed / length;
    v.x *= scale;
    v.y *= scale;
  };

  /**
   * 同じ種類どうしの当たりを全部見る。
   *
   * 総当たりだと円の数の 2 乗になり、数百個で毎フレーム間に合わなくなります。
   * フィールドを格子に切り、隣の升だけを見ることで、円が増えても
   * 1 つあたりの計算量が増えないようにしています。
   */
  BattleEngine.prototype._collideAll = function (list, dt) {
    if (list.length < 2) return;

    var i;
    var maxRadius = 0;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].radius > maxRadius) maxRadius = list[i].radius;
    }

    var cell = Math.max(maxRadius * 2, 1);
    var columns = Math.max(1, Math.ceil(this.field.width / cell));

    // 升は毎フレーム作り直さず、中身だけ空にして使い回します。
    // 毎フレーム数百の配列を捨てると、その掃除でときどきフレームが伸びます。
    if (!this._buckets) { this._buckets = new Map(); this._bucketPool = []; }
    var buckets = this._buckets;
    var pool = this._bucketPool;
    buckets.forEach(function (bucket) { bucket.length = 0; pool.push(bucket); });
    buckets.clear();

    for (i = 0; i < list.length; i += 1) {
      var entity = list[i];
      // 大砲から飛んでいる円は当たり判定に入れません (突き抜けて飛び込みます)
      if (entity.launchUntil != null) continue;
      var cx = Math.floor(entity.position.x / cell);
      var cy = Math.floor(entity.position.y / cell);
      var key = cy * (columns + 2) + cx;
      var bucket = buckets.get(key);
      if (!bucket) {
        bucket = pool.pop() || [];
        buckets.set(key, bucket);
      }
      bucket.push(entity);
      entity._cx = cx;
      entity._cy = cy;
    }

    // 同じ升と「右 / 右下 / 下 / 左下」だけを見る。
    // 残り 4 方向は相手側から見るので、1 組を二度調べません。
    var NEIGHBORS = [[1, 0], [-1, 1], [0, 1], [1, 1]];

    for (i = 0; i < list.length; i += 1) {
      var a = list[i];
      // 升に入れなかったものは、ここでも飛ばします。入れ忘れたまま
      // 升を引くと undefined になって落ちます (飛んでいる円がまさにこれ)。
      if (a.launchUntil != null) continue;
      var own = buckets.get(a._cy * (columns + 2) + a._cx);
      if (!own) continue;

      var j;
      for (j = own.indexOf(a) + 1; j < own.length; j += 1) {
        this._resolveContact(a, own[j], dt);
      }

      for (var n = 0; n < NEIGHBORS.length; n += 1) {
        var near = buckets.get((a._cy + NEIGHBORS[n][1]) * (columns + 2) + (a._cx + NEIGHBORS[n][0]));
        if (!near) continue;
        for (j = 0; j < near.length; j += 1) this._resolveContact(a, near[j], dt);
      }
    }
  };

  /** 倒れた敵と力尽きた円を取り除く。 */
  BattleEngine.prototype._cleanup = function () {
    var i;
    for (i = this.enemies.length - 1; i >= 0; i -= 1) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }
    for (i = this.circles.length - 1; i >= 0; i -= 1) {
      if (this.circles[i].dead) {
        var circle = this.circles[i];
        this.circles.splice(i, 1);
        this.emit('circle:removed', { circle: circle, reason: 'defeated' });
      }
    }
  };

  // ------------------------------------------------------------- state

  BattleEngine.prototype.getState = function () {
    return {
      field: this.field,
      enemies: this.enemies,
      circles: this.circles,
      items: this.items,
      defeated: this.stats.defeated,
      enemiesAlive: this.enemies.length,
      circlesAlive: this.circles.length,
      stats: this.stats
    };
  };

  /** 全部やり直す (ランキングは別なので消えません)。 */
  BattleEngine.prototype.reset = function (at) {
    this.enemies = [];
    this.circles = [];
    this.items = [];
    this.field.width = this.config.field.width;
    this.field.height = this.config.field.width / this.fieldAspect;
    this.stage = 0;
    this._stageAt = null;
    this._stageReadyAt = 0;
    this.stats = { defeated: 0, spawned: 0, circlesSpawned: 0, damage: 0, itemsTaken: 0 };
    this._lastUpdate = null;
    this._nextSpawnAt = null;
    this._nextItemAt = null;
    this.start(at);
    return this;
  };

  global.CB = global.CB || {};
  global.CB.BattleEngine = BattleEngine;
  global.CB.weaponTierFor = weaponTierFor;
  global.CB.statsForLevel = statsForLevel;
  global.CB.levelsFromGift = levelsFromGift;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      BattleEngine: BattleEngine,
      statsForLevel: statsForLevel,
      levelsFromGift: levelsFromGift,
      weaponTierFor: weaponTierFor
    };
  }
})(typeof window !== 'undefined' ? window : this);
