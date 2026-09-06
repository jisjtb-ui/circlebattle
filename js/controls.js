/**
 * controls.js - テストパネル。配信には出さない開発用の入口です。
 *
 * ボタンはすべて「TikTok の生イベント」を作って TikTokAdapter へ渡します。
 * 本番と同じ経路 (Adapter -> Router -> Session -> Engine) を通るので、
 * ここで動けば実際の配信でも同じように動きます。
 *
 *   ?obs=1 を付けるとパネルは出ません (配信画面用)。
 */
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function Controls(options) {
    options = options || {};
    this.tiktok = options.tiktok;
    this.engine = options.engine;
    this.session = options.session;
    this.leaderboard = options.leaderboard;
    this.renderer = options.renderer;
    this.sfx = options.sfx || null;

    this._bind();
  }

  /** パネルに入っているユーザー名で偽のイベントを作る。 */
  Controls.prototype.user = function () {
    var input = $('test-user');
    var name = (input && input.value.trim()) || 'tester';
    return { id: 'test-' + name, uniqueId: name, nickname: name };
  };

  Controls.prototype.send = function (raw) {
    raw.user = raw.user || this.user();
    return this.tiktok.handleEvent(raw);
  };

  Controls.prototype._bind = function () {
    var self = this;

    function click(id, handler) {
      var el = $(id);
      if (el) el.addEventListener('click', handler);
    }

    click('btn-like10', function () { self.send({ type: 'like', count: 10 }); });
    click('btn-like100', function () { self.send({ type: 'like', count: 100 }); });
    click('btn-follow', function () { self.send({ type: 'follow' }); });
    click('btn-share', function () { self.send({ type: 'share' }); });
    click('btn-comment', function () { self.send({ type: 'chat', comment: 'hello' }); });

    click('btn-gift', function () {
      var input = $('gift-coins');
      var coins = Math.max(1, parseInt(input && input.value, 10) || 1);
      self.send({ type: 'gift', giftName: 'Test Gift', diamondCount: coins, repeatCount: 1 });
    });

    // 何人もいる状態を作る (ランキングの見た目を確かめる用)
    click('btn-crowd', function () {
      for (var i = 1; i <= 12; i += 1) {
        var name = 'viewer' + (i < 10 ? '0' : '') + i;
        var user = { id: 'test-' + name, uniqueId: name, nickname: name };
        self.send({ type: 'like', count: 10 + Math.floor(Math.random() * 90), user: user });
        if (Math.random() < 0.4) {
          self.send({ type: 'gift', giftName: 'Test Gift', diamondCount: 1 + Math.floor(Math.random() * 50), user: user });
        }
      }
    });

    click('btn-boss', function () { self.engine.spawnEnemy('boss'); });
    click('btn-reset', function () {
      self.engine.reset();
      self.leaderboard.reset();
      self.session.reset();
    });

    // 音の入 / 切と音量。配信中に BGM とぶつかったら下げられるように。
    var mute = $('btn-mute');
    if (mute && this.sfx) {
      var paint = function () {
        mute.textContent = self.sfx.enabled ? 'SOUND ON' : 'SOUND OFF';
        mute.setAttribute('aria-pressed', String(self.sfx.enabled));
      };
      paint();
      mute.addEventListener('click', function () {
        self.sfx.toggle();
        self.sfx.resume();
        var badge = $('muted');
        if (badge && !self.sfx.enabled) badge.hidden = true;
        paint();
      });
    }

    var volume = $('sfx-volume');
    if (volume && this.sfx) {
      volume.value = String(Math.round(this.sfx.volume * 100));
      volume.addEventListener('input', function () {
        self.sfx.setVolume(Number(volume.value) / 100);
      });
    }

    var sort = $('sort-select');
    if (sort) {
      sort.value = this.leaderboard.sortBy;
      sort.addEventListener('change', function () {
        self.leaderboard.setSort(sort.value);
        self.renderer.renderRanking(true);
      });
    }

    // 中継サーバーに「この配信へ繋いで」と頼む。tikhub が動いていれば効きます。
    var form = $('connect-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = $('connect-input');
        var hint = $('connect-hint');
        var target = input && input.value.trim();
        if (!target) return;

        if (hint) hint.textContent = '接続中…';
        self.tiktok.connectLive(target).then(function (result) {
          if (hint) hint.textContent = result.message || (result.ok ? '接続しました' : '接続できませんでした');
        });
      });
    }
  };

  global.CB = global.CB || {};
  global.CB.Controls = Controls;
})(typeof window !== 'undefined' ? window : this);
