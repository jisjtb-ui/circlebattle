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

  function $(id) { return document.getElementById(id); }

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

  function Renderer(engine, options) {
    options = options || {};
    this.engine = engine;
    this.config = options.config || engine.config;
    this.leaderboard = options.leaderboard || null;
    this.avatars = options.avatars || null;

    this.el = {
      canvas: $('field'),
      defeated: $('defeated'),
      enemiesAlive: $('enemies-alive'),
      circlesAlive: $('circles-alive'),
      players: $('players'),
      rankingList: $('ranking-list'),
      rankingMetric: $('ranking-metric'),
      rankingEmpty: $('ranking-empty'),
      notice: $('notice'),
      status: $('status'),
      statusText: $('status-text')
    };

    this.ctx = this.el.canvas ? this.el.canvas.getContext('2d') : null;
    this.scale = 1;
    this._cssWidth = 0;
    this._cssHeight = 0;

    /** 撃破の閃光。見た目だけの短命なリスト。 */
    this._bursts = [];
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
    var dpr = global.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;

    if (rect.width !== this._cssWidth || rect.height !== this._cssHeight ||
        canvas.width !== Math.round(rect.width * dpr)) {
      this._cssWidth = rect.width;
      this._cssHeight = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // フィールドは正方形なので、短いほうに合わせれば歪みません。
    this.scale = Math.min(rect.width / this.engine.field.width,
                          rect.height / this.engine.field.height);
  };

  Renderer.prototype.draw = function (now) {
    if (!this.ctx) return;
    this._resize();

    var ctx = this.ctx;
    var scale = this.scale;
    var w = this._cssWidth;
    var h = this._cssHeight;

    ctx.clearRect(0, 0, w, h);
    this._drawBackground(ctx, w, h);

    var state = this.engine.getState();
    var i;

    // アイテムは一番下に描く。円と重なっても、拾う側が隠れないように。
    for (i = 0; i < state.items.length; i += 1) {
      this._drawItem(ctx, state.items[i], scale, now);
    }
    for (i = 0; i < state.enemies.length; i += 1) {
      this._drawEnemy(ctx, state.enemies[i], scale);
    }
    for (i = 0; i < state.circles.length; i += 1) {
      this._drawCircle(ctx, state.circles[i], scale);
    }
    this._drawBursts(ctx, scale, now);
    this._drawHud(state);
    this.renderRanking();
  };

  Renderer.prototype._drawBackground = function (ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(9, 10, 24, 0.92)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(120, 140, 255, 0.10)';
    ctx.lineWidth = 1;
    var step = w / 10;
    for (var i = 1; i < 10; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, h);
      ctx.moveTo(0, i * step);
      ctx.lineTo(w, i * step);
      ctx.stroke();
    }
    ctx.restore();
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

  Renderer.prototype._drawCircle = function (ctx, circle, scale) {
    var x = circle.position.x * scale;
    var y = circle.position.y * scale;
    var r = circle.radius * scale;
    var hue = ownerHue(circle.ownerId);
    var color = 'hsl(' + hue + ', 90%, 65%)';

    var image = this.avatars ? this.avatars.get(circle.profileImageUrl) : null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    if (image) {
      // 画像は円の中だけに描く (はみ出さないように切り抜く)。
      // 正方形でない画像でも顔が伸びないよう、短い辺に合わせて中央を切り出します。
      ctx.save();
      ctx.clip();
      var iw = image.naturalWidth || image.width || 1;
      var ih = image.naturalHeight || image.height || 1;
      var side = Math.min(iw, ih);
      ctx.drawImage(image, (iw - side) / 2, (ih - side) / 2, side, side, x - r, y - r, r * 2, r * 2);
      ctx.restore();
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
    ctx.stroke();

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

  // --------------------------------------------------------------- HUD

  Renderer.prototype._drawHud = function (state) {
    if (this.el.defeated) this.el.defeated.textContent = state.defeated.toLocaleString();
    if (this.el.enemiesAlive) this.el.enemiesAlive.textContent = state.enemiesAlive;
    if (this.el.circlesAlive) this.el.circlesAlive.textContent = state.circlesAlive;
    if (this.el.players && this.leaderboard) {
      this.el.players.textContent = this.leaderboard.count();
    }
  };

  // ----------------------------------------------------------- ranking

  /** 行は最初に作っておき、あとは中身だけ書き換える (毎フレーム作り直さない)。 */
  Renderer.prototype._buildRanking = function () {
    var list = this.el.rankingList;
    if (!list) return;
    var size = this.config.ui.rankingSize;

    list.innerHTML = '';
    this._rows = [];

    for (var i = 0; i < size; i += 1) {
      var row = document.createElement('li');
      row.className = 'rank';
      row.hidden = true;
      row.innerHTML =
        '<span class="rank__no">' + (i + 1) + '</span>' +
        '<span class="rank__avatar"><img alt="" hidden><span class="rank__initial"></span></span>' +
        '<span class="rank__name"></span>' +
        '<span class="rank__value"></span>';

      list.appendChild(row);
      this._rows.push({
        el: row,
        img: row.querySelector('img'),
        initial: row.querySelector('.rank__initial'),
        name: row.querySelector('.rank__name'),
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
    if (!this.leaderboard || !this._rows.length) return;
    if (!force && this.leaderboard.version === this._rankingVersion) return;
    this._rankingVersion = this.leaderboard.version;

    var top = this.leaderboard.top();
    var metric = this.leaderboard.sortBy;

    if (this.el.rankingMetric) this.el.rankingMetric.textContent = metric.toUpperCase();
    if (this.el.rankingEmpty) this.el.rankingEmpty.hidden = top.length > 0;

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

      var value = metric === 'kills' ? record.kills
        : metric === 'damage' ? Math.round(record.damage)
          : Math.round(record.score);
      row.value.textContent = value.toLocaleString() + ' ' + (metric === 'kills' ? 'KILLS' : metric.toUpperCase());
    }
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

    clearTimeout(this._noticeTimer);
    var self = this;
    this._noticeTimer = setTimeout(function () {
      el.hidden = true;
    }, this.config.ui.noticeMs);
  };

  /** 中継サーバー / 配信の状態表示。 */
  Renderer.prototype.setStatus = function (state, text) {
    if (this.el.status) this.el.status.dataset.state = state;
    if (this.el.statusText) this.el.statusText.textContent = text;
  };

  global.CB = global.CB || {};
  global.CB.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : this);
