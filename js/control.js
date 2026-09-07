/**
 * control.js - 操作画面 (index.html) の入口まわり。
 *
 * ここが触るのは「設定」と「ウィンドウ」だけです。ゲームのルールは
 * 1 つも持ちません。数値は config をその場で書き換えるので、
 * 開いているゲームウィンドウにも次のフレームから効きます
 * (config は 2 つの画面で同じものを見ています)。
 */
(function (global) {
  'use strict';

  function $(id) { return global.document.getElementById(id); }

  /**
   * 画面に出す設定の一覧。
   *
   * ここに 1 行足すだけでスライダーが増えます。path は config の中の場所です。
   * **配信中に触っても壊れない値だけ**を出しています (フィールドの大きさなど、
   * 途中で変えると座標が飛ぶものは出していません)。
   */
  var SETTINGS = {
    enemies: [
      { path: 'enemies.spawn.intervalMs', label: 'SPAWN EVERY', min: 200, max: 4000, step: 100, unit: 'ms' },
      { path: 'enemies.spawn.batch', label: 'PER SPAWN', min: 1, max: 6, step: 1 },
      { path: 'enemies.spawn.maxAlive', label: 'MAX ALIVE', min: 8, max: 120, step: 2 },
      { path: 'enemies.spawn.minAlive', label: 'MIN ALIVE', min: 0, max: 40, step: 1 },
      { path: 'enemies.scale.hpPerTotalLevel', label: 'HP SCALING', min: 200, max: 4000, step: 100 },
      { path: 'director.waveMs', label: 'WAVE EVERY', min: 20000, max: 300000, step: 10000, unit: 'ms' },
      { path: 'director.eventChance', label: 'EVENT CHANCE', min: 0, max: 1, step: 0.05 }
    ],
    viewers: [
      { path: 'viewers.levels.likesPerLevel', label: 'LIKES / LEVEL', min: 1, max: 50, step: 1 },
      { path: 'viewers.levels.follow', label: 'FOLLOW', min: 0, max: 100, step: 1, unit: 'Lv' },
      { path: 'viewers.levels.share', label: 'SHARE', min: 0, max: 100, step: 1, unit: 'Lv' },
      { path: 'viewers.levels.join', label: 'JOIN', min: 0, max: 100, step: 1, unit: 'Lv' },
      { path: 'viewers.levels.giftLevelsPerCoin', label: 'GIFT / COIN', min: 0.1, max: 5, step: 0.1, unit: 'Lv' },
      { path: 'viewers.levels.maxDurationMs', label: 'MAX LV BURST', min: 3000, max: 60000, step: 1000, unit: 'ms' },
      { path: 'viewers.limits.maxPerUser', label: 'CIRCLES / USER', min: 1, max: 10, step: 1 },
      { path: 'viewers.limits.queue', label: 'QUEUE / USER', min: 0, max: 10, step: 1 },
      { path: 'items.spawn.intervalMs', label: 'ITEM EVERY', min: 3000, max: 60000, step: 1000, unit: 'ms' }
    ]
  };

  function readPath(root, path) {
    return path.split('.').reduce(function (node, key) { return node ? node[key] : undefined; }, root);
  }

  function writePath(root, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var node = keys.reduce(function (n, key) { return n[key]; }, root);
    node[last] = value;
  }

  /** スライダー 1 本を作る。値は触ったその場で config に入ります。 */
  function buildSetting(doc, config, spec) {
    var wrap = doc.createElement('label');
    wrap.className = 'setting';

    var name = doc.createElement('span');
    name.className = 'setting__label';
    name.textContent = spec.label;

    var input = doc.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(readPath(config, spec.path));

    var out = doc.createElement('output');
    out.className = 'setting__value';

    function paint() {
      out.textContent = input.value + (spec.unit ? ' ' + spec.unit : '');
    }
    paint();

    input.addEventListener('input', function () {
      writePath(config, spec.path, Number(input.value));
      paint();
    });

    wrap.appendChild(name);
    wrap.appendChild(input);
    wrap.appendChild(out);
    return wrap;
  }

  /**
   * @param {object} app  共有しているゲーム
   * @param {object} view 操作画面のプレビュー (音は鳴らしません)
   */
  function ControlPanel(app, view) {
    this.app = app;
    this.view = view;
    this.doc = global.document;
    /** 開いているゲームウィンドウ。閉じられたら null に戻します。 */
    this.gameWindow = null;

    this._buildSettings();
    this._bindWindow();
    this._bindAudio();
    this._bindGame();
  }

  ControlPanel.prototype._buildSettings = function () {
    var doc = this.doc;
    var config = this.app.config;

    Object.keys(SETTINGS).forEach(function (group) {
      var host = doc.querySelector('[data-setting-group="' + group + '"]');
      if (!host) return;
      SETTINGS[group].forEach(function (spec) {
        if (readPath(config, spec.path) === undefined) return;   // 無い設定は出さない
        host.appendChild(buildSetting(doc, config, spec));
      });
    });
  };

  // ------------------------------------------------------ ゲームウィンドウ

  /**
   * ゲーム画面を別ウィンドウで開く。
   *
   * **ゲームを 2 つ動かすわけではありません。** 開いた先は
   * window.opener.CB.app からこの画面のゲームを読み、それを描くだけです。
   * だから設定も接続もランキングも、両方の画面で必ず同じになります。
   */
  ControlPanel.prototype.openGameWindow = function () {
    if (this.gameWindow && !this.gameWindow.closed) {
      this.gameWindow.focus();
      return this.gameWindow;
    }

    // 9:16。1080×1920 は画面に入らないので、入る範囲でいちばん大きい 9:16 にします。
    var height = Math.max(480, Math.min(global.screen.availHeight - 60, 1280));
    var width = Math.round(height * 9 / 16);

    this.gameWindow = global.open('game.html', 'cb-game',
      'width=' + width + ',height=' + height + ',menubar=no,toolbar=no,location=no,status=no');

    this._paintWindowState();
    return this.gameWindow;
  };

  ControlPanel.prototype._paintWindowState = function () {
    var el = $('game-window-state');
    if (!el) return;

    if (this.gameWindow && !this.gameWindow.closed) {
      el.textContent = 'オープン中 – このウィンドウを閉じるとゲームも止まります';
      el.dataset.state = 'open';
    } else {
      el.textContent = 'ポップアップがブロックされた場合は、game.html を直接開いても同じ画面が出ます';
      el.dataset.state = 'closed';
    }
  };

  ControlPanel.prototype._bindWindow = function () {
    var self = this;
    var button = $('open-game');
    if (button) button.addEventListener('click', function () { self.openGameWindow(); });

    // 閉じられたことは通知されないので、たまに見にいきます。
    global.setInterval(function () {
      if (self.gameWindow && self.gameWindow.closed) self.gameWindow = null;
      self._paintWindowState();
    }, 1500);
    this._paintWindowState();
  };

  // ------------------------------------------------------------------ 音

  ControlPanel.prototype._bindAudio = function () {
    var self = this;
    var app = this.app;

    var mute = $('btn-mute');
    var sfxVolume = $('sfx-volume');
    var sfxOut = $('sfx-volume-out');
    var bgmVolume = $('bgm-volume');
    var bgmOut = $('bgm-volume-out');
    var bgmButton = $('btn-bgm');
    var bgmFile = $('bgm-file');
    var bgmName = $('bgm-name');

    // 表示は「今の設定」から作ります。どちらの画面で変えても揃います。
    app.onSettings(function (settings) {
      if (mute) {
        mute.textContent = settings.sfxEnabled ? 'SOUND ON' : 'SOUND OFF';
        mute.setAttribute('aria-pressed', String(settings.sfxEnabled));
      }
      if (sfxVolume && sfxVolume !== self.doc.activeElement) {
        sfxVolume.value = String(Math.round(settings.sfxVolume * 100));
      }
      if (sfxOut) sfxOut.textContent = Math.round(settings.sfxVolume * 100) + '%';
      if (bgmVolume && bgmVolume !== self.doc.activeElement) {
        bgmVolume.value = String(Math.round(settings.bgmVolume * 100));
      }
      if (bgmOut) bgmOut.textContent = Math.round(settings.bgmVolume * 100) + '%';
      if (bgmButton) bgmButton.textContent = settings.bgmPlaying ? 'STOP' : 'PLAY';
      if (bgmName) bgmName.textContent = settings.bgmName || 'ファイル未選択';
    });

    if (mute) {
      mute.addEventListener('click', function () {
        app.applySettings({ sfxEnabled: !app.settings.sfxEnabled });
      });
    }
    if (sfxVolume) {
      sfxVolume.addEventListener('input', function () {
        app.applySettings({ sfxVolume: Number(sfxVolume.value) / 100 });
      });
    }
    if (bgmVolume) {
      bgmVolume.addEventListener('input', function () {
        app.applySettings({ bgmVolume: Number(bgmVolume.value) / 100 });
      });
    }

    // 選んだ MP3 は blob: の URL にします。ファイルはどこにも送りません。
    if (bgmFile) {
      bgmFile.addEventListener('change', function () {
        var file = bgmFile.files && bgmFile.files[0];
        if (!file) return;
        if (app.settings.bgmUrl) global.URL.revokeObjectURL(app.settings.bgmUrl);
        app.applySettings({
          bgmUrl: global.URL.createObjectURL(file),
          bgmName: file.name,
          bgmPlaying: true
        });
      });
    }

    if (bgmButton) {
      bgmButton.addEventListener('click', function () {
        if (!app.settings.bgmUrl) {
          if (bgmName) bgmName.textContent = '先に MP3 を選んでください';
          return;
        }
        app.applySettings({ bgmPlaying: !app.settings.bgmPlaying });
      });
    }
  };

  // ------------------------------------------------------------ ゲーム設定

  ControlPanel.prototype._bindGame = function () {
    var self = this;

    var sort = $('sort-select');
    if (sort) {
      sort.value = this.app.leaderboard.sortBy;
      sort.addEventListener('change', function () {
        self.app.leaderboard.setSort(sort.value);
        self.view.renderer.renderRanking(true);
      });
    }

    var demo = $('demo-enabled');
    if (demo) {
      demo.checked = this.app.config.demo.enabled;
      demo.addEventListener('change', function () {
        self.app.config.demo.enabled = demo.checked;
      });
    }
  };

  global.CB = global.CB || {};
  global.CB.ControlPanel = ControlPanel;
})(window);
