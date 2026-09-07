/**
 * controls.js - テストパネル。配信には出さない、操作画面の中の入口です。
 *
 * ボタンはすべて「TikTok の生イベント」を作って TikTokAdapter へ渡します。
 * 本番と同じ経路 (Adapter -> Router -> Session -> Engine) を通るので、
 * ここで動けば実際の配信でも同じように動きます。
 *
 * 音や設定のスライダーは control.js が持ちます。ここは
 * 「イベントを流し込む」ことだけに絞ってあります。
 */
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  /**
   * @param {object} options { app } … 共有しているゲーム 1 つだけ渡します
   */
  function Controls(options) {
    options = options || {};
    var app = options.app;

    this.app = app;
    this.tiktok = app.tiktok;
    this.engine = app.engine;
    this.session = app.session;
    this.leaderboard = app.leaderboard;
    this.director = app.director;

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
    click('btn-join', function () { self.send({ type: 'member' }); });
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
    // 特殊イベントは director に頼みます (演出の文字も一緒に出ます)
    click('btn-swarm', function () {
      if (self.director) self.director.trigger('swarm');
    });
    click('btn-reset', function () { self.app.reset(); });

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
