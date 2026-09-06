/**
 * game.js - バトルエンジン。
 *
 *   自動生成される敵  VS  視聴者が生成した円
 *
 * このファイルは TikTok を知りません。知っているのは
 * 「円を出してくれ」「時間が進んだ」の 2 つだけです。
 *
 *   engine.spawnCircle({ ownerId, ownerName, strength, ... });
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
   * 強さ (strength) から円の各値を出す。
   *
   *   value = base * strength ^ exp
   *
   * LIKE も FOLLOW も GIFT も、違うのは strength の数字だけです。
   * 新しいイベントで円を出したくなったら strength を決めるだけで済みます。
   *
   * @param {number} strength
   * @param {object} viewers  CONFIG.viewers
   */
  function strengthToStats(strength, viewers) {
    var scaling = viewers.scaling;
    var s = Math.max(1, Math.min(Number(strength) || 1, scaling.maxStrength));
    var base = viewers.base;

    return {
      strength: s,
      hp: Math.round(base.hp * Math.pow(s, scaling.hpExp)),
      attack: Math.round(base.attack * Math.pow(s, scaling.attackExp)),
      radius: Math.min(base.radius * Math.pow(s, scaling.radiusExp), scaling.maxRadius),
      speed: Math.max(base.speed * Math.pow(s, scaling.speedExp), scaling.minSpeed),
      attackIntervalMs: base.attackIntervalMs
    };
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
    this.enemyTypes = this.config.enemies.types.slice();

    this.enemies = [];
    this.circles = [];

    this.stats = {
      defeated: 0,        // 倒した敵の総数 (画面の ENEMIES DEFEATED)
      spawned: 0,
      circlesSpawned: 0,
      damage: 0
    };

    this._seq = 0;
    this._lastUpdate = null;
    this._nextSpawnAt = null;
    this._listeners = {};
  }

  BattleEngine.strengthToStats = strengthToStats;

  // ------------------------------------------------------------- events

  BattleEngine.prototype.on = function (name, handler) {
    (this._listeners[name] || (this._listeners[name] = [])).push(handler);
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

  /** 端のほうに出す。画面の真ん中に突然現れるより自然に見えます。 */
  BattleEngine.prototype._edgePosition = function (radius) {
    var w = this.field.width;
    var h = this.field.height;
    var side = Math.floor(this.random() * 4);
    var t = this.random();

    if (side === 0) return { x: t * w, y: radius };
    if (side === 1) return { x: w - radius, y: t * h };
    if (side === 2) return { x: t * w, y: h - radius };
    return { x: radius, y: t * h };
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
    var pos = this._edgePosition(type.radius);
    var heading = this.random() * Math.PI * 2;

    var enemy = {
      id: this._id('enemy'),
      typeId: type.id,
      label: type.label || type.id,
      color: type.color,
      hp: type.hp,
      maxHp: type.hp,
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
   *   ownerId, ownerName, displayName, profileImageUrl, sourceEvent, strength, demo
   */
  BattleEngine.prototype.spawnCircle = function (spec, at) {
    var viewers = this.config.viewers;
    var limits = viewers.limits;
    var now = at != null ? at : this.now();

    var ownerId = String(spec.ownerId);

    // 1 人が持てる数の上限。超える場合はその人の一番古い円と入れ替えます。
    var mine = this.circles.filter(function (c) { return c.ownerId === ownerId; });
    if (mine.length >= limits.maxPerUser) this._removeCircle(mine[0], 'replaced');

    // フィールド全体の上限。古いものから消します。
    while (this.circles.length >= limits.maxCircles) {
      this._removeCircle(this.circles[0], 'evicted');
    }

    var stats = strengthToStats(spec.strength, viewers);
    var heading = this.random() * Math.PI * 2;

    var circle = {
      id: this._id('circle'),
      ownerId: ownerId,
      ownerName: spec.ownerName || ownerId,
      displayName: spec.displayName || spec.ownerName || ownerId,
      profileImageUrl: spec.profileImageUrl || null,
      /** 'LIKE' | 'FOLLOW' | 'SHARE' | 'GIFT' | ... どのイベントで生まれたか。 */
      sourceEvent: spec.sourceEvent || null,
      strength: stats.strength,
      hp: stats.hp,
      maxHp: stats.hp,
      attack: stats.attack,
      radius: stats.radius,
      speed: stats.speed,
      attackIntervalMs: stats.attackIntervalMs,
      position: {
        x: spec.x != null ? spec.x : stats.radius + this.random() * (this.field.width - stats.radius * 2),
        y: spec.y != null ? spec.y : stats.radius + this.random() * (this.field.height - stats.radius * 2)
      },
      velocity: { x: Math.cos(heading) * stats.speed, y: Math.sin(heading) * stats.speed },
      kills: 0,
      damage: 0,
      bornAt: now,
      lastAttackAt: 0,
      demo: Boolean(spec.demo),
      dead: false
    };

    this.circles.push(circle);
    this.stats.circlesSpawned += 1;
    this.emit('circle:spawn', circle);
    return circle;
  };

  /**
   * 条件に合う円をまとめて消す。
   * (デモ視聴者の円を、本物の視聴者が来た時点で引き上げるのに使います)
   */
  BattleEngine.prototype.removeCirclesWhere = function (predicate) {
    var doomed = this.circles.filter(predicate);
    for (var i = 0; i < doomed.length; i += 1) this._removeCircle(doomed[i], 'retired');
    return doomed.length;
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

    this._spawnTick(now);
    this._moveEnemies(dt, now);
    this._moveCirclesAndFight(dt, now);
    this._separate(this.enemies, this.config.enemies.movement.separation, dt);
    this._separate(this.circles, this.config.viewers.separation, dt);
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
   * ふらふらと向きを変えつつ、少しだけ最寄りの視聴者円へ寄っていきます
   * (movement.chase = 0 なら完全にランダム)。止まっている敵は作りません。
   */
  BattleEngine.prototype._moveEnemies = function (dt, now) {
    var movement = this.config.enemies.movement;
    var turn = movement.turnIntervalMs;

    for (var i = 0; i < this.enemies.length; i += 1) {
      var enemy = this.enemies[i];

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
   * 1 回のループで「最寄りの敵を探す」と「触れている敵を殴る」を同時に済ませます。
   * 円 260 個 x 敵 36 体でも 1 万回程度の距離計算なので、毎フレームで足ります。
   */
  BattleEngine.prototype._moveCirclesAndFight = function (dt, now) {
    for (var i = 0; i < this.circles.length; i += 1) {
      var circle = this.circles[i];
      if (circle.dead) continue;

      var nearest = null;
      var nearestDist = Infinity;

      for (var j = 0; j < this.enemies.length; j += 1) {
        var enemy = this.enemies[j];
        if (enemy.dead) continue;

        var dx = enemy.position.x - circle.position.x;
        var dy = enemy.position.y - circle.position.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < nearestDist) { nearestDist = dist; nearest = enemy; }

        // 接触したら殴り合う。どちらも自分の間隔でしか殴れません。
        if (dist <= enemy.radius + circle.radius) {
          if (now - circle.lastAttackAt >= circle.attackIntervalMs) {
            circle.lastAttackAt = now;
            this._damageEnemy(enemy, circle, circle.attack, now);
          }
          if (now - enemy.lastAttackAt >= enemy.attackIntervalMs) {
            enemy.lastAttackAt = now;
            this._damageCircle(circle, enemy.attack);
            if (circle.dead) break;      // 力尽きた円はもう動かない
          }
        }
      }

      // 最寄りの敵へ向かう。敵がいなければ、そのまま進んで壁で跳ね返ります。
      if (nearest && !circle.dead) {
        var tx = nearest.position.x - circle.position.x;
        var ty = nearest.position.y - circle.position.y;
        var len = Math.sqrt(tx * tx + ty * ty) || 1;
        circle.velocity.x = tx / len * circle.speed;
        circle.velocity.y = ty / len * circle.speed;
      }

      circle.position.x += circle.velocity.x * dt;
      circle.position.y += circle.velocity.y * dt;
      this._contain(circle);
    }
  };

  /**
   * 敵にダメージを与え、貢献度を記録する。
   * HP が 0 になったら 'enemy:killed' を出します。
   */
  BattleEngine.prototype._damageEnemy = function (enemy, circle, amount, now) {
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
    circle.hp -= amount;
    if (circle.hp <= 0) {
      circle.hp = 0;
      circle.dead = true;      // 実際の除去は _cleanup で行う
    }
  };

  /**
   * 重なったままの停止を防ぐ。
   *
   * 重なっている 2 つを、めり込んだぶんだけ押し返します。完全に同じ座標に
   * いる場合は距離が 0 になって向きが決まらないので、そのときだけ乱数でずらします。
   */
  BattleEngine.prototype._separate = function (list, strength, dt) {
    for (var i = 0; i < list.length; i += 1) {
      var a = list[i];
      for (var j = i + 1; j < list.length; j += 1) {
        var b = list[j];
        var dx = b.position.x - a.position.x;
        var dy = b.position.y - a.position.y;
        var min = a.radius + b.radius;

        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;   // 粗い判定で先に落とす

        var distSq = dx * dx + dy * dy;
        if (distSq >= min * min) continue;

        var dist = Math.sqrt(distSq);
        if (dist === 0) {
          var heading = this.random() * Math.PI * 2;
          dx = Math.cos(heading);
          dy = Math.sin(heading);
          dist = 1;
        }

        var overlap = (min - dist) / 2;
        var push = Math.min(overlap, strength * dt);
        var nx = dx / dist;
        var ny = dy / dist;

        a.position.x -= nx * push;
        a.position.y -= ny * push;
        b.position.x += nx * push;
        b.position.y += ny * push;

        this._contain(a);
        this._contain(b);
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
    this.stats = { defeated: 0, spawned: 0, circlesSpawned: 0, damage: 0 };
    this._lastUpdate = null;
    this._nextSpawnAt = null;
    this.start(at);
    return this;
  };

  global.CB = global.CB || {};
  global.CB.BattleEngine = BattleEngine;
  global.CB.strengthToStats = strengthToStats;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BattleEngine: BattleEngine, strengthToStats: strengthToStats };
  }
})(typeof window !== 'undefined' ? window : this);
