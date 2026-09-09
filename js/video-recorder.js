/**
 * video-recorder.js - 画面と**ゲーム音**をまとめて 1 本の動画にする。
 *
 * 撮るのは canvas だけです (HTML で重ねたものは写りません)。だから
 * HP バーも WINNER も canvas に描いてあります。音は video-audio.js の
 * 出口 (リミッターの後) から取るので、効果音・ヒット音・勝利音まで
 * すべて同じバランスのまま動画に入ります。
 *
 * 出てくるのは webm です。ブラウザが対応している中で一番良いものを選びます。
 */
(function (global) {
  'use strict';

  function VideoRecorder(options) {
    options = options || {};
    this.config = options.config || (global.CB && global.CB.VIDEO_CONFIG);
    this.settings = this.config.record;
    this.canvas = options.canvas;
    this.audio = options.audio;
    this.doc = options.doc || global.document;

    this.recorder = null;
    this.chunks = [];
    this.startedAt = null;
    this.supported = typeof global.MediaRecorder === 'function' &&
                     Boolean(this.canvas && this.canvas.captureStream);
  }

  /** ブラウザが受け付ける形式のうち、一番良いもの。 */
  VideoRecorder.prototype.mimeType = function () {
    var types = this.settings.mimeTypes;
    for (var i = 0; i < types.length; i += 1) {
      if (!global.MediaRecorder.isTypeSupported ||
          global.MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  };

  VideoRecorder.prototype.recording = function () {
    return Boolean(this.recorder && this.recorder.state === 'recording');
  };

  /** 撮り始める。音のトラックは毎回取り直します (途中で音を出し始めた場合のため)。 */
  VideoRecorder.prototype.start = function () {
    if (!this.supported || this.recording()) return false;

    var stream = this.canvas.captureStream(this.settings.fps);
    var tracks = this.audio ? this.audio.streamTracks() : [];
    tracks.forEach(function (track) { stream.addTrack(track); });

    var options = {
      videoBitsPerSecond: this.settings.videoBitsPerSecond,
      audioBitsPerSecond: this.settings.audioBitsPerSecond
    };
    var mime = this.mimeType();
    if (mime) options.mimeType = mime;

    try {
      this.recorder = new global.MediaRecorder(stream, options);
    } catch (err) {
      this.recorder = null;
      return false;
    }

    var self = this;
    this.chunks = [];
    this.recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) self.chunks.push(event.data);
    };
    this.recorder.start(1000);       // 1 秒ごとに書き出す (長く撮っても落ちにくい)
    this.startedAt = Date.now();
    return true;
  };

  /** 撮り終える。出来上がった動画 (Blob) を返します。 */
  VideoRecorder.prototype.stop = function () {
    if (!this.recording()) return Promise.resolve(null);

    var self = this;
    return new Promise(function (resolve) {
      self.recorder.onstop = function () {
        var type = self.recorder.mimeType || 'video/webm';
        var blob = new Blob(self.chunks, { type: type });
        self.chunks = [];
        self.recorder = null;
        self.startedAt = null;
        resolve(blob);
      };
      self.recorder.stop();
    });
  };

  /** 撮った動画を保存する。 */
  VideoRecorder.prototype.save = function (blob, name) {
    if (!blob || !this.doc) return null;
    var url = global.URL.createObjectURL(blob);
    var link = this.doc.createElement('a');
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    link.href = url;
    link.download = (name || this.settings.fileName) + '-' + stamp + '.webm';
    this.doc.body.appendChild(link);
    link.click();
    this.doc.body.removeChild(link);

    // すぐ revoke するとダウンロードが始まる前に消えることがあります
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 30000);
    return link.download;
  };

  /** 撮っている長さ (秒)。 */
  VideoRecorder.prototype.elapsed = function () {
    if (!this.startedAt) return 0;
    return (Date.now() - this.startedAt) / 1000;
  };

  global.CB = global.CB || {};
  global.CB.VideoRecorder = VideoRecorder;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoRecorder: VideoRecorder };
  }
})(typeof window !== 'undefined' ? window : this);
