/**
 * video-renderer.js - VIDEO BATTLE MODE の描画。
 *
 * **表示はすべて canvas に描きます。** HP バーも WINNER も HTML では出しません。
 * 録画は canvas.captureStream() で撮るので、HTML で重ねたものは動画に写らない
 * ためです (完成した動画をそのまま出せることが、このモードの目的です)。
 *
 * 描く順番:
 *
 *   背景 → アイテム → 弾 / ビーム → 円 (武器つき) → ヒットエフェクト
 *   → HP バー → 危険域の演出 → WINNER
 *
 * 画面振動は**盤面だけ**に掛けます。HP バーまで揺らすと、肝心の
 * 「どちらが優勢か」が読み取れなくなるためです。
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  /** 角の丸い四角。ctx.roundRect が無い環境でも同じ形になります。 */
  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, Math.abs(w) / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * @param {object} options { battle, canvas, config, win }
   */
  function VideoRenderer(options) {
    options = options || {};
    this.battle = options.battle;
    this.config = options.config || this.battle.config;
    this.canvas = options.canvas;
    this.win = options.win || global;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    this.scale = 1;
    this._cssWidth = 0;
    this._cssHeight = 0;

    /** HP バーの表示値。実際の HP へ遅れて追いつきます。 */
    this.bars = {
      red: this._makeBar(this.battle.fighters.red),
      blue: this._makeBar(this.battle.fighters.blue)
    };

    /** ヒットや射出の残像。寿命が来たら消えます。 */
    this.effects = [];
    /** 画面振動。 */
    this.shake = { amount: 0, until: 0, ms: 1 };
    /** WINNER の表示開始時刻 (音と同時に始めます)。 */
    this.winnerAt = null;

    this._lastDraw = null;
    this._listen();
  }

  VideoRenderer.prototype._makeBar = function (fighter) {
    return { value: fighter.hp / fighter.maxHp, ghost: fighter.hp / fighter.maxHp, ghostAt: 0 };
  };

  // ---------------------------------------------------------- 受け取り

  VideoRenderer.prototype._listen = function () {
    var self = this;
    var battle = this.battle;

    battle.on('hit', function (hit) {
      self._push({
        kind: hit.continuous ? 'beam-hit' : (hit.big ? 'big' : 'hit'),
        x: hit.x, y: hit.y, angle: hit.angle,
        color: hit.source.color, glow: hit.source.glow,
        weapon: hit.weapon.id, big: hit.big, at: hit.at,
        life: hit.big ? self.config.effects.hitLifeMs * 1.6 : self.config.effects.hitLifeMs
      });
      self.bars[hit.target.id].ghostAt = hit.at;
      self._shake(hit.shake, hit.shakeMs, hit.at);
    });

    battle.on('shot', function (shot) {
      self._push({
        kind: 'shot', weapon: shot.weapon.id,
        x: shot.fighter.position.x, y: shot.fighter.position.y,
        angle: shot.angle, color: shot.weapon.color, glow: shot.fighter.glow,
        radius: shot.fighter.radius, at: shot.at, life: 240
      });
    });

    battle.on('miss', function (miss) {
      self._push({
        kind: 'miss', weapon: miss.weapon.id,
        x: miss.fighter.position.x, y: miss.fighter.position.y,
        angle: miss.angle, color: miss.weapon.color,
        radius: miss.fighter.radius, at: miss.at, life: 200
      });
    });

    battle.on('pickup', function (taken) {
      self._push({
        kind: 'pickup', x: taken.item.x, y: taken.item.y,
        color: taken.weapon.color, at: taken.at, life: 420,
        label: taken.weapon.name
      });
    });

    battle.on('ko', function (ko) {
      // WINNER の表示は勝利音とまったく同じ瞬間に始めます
      self.winnerAt = ko.at;
      self._push({
        kind: 'ko', x: ko.loser.position.x, y: ko.loser.position.y,
        color: ko.loser.color, glow: ko.loser.glow, at: ko.at, life: 900
      });
    });

    battle.on('reset', function () {
      self.effects = [];
      self.winnerAt = null;
      self.shake.amount = 0;
      self.bars.red = self._makeBar(battle.fighters.red);
      self.bars.blue = self._makeBar(battle.fighters.blue);
    });
  };

  VideoRenderer.prototype._push = function (effect) {
    this.effects.push(effect);
    var max = this.config.effects.maxEffects;
    if (this.effects.length > max) this.effects.splice(0, this.effects.length - max);
  };

  VideoRenderer.prototype._shake = function (amount, ms, at) {
    if (amount <= this.shake.amount && at < this.shake.until) return;
    this.shake.amount = amount;
    this.shake.ms = ms;
    this.shake.until = at + ms;
  };

  // ------------------------------------------------------------ canvas

  VideoRenderer.prototype._resize = function () {
    var canvas = this.canvas;
    if (!canvas) return;

    var rect = canvas.getBoundingClientRect();
    var dpr = this.win.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;

    if (rect.width !== this._cssWidth || rect.height !== this._cssHeight ||
        canvas.width !== Math.round(rect.width * dpr)) {
      this._cssWidth = rect.width;
      this._cssHeight = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      this.battle.setFieldAspect(rect.width / rect.height);
    }

    this.scale = rect.height / this.battle.field.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  VideoRenderer.prototype.draw = function (now) {
    if (!this.ctx) return;
    this._resize();

    var dt = this._lastDraw == null ? 0 : Math.min((now - this._lastDraw) / 1000, 0.1);
    this._lastDraw = now;

    var ctx = this.ctx;
    var scale = this.scale;
    var w = this.battle.field.width * scale;
    var h = this.battle.field.height * scale;

    this._advanceBars(dt);
    this._drawBackground(ctx, w, h);

    // 盤面だけを揺らします。HP バーは揺らしません
    var shake = this._shakeOffset(now);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    ctx.scale(scale, scale);

    this._drawArena(ctx);
    this._drawItems(ctx, now);
    this._drawProjectiles(ctx);
    this._drawBeams(ctx, now);
    this._drawFighter(ctx, this.battle.fighters.red, now);
    this._drawFighter(ctx, this.battle.fighters.blue, now);
    this._drawEffects(ctx, now);

    ctx.restore();

    ctx.save();
    ctx.scale(scale, scale);
    this._drawHpBars(ctx, now);
    if (this.winnerAt != null) this._drawWinner(ctx, now);
    ctx.restore();
  };

  VideoRenderer.prototype._shakeOffset = function (now) {
    var shake = this.shake;
    if (now >= shake.until) return { x: 0, y: 0 };
    var left = (shake.until - now) / shake.ms;
    var power = shake.amount * left * left * this.scale;
    return {
      x: (Math.random() * 2 - 1) * power,
      y: (Math.random() * 2 - 1) * power
    };
  };

  // -------------------------------------------------------- HP バーの値

  /**
   * HP バーを実際の HP へ近づける。
   *
   *   value … 今の HP。少し遅れて追いつきます (瞬間的に変わると減った量が
   *           分かりません)
   *   ghost … 減ったぶんを白く残す残像。value より**もっと**遅れて追うので、
   *           大ダメージほど白い帯が長く残り、「大きく減った」が読めます。
   */
  VideoRenderer.prototype._advanceBars = function (dt) {
    var hp = this.config.hp;
    ['red', 'blue'].forEach(function (id) {
      var fighter = this.battle.fighters[id];
      var bar = this.bars[id];
      var target = fighter.hp / fighter.maxHp;

      bar.value += (target - bar.value) * clamp(hp.easePerSecond * dt, 0, 1);
      if (Math.abs(bar.value - target) < 0.0015) bar.value = target;

      var holdUntil = bar.ghostAt + hp.ghostHoldMs;
      if ((this.battle._lastUpdate || 0) >= holdUntil) {
        // 倒れたあとは急いで空にします。白い残りが居座ると、0 なのに
        // まだ HP があるように見えます
        var speed = fighter.hp <= 0 ? hp.ghostPerSecond * 5 : hp.ghostPerSecond;
        bar.ghost += (bar.value - bar.ghost) * clamp(speed * dt, 0, 1);
      }
      if (bar.ghost < bar.value) bar.ghost = bar.value;
    }, this);
  };

  // ------------------------------------------------------------ 背景

  VideoRenderer.prototype._drawBackground = function (ctx, w, h) {
    var grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#080a1c');
    grd.addColorStop(0.5, '#05060f');
    grd.addColorStop(1, '#0a0616');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  };

  /** 盤面のふち。上下の余白 (HP バーの帯) との境目をはっきりさせます。 */
  VideoRenderer.prototype._drawArena = function (ctx) {
    var b = this.battle.bounds();
    var intensity = this.battle.intensity();

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(124, 92, 255, ' + (0.3 + intensity * 0.35).toFixed(3) + ')';
    ctx.shadowColor = 'rgba(124, 92, 255, 0.8)';
    ctx.shadowBlur = 26 + intensity * 30;
    roundRect(ctx, b.left + 8, b.top + 8, b.right - b.left - 16, b.bottom - b.top - 16, 34);
    ctx.stroke();
    ctx.restore();

    // うっすらした格子。動きの速さが分かるようにするためだけのものです
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 140, 255, 0.06)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var x = b.left + 120; x < b.right; x += 120) {
      ctx.moveTo(x, b.top); ctx.lineTo(x, b.bottom);
    }
    for (var y = b.top + 120; y < b.bottom; y += 120) {
      ctx.moveTo(b.left, y); ctx.lineTo(b.right, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  // ---------------------------------------------------------- アイテム

  VideoRenderer.prototype._drawItems = function (ctx, now) {
    var items = this.battle.items;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var pulse = 0.75 + Math.sin(now / 240 + i) * 0.25;

      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.shadowColor = item.weapon.color;
      ctx.shadowBlur = 30 * pulse;
      ctx.strokeStyle = item.weapon.color;
      ctx.fillStyle = 'rgba(4, 6, 18, 0.7)';
      ctx.lineWidth = 4;

      ctx.rotate(now / 900);
      roundRect(ctx, -item.radius, -item.radius, item.radius * 2, item.radius * 2, 12);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-now / 900);

      this._drawWeaponIcon(ctx, item.weapon.id, item.radius * 0.78, item.weapon.color);
      ctx.restore();

      // 名前。どの武器が落ちているかが読めないと、拾った意味が伝わりません
      ctx.save();
      ctx.fillStyle = item.weapon.color;
      ctx.font = '600 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      ctx.fillText(item.weapon.name, item.x, item.y + item.radius + 34);
      ctx.restore();
    }
  };

  /** 武器の絵。アイテムにも円のまわりにも同じものを使います。 */
  VideoRenderer.prototype._drawWeaponIcon = function (ctx, id, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (id) {
      case 'hammer':
        ctx.beginPath();
        ctx.moveTo(-size * 0.1, size * 0.75); ctx.lineTo(size * 0.15, -size * 0.2);
        ctx.stroke();
        roundRect(ctx, -size * 0.62, -size * 0.78, size * 1.24, size * 0.62, size * 0.16);
        ctx.fill();
        break;

      case 'sword':
        ctx.beginPath();
        ctx.moveTo(-size * 0.55, size * 0.7); ctx.lineTo(size * 0.62, -size * 0.72);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, size * 0.12);
        ctx.beginPath();
        ctx.moveTo(-size * 0.62, size * 0.16); ctx.lineTo(-size * 0.05, size * 0.72);
        ctx.stroke();
        break;

      case 'needle':
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, size * 0.6); ctx.lineTo(size * 0.6, -size * 0.68);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, size * 0.3);
        ctx.beginPath();
        ctx.moveTo(-size * 0.6, size * 0.72); ctx.lineTo(-size * 0.2, size * 0.3);
        ctx.stroke();
        break;

      case 'pistol':
        ctx.lineWidth = Math.max(2, size * 0.22);
        ctx.beginPath();
        ctx.moveTo(-size * 0.6, -size * 0.24); ctx.lineTo(size * 0.62, -size * 0.24);
        ctx.moveTo(-size * 0.34, -size * 0.16); ctx.lineTo(-size * 0.52, size * 0.66);
        ctx.stroke();
        break;

      case 'shotgun':
        ctx.lineWidth = Math.max(2, size * 0.2);
        ctx.beginPath();
        ctx.moveTo(-size * 0.7, -size * 0.3); ctx.lineTo(size * 0.72, -size * 0.3);
        ctx.moveTo(-size * 0.7, -size * 0.02); ctx.lineTo(size * 0.4, -size * 0.02);
        ctx.moveTo(-size * 0.4, size * 0.04); ctx.lineTo(-size * 0.62, size * 0.68);
        ctx.stroke();
        break;

      case 'laser':
        ctx.lineWidth = Math.max(2, size * 0.18);
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.38, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(size * 0.44, 0); ctx.lineTo(size * 0.9, 0);
        ctx.moveTo(-size * 0.44, 0); ctx.lineTo(-size * 0.9, 0);
        ctx.moveTo(0, size * 0.44); ctx.lineTo(0, size * 0.9);
        ctx.moveTo(0, -size * 0.44); ctx.lineTo(0, -size * 0.9);
        ctx.stroke();
        break;

      default:
        break;
    }
    ctx.restore();
  };

  // ------------------------------------------------------------- 弾

  VideoRenderer.prototype._drawProjectiles = function (ctx) {
    var list = this.battle.projectiles;
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.radius * 2.4, p.radius, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillRect(-p.radius * 7, -p.radius * 0.3, p.radius * 6, p.radius * 0.6);
      ctx.restore();
    }
  };

  /** LASER の光線。充填中は細く、照射中は太く光ります。 */
  VideoRenderer.prototype._drawBeams = function (ctx, now) {
    ['red', 'blue'].forEach(function (id) {
      var f = this.battle.fighters[id];
      if (f.action !== 'beam' && f.action !== 'charge') return;

      var weapon = f.weapon;
      var charging = f.action === 'charge';
      var length = this.battle.field.height * 1.4;
      var flicker = 0.8 + Math.sin(now / 40) * 0.2;
      var width = charging ? 5 : weapon.width * flicker;

      ctx.save();
      ctx.translate(f.position.x, f.position.y);
      ctx.rotate(f.beamAngle);
      ctx.shadowColor = weapon.color;
      ctx.shadowBlur = charging ? 20 : 55;

      ctx.globalAlpha = charging ? 0.35 : 0.85;
      ctx.fillStyle = weapon.color;
      ctx.fillRect(f.radius, -width / 2, length, width);

      if (!charging) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(f.radius, -width / 6, length, width / 3);
      }
      ctx.restore();

      // 充填中は砲口が膨らみます (「来るぞ」が見て分かるように)
      if (charging) {
        var grow = clamp((weapon.chargeMs - (f.actionUntil - now)) / weapon.chargeMs, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = weapon.color;
        ctx.shadowColor = weapon.color;
        ctx.shadowBlur = 40;
        ctx.beginPath();
        ctx.arc(f.position.x + Math.cos(f.beamAngle) * f.radius,
                f.position.y + Math.sin(f.beamAngle) * f.radius,
                6 + grow * 26, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }, this);
  };

  // -------------------------------------------------------------- 円

  VideoRenderer.prototype._drawFighter = function (ctx, f, now) {
    var ratio = f.hp / f.maxHp;
    var hp = this.config.hp;

    /*
     * 敗者は決着のあと消えていきます。残ったままだと、勝ったのがどちらか
     * 一瞬迷います (WINNER の文字より先に、画面の絵で分かるべきです)。
     */
    var fade = 1;
    if (this.winnerAt != null && this.battle.winner && f !== this.battle.winner) {
      fade = Math.max(0.08, 1 - (now - this.winnerAt) / 700);
    }
    if (fade <= 0.09) return;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(f.position.x, f.position.y);

    // 危険域のリング。**画面を赤く染めません**。その円のまわりだけを脈打たせます
    if (ratio <= hp.dangerRatio && f.hp > 0) {
      var critical = ratio <= hp.criticalRatio;
      var speed = critical ? 170 : 320;
      var pulse = 0.5 + Math.sin(now / speed) * 0.5;
      ctx.save();
      ctx.globalAlpha = (critical ? 0.55 : 0.32) * (0.45 + pulse * 0.55);
      ctx.strokeStyle = critical ? '#ffffff' : f.glow;
      ctx.lineWidth = critical ? 8 : 5;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 40;
      ctx.beginPath();
      ctx.arc(0, 0, f.radius + 16 + pulse * (critical ? 22 : 12), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 回っている武器
    this._drawHeldWeapon(ctx, f, now);

    // 円そのもの
    var grd = ctx.createRadialGradient(-f.radius * 0.3, -f.radius * 0.35, f.radius * 0.1,
                                       0, 0, f.radius);
    grd.addColorStop(0, f.glow);
    grd.addColorStop(0.55, f.color);
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');

    ctx.shadowColor = f.color;
    ctx.shadowBlur = 45;
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, f.radius, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();

    // 被弾の白フラッシュ。一瞬だけです
    if (f.flash > 0) {
      ctx.globalAlpha = f.flash * (f.flashBig ? 0.95 : 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, f.radius * (1 + (1 - f.flash) * (f.flashBig ? 0.22 : 0.1)), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = fade;
    }

    // 名前と、今持っている武器
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '800 40px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText(f.name, 0, 12);
    ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = f.weapon.color;
    ctx.fillText(f.weapon.name, 0, 44);

    ctx.restore();

    // 毒。刺さっている間ずっと出します
    if (f.poison) {
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(now / 120) * 0.2;
      ctx.strokeStyle = this.config.weapons.needle.color;
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 14]);
      ctx.beginPath();
      ctx.arc(f.position.x, f.position.y, f.radius + 9, now / 500, now / 500 + TAU);
      ctx.stroke();
      ctx.restore();
    }
  };

  /** 円のまわりで回っている武器。攻撃の直前は大きく振りかぶります。 */
  VideoRenderer.prototype._drawHeldWeapon = function (ctx, f, now) {
    var weapon = f.weapon;
    var angle = f.weaponAngle;
    var distance = f.radius + 46;

    if (f.action === 'windup') {
      // 振りかぶり。溜めているほど後ろへ引きます
      var left = clamp((f.actionUntil - now) / weapon.windupMs, 0, 1);
      angle = f.swingAngle - left * 1.5;
      distance = f.radius + 46 + (1 - left) * 26;
    } else if (weapon.kind === 'gun' || weapon.kind === 'beam') {
      angle = f.action === 'idle' ? f.weaponAngle : f.beamAngle;
    }

    ctx.save();
    ctx.rotate(angle);
    ctx.translate(distance, 0);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = weapon.color;
    ctx.shadowBlur = 26;
    this._drawWeaponIcon(ctx, weapon.id, 34, weapon.color);
    ctx.restore();
  };

  // ------------------------------------------------------ エフェクト

  VideoRenderer.prototype._drawEffects = function (ctx, now) {
    var kept = [];
    for (var i = 0; i < this.effects.length; i += 1) {
      var e = this.effects[i];
      var t = (now - e.at) / e.life;
      if (t >= 1 || t < 0) continue;
      kept.push(e);
      this._drawEffect(ctx, e, t, now);
    }
    this.effects = kept;
  };

  VideoRenderer.prototype._drawEffect = function (ctx, e, t, now) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = e.color;
    ctx.fillStyle = e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 30;
    ctx.lineCap = 'round';

    switch (e.kind) {
      case 'hit':
      case 'big': {
        var size = e.big ? 150 : 78;
        ctx.lineWidth = (e.big ? 14 : 7) * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, size * (0.25 + t * 0.9), 0, TAU);
        ctx.stroke();

        // 飛び散り。大ダメージほど多く、遠くまで飛びます
        var sparks = e.big ? 12 : 6;
        ctx.lineWidth = (e.big ? 8 : 4) * (1 - t);
        for (var s = 0; s < sparks; s += 1) {
          var a = e.angle + (s / sparks) * TAU;
          var from = size * (0.3 + t * 0.7);
          var to = from + size * (e.big ? 0.7 : 0.4) * (1 - t);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * from, Math.sin(a) * from);
          ctx.lineTo(Math.cos(a) * to, Math.sin(a) * to);
          ctx.stroke();
        }
        if (e.big) {
          ctx.globalAlpha = (1 - t) * 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.5 * (1 - t), 0, TAU);
          ctx.fill();
        }
        break;
      }

      case 'beam-hit':
        ctx.lineWidth = 6 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, 40 * (0.4 + t), 0, TAU);
        ctx.stroke();
        break;

      case 'shot':
        ctx.rotate(e.angle);
        if (e.weapon === 'pistol' || e.weapon === 'shotgun') {
          // 銃口の光
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.beginPath();
          ctx.moveTo(e.radius, 0);
          ctx.lineTo(e.radius + 60 * (1 - t), -22 * (1 - t));
          ctx.lineTo(e.radius + 60 * (1 - t), 22 * (1 - t));
          ctx.closePath();
          ctx.fill();
        } else if (e.weapon === 'laser') {
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, e.radius + 30 * (1 - t), -0.5, 0.5);
          ctx.stroke();
        } else {
          // 振りかぶりの弧
          ctx.lineWidth = 8 * (1 - t);
          ctx.beginPath();
          ctx.arc(0, 0, e.radius + 40, -1.1 + t * 1.4, 0.3 + t * 1.4);
          ctx.stroke();
        }
        break;

      case 'miss':
        // 外れた。うっすらとした空振りの線だけを出します (音は鳴りません)
        ctx.globalAlpha = (1 - t) * 0.4;
        ctx.rotate(e.angle);
        ctx.lineWidth = 5 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 70, -0.9 + t * 1.8, -0.1 + t * 1.8);
        ctx.stroke();
        break;

      case 'pickup':
        ctx.lineWidth = 6 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, 40 + t * 90, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, 0, -60 - t * 40);
        break;

      case 'ko':
        ctx.lineWidth = 18 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, 60 + t * 420, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.lineWidth = 8 * (1 - t);
        ctx.beginPath();
        ctx.arc(0, 0, 30 + t * 240, 0, TAU);
        ctx.stroke();
        break;

      default:
        break;
    }
    ctx.restore();
  };

  // ---------------------------------------------------------- HP バー

  /**
   * 画面上部の HP バー。
   *
   *   RED  ███████████░░░░░
   *              VS
   *   BLUE ██████░░░░░░░░░░
   *
   * 数字は出しません。**長さだけで優劣が分かること**が目的なので、
   * 数字があるとかえって読む時間がかかります。RED は左から、BLUE は右から
   * 伸ばして、対戦しているように見せます。
   */
  VideoRenderer.prototype._drawHpBars = function (ctx, now) {
    var width = this.battle.field.width;
    var margin = 46;
    var barW = width - margin * 2;
    var barH = 40;

    this._drawHpBar(ctx, this.battle.fighters.red, this.bars.red,
      margin, 58, barW, barH, false, now);

    // VS
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(238, 241, 255, 0.85)';
    ctx.shadowColor = 'rgba(124, 92, 255, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillText('VS', width / 2, 141);
    ctx.restore();

    this._drawHpBar(ctx, this.battle.fighters.blue, this.bars.blue,
      margin, 156, barW, barH, true, now);
  };

  VideoRenderer.prototype._drawHpBar = function (ctx, f, bar, x, y, w, h, mirrored, now) {
    var hp = this.config.hp;
    var ratio = clamp(bar.value, 0, 1);
    var ghost = clamp(bar.ghost, 0, 1);
    var live = f.hp / f.maxHp;

    var warn = live <= hp.warnRatio;
    var danger = live <= hp.dangerRatio;
    var critical = live <= hp.criticalRatio && f.hp > 0;
    var pulse = 0.5 + Math.sin(now / (critical ? 150 : 300)) * 0.5;

    ctx.save();

    // 下地
    ctx.fillStyle = 'rgba(6, 8, 22, 0.72)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.stroke();

    // 減ったぶんの残像 (白)。大ダメージほど長く残ります
    if (ghost > ratio) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffffff';
      this._barFill(ctx, x, y, w, h, ghost, mirrored);
      ctx.restore();
    }

    // 本体
    var grd = mirrored
      ? ctx.createLinearGradient(x + w, 0, x, 0)
      : ctx.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, f.bar[0]);
    grd.addColorStop(1, f.bar[1]);
    ctx.fillStyle = grd;
    ctx.shadowColor = f.color;
    // 危険なほど強く光ります (30% で強調、15% でさらに、5% で脈打つ)
    ctx.shadowBlur = warn ? 24 + pulse * (critical ? 40 : danger ? 24 : 10) : 14;
    this._barFill(ctx, x, y, w, h, ratio, mirrored);

    if (critical) {
      ctx.save();
      ctx.globalAlpha = 0.35 + pulse * 0.5;
      ctx.fillStyle = '#ffffff';
      this._barFill(ctx, x, y, w, h, ratio, mirrored);
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // 10% ごとの目盛り。数字を出さずに割合を読ませるためのものです
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 1; i < 10; i += 1) {
      var tx = x + (w * i) / 10;
      ctx.moveTo(tx, y + 5); ctx.lineTo(tx, y + h - 5);
    }
    ctx.stroke();
    ctx.restore();

    // 危険域の枠。画面全体は染めません
    if (danger && f.hp > 0) {
      ctx.save();
      ctx.globalAlpha = critical ? 0.5 + pulse * 0.5 : 0.35 + pulse * 0.3;
      ctx.strokeStyle = critical ? '#ffffff' : f.glow;
      ctx.lineWidth = critical ? 4 : 3;
      roundRect(ctx, x - 3, y - 3, w + 6, h + 6, (h + 6) / 2);
      ctx.stroke();
      ctx.restore();
    }

    // 名前。バーの外側 (RED は左、BLUE は右) に置きます
    ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 16;
    ctx.textAlign = mirrored ? 'right' : 'left';
    ctx.fillText(f.name, mirrored ? x + w - 4 : x + 4, y - 10);

    // 「あと一撃」だけは文字でも伝えます
    if (critical) {
      ctx.globalAlpha = 0.55 + pulse * 0.45;
      ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = mirrored ? 'left' : 'right';
      ctx.fillText('DANGER', mirrored ? x + 4 : x + w - 4, y - 10);
    }

    ctx.restore();
  };

  /** バーの中身。mirrored なら右から左へ伸びます。 */
  VideoRenderer.prototype._barFill = function (ctx, x, y, w, h, ratio, mirrored) {
    // 0 は必ず「何も無い」にします。丸い端のぶんだけ残ると、負けたのに
    // まだ HP があるように見えてしまいます
    if (ratio <= 0.001) return;
    var fill = Math.max(h * 0.6, w * ratio);
    if (mirrored) roundRect(ctx, x + w - fill, y, fill, h, h / 2);
    else roundRect(ctx, x, y, fill, h, h / 2);
    ctx.fill();
  };

  // ---------------------------------------------------------- WINNER

  /**
   * 勝者の表示。
   *
   * 表示が始まるのは ko の瞬間 (= 勝利音が鳴る瞬間) です。両方とも同じ
   * タイムスタンプから動かすので、音と表示がずれません。
   */
  VideoRenderer.prototype._drawWinner = function (ctx, now) {
    var battle = this.battle;
    if (!battle.winner) return;

    var width = battle.field.width;
    var height = battle.field.height;
    var age = now - this.winnerAt;
    var appear = clamp(age / 420, 0, 1);
    var winner = battle.winner;

    ctx.save();

    /*
     * 沈めるのは**盤面だけ**です。HP バーはそのまま残します。
     * 「0% と 13% で決着した」という最後の状態は、勝敗そのものと同じくらい
     * 見せたい情報だからです。
     */
    var top = this.config.field.topMargin;
    ctx.globalAlpha = appear * 0.72;
    ctx.fillStyle = '#04050e';
    ctx.fillRect(0, top, width, height - top);

    ctx.globalAlpha = appear;
    ctx.textAlign = 'center';
    ctx.translate(width / 2, height * 0.46);
    // 少し大きく出てから戻ります
    var scale = 1 + (1 - appear) * 0.35;
    ctx.scale(scale, scale);

    ctx.font = '700 74px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(238, 241, 255, 0.9)';
    ctx.shadowColor = 'rgba(124, 92, 255, 0.9)';
    ctx.shadowBlur = 24;
    ctx.fillText('WINNER', 0, -60);

    var glow = 0.7 + Math.sin(now / 260) * 0.3;
    ctx.font = '900 190px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = winner.color;
    ctx.shadowColor = winner.glow;
    ctx.shadowBlur = 50 + glow * 60;
    ctx.fillText(winner.name, 0, 90);

    ctx.restore();
  };

  global.CB = global.CB || {};
  global.CB.VideoRenderer = VideoRenderer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoRenderer: VideoRenderer };
  }
})(typeof window !== 'undefined' ? window : this);
