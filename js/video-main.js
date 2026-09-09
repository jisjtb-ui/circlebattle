/**
 * video-main.js - VIDEO BATTLE MODE の起動と操作。
 *
 * ここだけが DOM を触ります。engine (video-battle) も音 (video-audio) も
 * 画面 (video-renderer) も、DOM を知りません。
 *
 * やっていることは 4 つだけです:
 *
 *   1. 部品を組み立てて毎フレーム回す
 *   2. 最初のクリックで音を鳴らせるようにする (ブラウザの決まり)
 *   3. 音量 / BGM / 録画のボタンを繋ぐ
 *   4. 決着したら少し待って次の試合へ (連続で撮るため)
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var CB = global.CB;

  function $(id) { return doc.getElementById(id); }

  /** 設定は次に開いたときも残します。撮り直すたびに合わせ直さないため。 */
  var STORE_KEY = 'cb.video.settings';

  function loadSettings() {
    try {
      return JSON.parse(global.localStorage.getItem(STORE_KEY)) || {};
    } catch (err) { return {}; }
  }

  function saveSettings(settings) {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (err) { /* 無視 */ }
  }

  function boot() {
    var config = CB.VIDEO_CONFIG;
    var clock = function () {
      return global.performance && global.performance.now ? global.performance.now() : Date.now();
    };

    var battle = new CB.VideoBattle({ config: config, now: clock });
    var audio = new CB.VideoAudio({ config: config, now: clock });
    var renderer = new CB.VideoRenderer({ battle: battle, canvas: $('field'), config: config, win: global });
    var recorder = new CB.VideoRecorder({ config: config, canvas: $('field'), audio: audio, doc: doc });
    new CB.VideoSoundDirector({ battle: battle, audio: audio, config: config });

    var settings = loadSettings();
    var state = {
      autoRematch: settings.autoRematch !== false,
      rematchAt: null
    };

    // ------------------------------------------------------------ 音量

    function bindVolume(id, outId, initial, apply) {
      var input = $(id);
      var out = $(outId);
      var value = initial;

      function show(v) {
        input.value = String(Math.round(v * 100));
        out.textContent = Math.round(v * 100) + '%';
      }

      input.addEventListener('input', function () {
        value = Number(input.value) / 100;
        apply(value);
        show(value);
        settings[id] = value;
        saveSettings(settings);
      });

      apply(value);
      show(value);
    }

    bindVolume('master-volume', 'master-out',
      settings['master-volume'] != null ? settings['master-volume'] : config.audio.master,
      function (v) { audio.setMasterVolume(v); });

    bindVolume('sfx-volume', 'sfx-out',
      settings['sfx-volume'] != null ? settings['sfx-volume'] : config.audio.sfx,
      function (v) { audio.setSfxVolume(v); });

    bindVolume('music-volume', 'music-out',
      settings['music-volume'] != null ? settings['music-volume'] : config.audio.music,
      function (v) { audio.setMusicVolume(v); });

    // -------------------------------------------------------- 音の解錠

    var muted = $('muted');
    audio.onBlocked(function (blocked) { muted.hidden = !blocked; });

    function unlock() {
      audio.resume().then(function () {
        var counts = audio.bank ? audio.bank.summary() : null;
        if (counts) {
          $('sound-source').textContent =
            'ファイル ' + counts.file + ' / 合成 ' + counts.synth +
            (counts.missing ? ' / 未取得 ' + counts.missing : '');
        }
      });
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      doc.addEventListener(type, unlock, { once: false });
    });

    var soundButton = $('btn-sound');
    soundButton.addEventListener('click', function () {
      var on = audio.setEnabled(!audio.enabled);
      soundButton.textContent = on ? 'SOUND ON' : 'SOUND OFF';
      soundButton.setAttribute('data-off', on ? 'false' : 'true');
    });

    // ------------------------------------------------------------ BGM

    var bgm = new global.Audio();
    bgm.loop = true;
    var bgmButton = $('btn-bgm');

    $('bgm-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      bgm.src = global.URL.createObjectURL(file);
      $('bgm-name').textContent = file.name;
      // music バスを通すと、効果音と同じミキサーに乗り、録画にも入ります
      audio.attachMusic(bgm);
    });

    bgmButton.addEventListener('click', function () {
      if (!bgm.src) return;
      audio.attachMusic(bgm);
      if (bgm.paused) { bgm.play(); bgmButton.textContent = 'PAUSE'; }
      else { bgm.pause(); bgmButton.textContent = 'PLAY'; }
    });

    // ---------------------------------------------------------- 試合

    var startButton = $('btn-start');
    startButton.addEventListener('click', function () {
      unlock();
      battle.reset(clock());
      state.rematchAt = null;
    });

    var autoInput = $('auto-rematch');
    autoInput.checked = state.autoRematch;
    autoInput.addEventListener('change', function () {
      state.autoRematch = autoInput.checked;
      settings.autoRematch = state.autoRematch;
      saveSettings(settings);
    });

    battle.on('ko', function (ko) {
      $('result').textContent = 'WINNER  ' + ko.winner.name;
      state.rematchAt = ko.at + 6000;
    });

    // ---------------------------------------------------------- 録画

    var recordButton = $('btn-record');
    var recordState = $('record-state');

    if (!recorder.supported) {
      recordButton.disabled = true;
      recordState.textContent = 'このブラウザでは録画できません';
    }

    recordButton.addEventListener('click', function () {
      unlock();
      if (recorder.recording()) {
        recordButton.textContent = 'REC';
        recordButton.removeAttribute('data-live');
        recordState.textContent = '書き出し中…';
        recorder.stop().then(function (blob) {
          var name = recorder.save(blob);
          recordState.textContent = name ? '保存しました: ' + name : '保存できませんでした';
        });
        return;
      }

      // 音を先に起こしておかないと、無音のトラックが乗ります
      audio.resume().then(function () {
        if (!recorder.start()) { recordState.textContent = '録画を開始できませんでした'; return; }
        recordButton.textContent = 'STOP';
        recordButton.setAttribute('data-live', 'true');
      });
    });

    // -------------------------------------------------- 操作パネルの開閉

    var panelButton = $('btn-panel');
    panelButton.addEventListener('click', function () {
      var hidden = doc.body.getAttribute('data-panel') === 'off';
      doc.body.setAttribute('data-panel', hidden ? 'on' : 'off');
      panelButton.textContent = hidden ? 'HIDE UI' : 'SHOW UI';
    });

    // 配信 / 録画のときは H でパネルを消せます
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'h' || event.key === 'H') panelButton.click();
      if (event.key === 'r' || event.key === 'R') startButton.click();
    });

    /*
     * 組み立てたものを覗けるようにしておきます。開発中に
     * `CB.video.battle.fighters.red.hp = 50` のように状態を作れると、
     * 決着まわりの見え方を確かめるのに 1 分もかかりません。
     */
    global.CB.video = { battle: battle, audio: audio, renderer: renderer, recorder: recorder };

    // ------------------------------------------------------------ loop

    battle.start(clock());

    function frame() {
      var now = clock();

      battle.update(now);
      renderer.draw(now);

      if (recorder.recording()) {
        recordState.textContent = 'REC ' + recorder.elapsed().toFixed(1) + 's';
      }

      // 決着したら少し見せてから次の試合へ
      if (state.rematchAt != null && now >= state.rematchAt) {
        state.rematchAt = null;
        if (state.autoRematch) {
          $('result').textContent = '';
          battle.reset(now);
        }
      }

      global.requestAnimationFrame(frame);
    }

    global.requestAnimationFrame(frame);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
