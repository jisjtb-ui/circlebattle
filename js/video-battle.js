/**
 * video-battle.js - VIDEO BATTLE MODE のルール。RED 対 BLUE の 1 対 1。
 *
 * **LIVE 版 (js/game.js) には触りません。** あちらは「視聴者の円が湧いてくる敵を
 * 倒す」ゲームで、円は増えたり消えたりします。こちらは動画用に、最初から最後まで
 * 2 つの円しか居ません。だから HP を持てて、HP バーが成立します。
 *
 * 一番大事な決めごとは、**イベントの順番**です:
 *
 *   攻撃を始めた   → 'shot'    (射出音)
 *   実際に当たった → 'hit'     (ヒット音 + HP 減少 + 演出)
 *   当たらなかった → 'miss'    (音は鳴りません)
 *
 * 「攻撃したから音が鳴る」ではありません。射出音と命中音は別のイベントで、
 * HP が減るのは 'hit' のときだけです。だから視聴者は、音を聞くだけで
 * 「当たったのか / 避けたのか」が分かります。
 *
 * 時計も乱数も外から渡せます (テストが実時間にも運にも左右されないため)。
 */
(function (global) {
  'use strict';

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  /** a から b への角度差を -π〜π に畳む。 */
  function angleDelta(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * @param {object} [options] { config, now, random }
   */
  function VideoBattle(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.VIDEO_CONFIG);
    if (!this.config) throw new Error('VideoBattle: config が渡されていません');

    this.now = options.now || function () { return Date.now(); };
    this.random = options.random || Math.random;

    this.field = { width: this.config.field.width, height: this.config.field.height };
    this.fighters = {};
    this.projectiles = [];
    this.items = [];

    /** 'idle' | 'live' | 'over' */
    this.phase = 'idle';
    this.winner = null;
    this.startedAt = null;
    this.endedAt = null;

    /** ヒットストップ。ここを過ぎるまで盤面は止まります。 */
    this.hitstopUntil = 0;
    /** 「あと一撃」の合図を出したか (1 戦に 1 回だけ)。 */
    this.hushed = false;

    this._seq = 0;
    this._lastUpdate = null;
    /** 次に落とす武器の順番 (下の _nextWeapon 参照)。 */
    this._bag = [];
    /** 直前に跳ねた時刻。重なっている間ずっと鳴らさないための目安です。 */
    this._lastBounceAt = -1e9;
    this._nextItemAt = null;
    this._listeners = {};

    this._build();
  }

  // ------------------------------------------------------------ 通知

  VideoBattle.prototype.on = function (name, handler) {
    (this._listeners[name] = this._listeners[name] || []).push(handler);
    return this;
  };

  VideoBattle.prototype.off = function (name, handler) {
    var list = this._listeners[name];
    if (!list) return this;
    var index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
    return this;
  };

  VideoBattle.prototype.emit = function (name, payload) {
    var list = this._listeners[name];
    if (!list || !list.length) return payload;
    list.slice().forEach(function (handler) { handler(payload); });
    return payload;
  };

  // ---------------------------------------------------------- 組み立て

  VideoBattle.prototype._id = function (prefix) {
    this._seq += 1;
    return prefix + '-' + this._seq;
  };

  VideoBattle.prototype.weapon = function (id) {
    return this.config.weapons[id] || this.config.weapons[this.config.weapons.order[0]];
  };

  VideoBattle.prototype._build = function () {
    var conf = this.config.fighters;
    var field = this.field;
    var top = this.config.field.topMargin;
    var bottom = field.height - this.config.field.bottomMargin;

    this.fighters.red = this._makeFighter(conf.red, field.width * 0.32, top + (bottom - top) * 0.22);
    this.fighters.blue = this._makeFighter(conf.blue, field.width * 0.68, top + (bottom - top) * 0.78);
  };

  VideoBattle.prototype._makeFighter = function (spec, x, y) {
    var conf = this.config.fighters;
    var angle = this.random() * Math.PI * 2;

    return {
      id: spec.id,
      name: spec.name,
      color: spec.color,
      glow: spec.glow,
      bar: spec.bar,

      position: { x: x, y: y },
      velocity: { x: Math.cos(angle) * conf.speed, y: Math.sin(angle) * conf.speed },
      radius: conf.radius,

      maxHp: conf.maxHp,
      hp: conf.maxHp,

      weapon: this.weapon(spec.startWeapon),
      weaponAngle: this.random() * Math.PI * 2,
      /** 次に攻撃できる時刻。 */
      nextAttackAt: 0,
      /** 'idle' | 'windup' | 'charge' | 'beam' */
      action: 'idle',
      actionUntil: 0,
      /** 振りかぶった向き。当たり判定はこの向きから arc の中だけです。 */
      swingAngle: 0,
      /** LASER の照射方向。 */
      beamAngle: 0,
      beamTickAt: 0,

      /** 被弾の光り (0〜1)。演出用で、ルールには影響しません。 */
      flash: 0,
      flashBig: false,
      /** INJECTION NEEDLE の毒。 */
      poison: null,
      /** 'ok' | 'warn' | 'danger' | 'critical' */
      level: 'ok',

      damageDealt: 0,
      damageTaken: 0,
      hits: 0
    };
  };

  VideoBattle.prototype.opponentOf = function (fighter) {
    return fighter.id === 'red' ? this.fighters.blue : this.fighters.red;
  };

  /** 上下の余白を除いた、実際に動ける範囲。 */
  VideoBattle.prototype.bounds = function () {
    return {
      left: 0,
      right: this.field.width,
      top: this.config.field.topMargin,
      bottom: this.field.height - this.config.field.bottomMargin
    };
  };

  /** 画面の比に合わせて盤面を伸縮する (9:16 からずれた画面でも隙間を作らない)。 */
  VideoBattle.prototype.setFieldAspect = function (aspect) {
    if (!aspect || !isFinite(aspect)) return this;
    var height = this.field.height;
    var width = Math.round(height * aspect);
    if (width === this.field.width) return this;

    var k = width / this.field.width;
    this.field.width = width;
    ['red', 'blue'].forEach(function (id) {
      this.fighters[id].position.x *= k;
    }, this);
    this.items.forEach(function (item) { item.x *= k; });
    this.projectiles.forEach(function (p) { p.x *= k; });
    return this;
  };

  // ------------------------------------------------------------ 進行

  VideoBattle.prototype.start = function (at) {
    var now = at != null ? at : this.now();
    this.phase = 'live';
    this.startedAt = now;
    this.endedAt = null;
    this.winner = null;
    this._lastUpdate = now;
    this._nextItemAt = now + this.config.items.firstDelayMs;
    this.emit('start', { at: now });
    return this;
  };

  VideoBattle.prototype.reset = function (at) {
    var now = at != null ? at : this.now();
    this.projectiles = [];
    this.items = [];
    this.hitstopUntil = 0;
    this.hushed = false;
    this._seq = 0;
    this._bag = [];
    this._build();
    this.emit('reset', { at: now });
    return this.start(now);
  };

  /**
   * 戦況の進み具合 (0〜1)。
   *
   * 減った HP と経過時間の大きいほうを使います。音の厚み (video-audio) と
   * ダメージの伸び (escalation) がこれで決まるので、動画は後半ほど激しくなります。
   */
  VideoBattle.prototype.intensity = function (at) {
    var conf = this.config.fighters;
    var lost = (conf.maxHp * 2 - this.fighters.red.hp - this.fighters.blue.hp) / (conf.maxHp * 2);
    if (this.startedAt == null) return clamp(lost, 0, 1);

    var esc = this.config.escalation;
    var now = at != null ? at : this.now();
    var elapsed = clamp((now - this.startedAt - esc.fromMs) / (esc.toMs - esc.fromMs), 0, 1);
    return clamp(Math.max(lost, elapsed * 0.85), 0, 1);
  };

  /** 時間が経つほど 1 発が重くなる倍率。決着しないまま続くのも防ぎます。 */
  VideoBattle.prototype.damageMultiplier = function (at) {
    var esc = this.config.escalation;
    if (this.startedAt == null) return 1;
    var now = at != null ? at : this.now();
    var t = clamp((now - this.startedAt - esc.fromMs) / (esc.toMs - esc.fromMs), 0, 1);
    return 1 + (esc.maxMultiplier - 1) * t;
  };

  VideoBattle.prototype.update = function (at) {
    var now = at != null ? at : this.now();
    if (this._lastUpdate == null) { this.start(now); return this; }

    var dt = Math.min(now - this._lastUpdate, this.config.loop.maxDeltaMs) / 1000;
    this._lastUpdate = now;
    if (dt <= 0) return this;

    this._decayFlash(dt);

    /*
     * ヒットストップ。当たった瞬間だけ盤面を止めます。止まっている間も
     * 光や画面振動は進むので、「重い一撃が入った」ことが伝わります。
     */
    if (now < this.hitstopUntil) { this.emit('tick', { at: now, dt: 0, frozen: true }); return this; }

    if (this.phase === 'live') {
      this._itemsTick(now);
      this._move(this.fighters.red, dt, now);
      this._move(this.fighters.blue, dt, now);
      this._separate(now);
      this._attack(this.fighters.red, now);
      this._attack(this.fighters.blue, now);
      this._beams(now, dt);
      this._poison(now);
    }

    this._projectilesTick(dt, now);
    this.emit('tick', { at: now, dt: dt });
    return this;
  };

  VideoBattle.prototype._decayFlash = function (dt) {
    var conf = this.config.effects;
    ['red', 'blue'].forEach(function (id) {
      var f = this.fighters[id];
      if (f.flash <= 0) return;
      var life = (f.flashBig ? conf.bigFlashMs : conf.flashMs) / 1000;
      f.flash = Math.max(0, f.flash - dt / life);
      if (f.flash === 0) f.flashBig = false;
    }, this);
  };

  // ------------------------------------------------------------ 移動

  /**
   * 動き方。
   *
   * まっすぐ跳ね回りつつ、相手のほうへ少しだけ寄ります。まっすぐだけだと
   * すれ違うばかりで当たらず、まっすぐ追いかけると重なったまま離れません。
   */
  VideoBattle.prototype._move = function (fighter, dt, now) {
    var conf = this.config.fighters;
    var enemy = this.opponentOf(fighter);
    var v = fighter.velocity;

    var speed = Math.sqrt(v.x * v.x + v.y * v.y) || conf.speed;
    var heading = Math.atan2(v.y, v.x);

    /*
     * 向かう先は「近くに武器が落ちていればその武器、無ければ相手」です。
     *
     * 相手だけを追わせると、落ちた武器は当たった拍子に拾えたときだけになり、
     * 動画の見どころである**武器の持ち替え**がほとんど起きません。
     */
    var goal = this._goalFor(fighter);
    var toGoal = Math.atan2(goal.y - fighter.position.y, goal.x - fighter.position.x);
    var turn = angleDelta(heading, toGoal) * goal.pull * dt;
    turn += (this.random() - 0.5) * conf.wander * dt * 6;
    heading += turn;

    // ノックバックで速くなったぶんは、基本の速さへ戻していきます
    speed += (conf.speed - speed) * Math.min(1, conf.knockbackDamping * dt);

    v.x = Math.cos(heading) * speed;
    v.y = Math.sin(heading) * speed;

    fighter.position.x += v.x * dt;
    fighter.position.y += v.y * dt;

    // 武器は常に回っています。回り方は武器ごとに違います
    fighter.weaponAngle += (fighter.weapon.spin || 0) * dt;

    this._contain(fighter, now);
  };

  /**
   * 今フレーム向かう先。
   *
   * 近くに武器が落ちていればそれを拾いに行き、無ければ相手を追います。
   * 拾いに行くほうを少し強く引くのは、途中で相手に気を取られて
   * ずっと拾えない、を避けるためです。
   */
  VideoBattle.prototype._goalFor = function (fighter) {
    var conf = this.config.fighters;
    var enemy = this.opponentOf(fighter);
    var reach = this.config.items.attractRadius;
    var best = null;
    var bestDist = reach * reach;

    for (var i = 0; i < this.items.length; i += 1) {
      var item = this.items[i];
      // 今と同じ武器のためにわざわざ動く理由はありません
      if (item.weapon.id === fighter.weapon.id) continue;
      var dx = item.x - fighter.position.x;
      var dy = item.y - fighter.position.y;
      var dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = item; }
    }

    if (best) return { x: best.x, y: best.y, pull: conf.itemChase };
    return { x: enemy.position.x, y: enemy.position.y, pull: conf.chase };
  };

  /** 壁で跳ね返す。跳ねた瞬間だけ小さな音を鳴らします。 */
  VideoBattle.prototype._contain = function (fighter, now) {
    var b = this.bounds();
    var p = fighter.position;
    var v = fighter.velocity;
    var r = fighter.radius;
    var bounced = false;

    if (p.x < b.left + r) { p.x = b.left + r; v.x = Math.abs(v.x); bounced = true; }
    else if (p.x > b.right - r) { p.x = b.right - r; v.x = -Math.abs(v.x); bounced = true; }

    if (p.y < b.top + r) { p.y = b.top + r; v.y = Math.abs(v.y); bounced = true; }
    else if (p.y > b.bottom - r) { p.y = b.bottom - r; v.y = -Math.abs(v.y); bounced = true; }

    if (bounced) this._bounced(fighter, now, p.x, p.y);
  };

  /** 円どうしがぶつかったら押し戻す。 */
  VideoBattle.prototype._separate = function (now) {
    var a = this.fighters.red;
    var b = this.fighters.blue;
    var dx = b.position.x - a.position.x;
    var dy = b.position.y - a.position.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    var overlap = a.radius + b.radius - dist;
    if (overlap <= 0) return;

    var nx = dx / dist;
    var ny = dy / dist;
    var push = overlap / 2 + 0.5;

    a.position.x -= nx * push; a.position.y -= ny * push;
    b.position.x += nx * push; b.position.y += ny * push;

    var bounce = this.config.fighters.bounce;
    a.velocity.x -= nx * bounce * 60; a.velocity.y -= ny * bounce * 60;
    b.velocity.x += nx * bounce * 60; b.velocity.y += ny * bounce * 60;

    this._bounced(a, now, a.position.x + nx * a.radius, a.position.y + ny * a.radius);
  };

  /**
   * 跳ねた合図。重なっている間は毎フレーム呼ばれるので、ここで間引きます
   * (音の側でも間引きますが、イベントの数そのものを抑えておきます)。
   */
  VideoBattle.prototype._bounced = function (fighter, now, x, y) {
    if (now - this._lastBounceAt < 110) return;
    this._lastBounceAt = now;
    this.emit('bounce', { fighter: fighter, at: now, x: x, y: y });
  };

  // ------------------------------------------------------------ 攻撃

  VideoBattle.prototype._distanceBetween = function (a, b) {
    var dx = b.position.x - a.position.x;
    var dy = b.position.y - a.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  /**
   * 攻撃の入り口。
   *
   * ここで鳴るのは**射出音だけ**です。当たったかどうかは、振り下ろした瞬間
   * (melee) / 弾が届いた瞬間 (gun) / 照射が重なった瞬間 (beam) に判定します。
   */
  VideoBattle.prototype._attack = function (fighter, now) {
    var enemy = this.opponentOf(fighter);
    var weapon = fighter.weapon;

    // 振りかぶりの途中なら、当たる瞬間を待ちます
    if (fighter.action === 'windup') {
      if (now >= fighter.actionUntil) this._swing(fighter, enemy, now);
      return;
    }
    if (fighter.action === 'charge' || fighter.action === 'beam') return;
    if (now < fighter.nextAttackAt) return;

    var gap = this._distanceBetween(fighter, enemy) - fighter.radius - enemy.radius;

    if (weapon.kind === 'melee') {
      if (gap > weapon.reach) return;
      fighter.action = 'windup';
      fighter.actionUntil = now + weapon.windupMs;
      fighter.swingAngle = Math.atan2(enemy.position.y - fighter.position.y,
                                      enemy.position.x - fighter.position.x);
      this.emit('shot', { fighter: fighter, weapon: weapon, at: now, angle: fighter.swingAngle });
      return;
    }

    if (weapon.kind === 'gun') {
      this._fire(fighter, enemy, now);
      fighter.nextAttackAt = now + weapon.cooldownMs;
      return;
    }

    if (weapon.kind === 'beam') {
      fighter.action = 'charge';
      fighter.actionUntil = now + weapon.chargeMs;
      fighter.beamAngle = Math.atan2(enemy.position.y - fighter.position.y,
                                     enemy.position.x - fighter.position.x);
      this.emit('shot', { fighter: fighter, weapon: weapon, at: now, angle: fighter.beamAngle });
    }
  };

  /**
   * 近接武器を振り下ろす。
   *
   * 振りかぶっている間に相手が離れれば**外れます**。「ギリギリ外れる」が
   * 起きるのはここです。外れたときは音を鳴らしません。
   */
  VideoBattle.prototype._swing = function (fighter, enemy, now) {
    var weapon = fighter.weapon;
    fighter.action = 'idle';
    fighter.nextAttackAt = now + weapon.cooldownMs;

    var dx = enemy.position.x - fighter.position.x;
    var dy = enemy.position.y - fighter.position.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var gap = dist - fighter.radius - enemy.radius;
    var angle = Math.atan2(dy, dx);
    var off = Math.abs(angleDelta(fighter.swingAngle, angle));

    if (gap > weapon.reach || off > weapon.arc / 2) {
      this.emit('miss', { fighter: fighter, weapon: weapon, at: now, angle: fighter.swingAngle });
      return;
    }

    var contact = {
      x: fighter.position.x + Math.cos(angle) * (fighter.radius + gap / 2),
      y: fighter.position.y + Math.sin(angle) * (fighter.radius + gap / 2)
    };
    this._damage(fighter, enemy, weapon.damage, weapon, now, { angle: angle, x: contact.x, y: contact.y });

    // INJECTION NEEDLE だけは、刺さったあとも効き続けます
    if (weapon.poison && enemy.hp > 0) {
      enemy.poison = {
        until: now + weapon.poison.durationMs,
        nextAt: now + weapon.poison.tickMs,
        tickMs: weapon.poison.tickMs,
        dps: weapon.poison.dps,
        from: fighter.id
      };
      this.emit('poison', { fighter: fighter, target: enemy, weapon: weapon, at: now });
    }
  };

  /** 弾を撃つ。SHOTGUN は 1 回の射出で複数の粒が出ます。 */
  VideoBattle.prototype._fire = function (fighter, enemy, now) {
    var weapon = fighter.weapon;
    var base = Math.atan2(enemy.position.y - fighter.position.y,
                          enemy.position.x - fighter.position.x);
    var pellets = weapon.pellets || 1;

    for (var i = 0; i < pellets; i += 1) {
      // 粒は扇状に散らします。真ん中に寄せると 1 発の弾と見分けがつきません
      var spread = pellets > 1
        ? (i / (pellets - 1) - 0.5) * weapon.spread + (this.random() - 0.5) * weapon.spread * 0.3
        : (this.random() - 0.5) * weapon.spread;
      var angle = base + spread;

      this.projectiles.push({
        id: this._id('shot'),
        owner: fighter.id,
        weapon: weapon,
        color: weapon.color,
        x: fighter.position.x + Math.cos(angle) * (fighter.radius + 6),
        y: fighter.position.y + Math.sin(angle) * (fighter.radius + 6),
        vx: Math.cos(angle) * weapon.bulletSpeed,
        vy: Math.sin(angle) * weapon.bulletSpeed,
        radius: weapon.bulletRadius,
        angle: angle,
        travelled: 0,
        bornAt: now
      });
    }

    fighter.weaponAngle = base;
    this.emit('shot', { fighter: fighter, weapon: weapon, at: now, angle: base, pellets: pellets });
  };

  /** 弾を進めて、当たったら消す。 */
  VideoBattle.prototype._projectilesTick = function (dt, now) {
    var b = this.bounds();
    var kept = [];

    for (var i = 0; i < this.projectiles.length; i += 1) {
      var p = this.projectiles[i];
      var step = Math.sqrt(p.vx * p.vx + p.vy * p.vy) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.travelled += step;

      if (p.x < b.left || p.x > b.right || p.y < b.top || p.y > b.bottom) continue;

      var target = p.owner === 'red' ? this.fighters.blue : this.fighters.red;
      var source = this.fighters[p.owner];
      var dx = target.position.x - p.x;
      var dy = target.position.y - p.y;

      if (dx * dx + dy * dy <= (target.radius + p.radius) * (target.radius + p.radius)) {
        var amount = p.weapon.damage;
        // 散弾は飛ぶほど弱くなります。近づくほど強い、が見て分かるように
        if (p.weapon.falloffFrom) {
          var t = clamp((p.travelled - p.weapon.falloffFrom) /
                        (p.weapon.falloffTo - p.weapon.falloffFrom), 0, 1);
          amount *= 1 - t * 0.55;
        }
        if (target.hp > 0) {
          this._damage(source, target, amount, p.weapon, now, { angle: p.angle, x: p.x, y: p.y });
        }
        continue;
      }

      kept.push(p);
    }

    this.projectiles = kept;
  };

  /**
   * LASER の照射。
   *
   * 毎フレーム音を鳴らすと耳が痛くなるので、ダメージも音も tickMs ごとです。
   * 照射中は loop の音が鳴り続けます (start / loop / end で 3 つの音)。
   */
  VideoBattle.prototype._beams = function (now, dt) {
    ['red', 'blue'].forEach(function (id) {
      var fighter = this.fighters[id];
      if (fighter.action !== 'charge' && fighter.action !== 'beam') return;

      var enemy = this.opponentOf(fighter);
      var weapon = fighter.weapon;
      var target = Math.atan2(enemy.position.y - fighter.position.y,
                              enemy.position.x - fighter.position.x);

      // 追いきれない速さで回すと当たらないので、少しだけ遅れて追います
      fighter.beamAngle += clamp(angleDelta(fighter.beamAngle, target), -2.6 * dt, 2.6 * dt);

      if (fighter.action === 'charge') {
        if (now < fighter.actionUntil) return;
        fighter.action = 'beam';
        fighter.actionUntil = now + weapon.beamMs;
        fighter.beamTickAt = now;
        this.emit('beam:start', { fighter: fighter, weapon: weapon, at: now });
        return;
      }

      if (now >= fighter.actionUntil) {
        fighter.action = 'idle';
        fighter.nextAttackAt = now + weapon.cooldownMs;
        this.emit('beam:end', { fighter: fighter, weapon: weapon, at: now });
        return;
      }

      if (now < fighter.beamTickAt) return;
      fighter.beamTickAt = now + weapon.tickMs;

      if (this._beamHits(fighter, enemy, weapon)) {
        this._damage(fighter, enemy, weapon.damage, weapon, now, {
          angle: fighter.beamAngle,
          x: enemy.position.x - Math.cos(fighter.beamAngle) * enemy.radius,
          y: enemy.position.y - Math.sin(fighter.beamAngle) * enemy.radius,
          continuous: true
        });
      }
    }, this);
  };

  /** ビームの線に相手が重なっているか。 */
  VideoBattle.prototype._beamHits = function (fighter, enemy, weapon) {
    var dx = enemy.position.x - fighter.position.x;
    var dy = enemy.position.y - fighter.position.y;
    var along = dx * Math.cos(fighter.beamAngle) + dy * Math.sin(fighter.beamAngle);
    if (along <= 0) return false;                    // 後ろには当たりません

    var perp = Math.abs(-dx * Math.sin(fighter.beamAngle) + dy * Math.cos(fighter.beamAngle));
    return perp <= enemy.radius + weapon.width / 2;
  };

  /** 毒 (INJECTION NEEDLE)。刺さっている間、一定間隔で削り続けます。 */
  VideoBattle.prototype._poison = function (now) {
    ['red', 'blue'].forEach(function (id) {
      var fighter = this.fighters[id];
      var poison = fighter.poison;
      if (!poison) return;

      if (now >= poison.until) { fighter.poison = null; return; }
      if (now < poison.nextAt) return;

      poison.nextAt = now + poison.tickMs;
      var source = this.fighters[poison.from];
      this._damage(source, fighter, poison.dps * poison.tickMs / 1000,
        this.config.weapons.needle, now, {
          angle: this.random() * Math.PI * 2,
          x: fighter.position.x,
          y: fighter.position.y,
          silent: true,          // 毒は毎回ヒット音を鳴らしません (うるさくなるため)
          poison: true
        });
    }, this);
  };

  // ---------------------------------------------------------- ダメージ

  /**
   * ここが**唯一 HP を減らす場所**です。
   *
   *   ダメージ計算 → HP 減少 → 'hit' → (画面側で) HP バー / エフェクト / 音
   *
   * という順番を 1 本に保つために、武器も毒も弾も、必ずここを通します。
   */
  VideoBattle.prototype._damage = function (source, target, amount, weapon, now, opts) {
    opts = opts || {};
    if (this.phase !== 'live' || target.hp <= 0) return null;

    var conf = this.config.effects;
    var dealt = Math.max(1, Math.round(amount * this.damageMultiplier(now)));
    var before = target.hp;
    target.hp = Math.max(0, target.hp - dealt);
    dealt = before - target.hp;

    var big = dealt >= target.maxHp * this.config.hp.bigDamageRatio;
    var lethal = target.hp <= 0;

    target.damageTaken += dealt;
    source.damageDealt += dealt;
    source.hits += 1;

    // 円を光らせる / 押し飛ばす
    target.flash = 1;
    target.flashBig = target.flashBig || big;
    var angle = opts.angle != null ? opts.angle : 0;
    var knock = (weapon.knockback || 0) * (big ? 1.35 : 1);
    target.velocity.x += Math.cos(angle) * knock;
    target.velocity.y += Math.sin(angle) * knock;

    // 止める時間。大ダメージほど長く、決着だけは特別に長く
    var stop = lethal ? conf.koHitstopMs : (big ? conf.bigHitstopMs : conf.hitstopMs);
    this.hitstopUntil = Math.max(this.hitstopUntil, now + stop);

    var hit = {
      source: source,
      target: target,
      weapon: weapon,
      amount: dealt,
      ratio: dealt / target.maxHp,
      big: big,
      lethal: lethal,
      poison: Boolean(opts.poison),
      continuous: Boolean(opts.continuous),
      silent: Boolean(opts.silent),
      angle: angle,
      x: opts.x != null ? opts.x : target.position.x,
      y: opts.y != null ? opts.y : target.position.y,
      shake: lethal ? conf.koShake : (big ? conf.bigShake : conf.shake),
      shakeMs: big || lethal ? conf.bigShakeMs : conf.shakeMs,
      at: now
    };

    this.emit('hit', hit);
    this._levelTick(target, now);
    if (lethal) this._finish(source, target, now);
    return hit;
  };

  /**
   * HP の危険域。
   *
   *   30% 以下 … 強調
   *   15% 以下 … 危険
   *    5% 以下 … あと一撃
   *
   * 5% を初めて割ったところで 1 回だけ「短い無音」を挟みます。次の一撃が
   * 実際の音量以上に大きく聞こえるようにするためです。
   */
  VideoBattle.prototype._levelTick = function (fighter, now) {
    var hp = this.config.hp;
    var ratio = fighter.hp / fighter.maxHp;
    var level = 'ok';
    if (ratio <= hp.criticalRatio) level = 'critical';
    else if (ratio <= hp.dangerRatio) level = 'danger';
    else if (ratio <= hp.warnRatio) level = 'warn';

    if (level === fighter.level) return;
    var from = fighter.level;
    fighter.level = level;
    this.emit('level', { fighter: fighter, level: level, from: from, ratio: ratio, at: now });

    if (level === 'critical' && !this.hushed && fighter.hp > 0) {
      this.hushed = true;
      this.emit('hush', { fighter: fighter, at: now });
    }
  };

  /** 決着。勝者と敗者を同時に知らせます (表示と音をそろえるため)。 */
  VideoBattle.prototype._finish = function (winner, loser, now) {
    this.phase = 'over';
    this.winner = winner;
    this.endedAt = now;
    loser.poison = null;

    ['red', 'blue'].forEach(function (id) {
      var f = this.fighters[id];
      if (f.action === 'beam' || f.action === 'charge') {
        f.action = 'idle';
        this.emit('beam:end', { fighter: f, weapon: f.weapon, at: now, aborted: true });
      }
    }, this);

    this.emit('ko', { winner: winner, loser: loser, at: now });
  };

  // ---------------------------------------------------------- アイテム

  VideoBattle.prototype._itemsTick = function (now) {
    if (this._nextItemAt == null) this._nextItemAt = now + this.config.items.intervalMs;

    var conf = this.config.items;
    if (now >= this._nextItemAt) {
      this._nextItemAt = now + conf.intervalMs;
      if (this.items.length < conf.maxAlive) this.spawnItem(null, now);
    }

    var kept = [];
    for (var i = 0; i < this.items.length; i += 1) {
      var item = this.items[i];
      if (now - item.bornAt > conf.lifeMs) continue;

      var taken = this._takeItem(item, now);
      if (!taken) kept.push(item);
    }
    this.items = kept;
  };

  /** 円が触れたら武器が変わる。 */
  VideoBattle.prototype._takeItem = function (item, now) {
    var ids = ['red', 'blue'];
    for (var i = 0; i < ids.length; i += 1) {
      var fighter = this.fighters[ids[i]];
      var dx = fighter.position.x - item.x;
      var dy = fighter.position.y - item.y;
      var reach = fighter.radius + item.radius;
      if (dx * dx + dy * dy > reach * reach) continue;

      this.equip(fighter, item.weapon.id, now);
      this.emit('pickup', { fighter: fighter, weapon: item.weapon, item: item, at: now });
      return true;
    }
    return false;
  };

  /** 武器を持ち替える。照射の途中なら必ず止めます (音が鳴り続けないように)。 */
  VideoBattle.prototype.equip = function (fighter, weaponId, now) {
    var weapon = this.weapon(weaponId);
    if (fighter.action === 'beam' || fighter.action === 'charge') {
      this.emit('beam:end', { fighter: fighter, weapon: fighter.weapon, at: now, aborted: true });
    }
    fighter.weapon = weapon;
    fighter.action = 'idle';
    fighter.nextAttackAt = now + 220;
    return weapon;
  };

  /**
   * 次に落とす武器。
   *
   * 毎回でたらめに選ぶと、6 種類あっても**同じ武器ばかり落ちる**回が出ます。
   * 1 本の動画で HAMMER が一度も出ないと、一番重い一撃が最後まで来ません。
   * 全種類を 1 巡させてから混ぜ直せば、順番は読めないまま、どの武器も必ず出ます。
   */
  VideoBattle.prototype._nextWeapon = function () {
    if (!this._bag.length) {
      this._bag = this.config.weapons.order.slice();
      for (var i = this._bag.length - 1; i > 0; i -= 1) {
        var j = Math.floor(this.random() * (i + 1));
        var swap = this._bag[i]; this._bag[i] = this._bag[j]; this._bag[j] = swap;
      }
    }
    return this._bag.pop();
  };

  VideoBattle.prototype.spawnItem = function (weaponId, at) {
    var conf = this.config.items;
    var now = at != null ? at : this.now();
    var b = this.bounds();
    var id = weaponId || this._nextWeapon();

    var x = b.left + conf.margin + this.random() * (b.right - b.left - conf.margin * 2);
    var y = b.top + conf.margin + this.random() * (b.bottom - b.top - conf.margin * 2);

    var item = {
      id: this._id('item'),
      weapon: this.weapon(id),
      x: x,
      y: y,
      radius: conf.radius,
      bornAt: now
    };
    this.items.push(item);
    this.emit('item', item);
    return item;
  };

  // ------------------------------------------------------------ 状態

  /** 画面が読むだけの状態。 */
  VideoBattle.prototype.getState = function () {
    return {
      phase: this.phase,
      winner: this.winner,
      red: this.fighters.red,
      blue: this.fighters.blue,
      projectiles: this.projectiles,
      items: this.items,
      intensity: this.intensity()
    };
  };

  global.CB = global.CB || {};
  global.CB.VideoBattle = VideoBattle;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoBattle: VideoBattle };
  }
})(typeof window !== 'undefined' ? window : this);
