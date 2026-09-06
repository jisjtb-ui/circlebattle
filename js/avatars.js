/**
 * avatars.js - プロフィール画像のキャッシュ。
 *
 * 同じユーザーの画像を毎フレーム取りに行かないための置き場です。
 *
 *   avatars.get(url)  ->  読み込み済みなら Image、まだなら null (読み込みを開始)
 *
 * 失敗した URL は覚えておいて二度と取りに行きません。
 * 取れなかったユーザーは、描画側が既定のアイコン (頭文字) を描きます。
 */
(function (global) {
  'use strict';

  var LOADING = 'loading';
  var READY = 'ready';
  var FAILED = 'failed';

  /**
   * @param {object} [options] { max } 覚えておく枚数の上限
   */
  function AvatarCache(options) {
    options = options || {};
    this.max = options.max || 400;
    this.entries = {};        // url -> { status, image, usedAt }
    this.stats = { hits: 0, misses: 0, loaded: 0, failed: 0 };
  }

  /**
   * 画像を返す。まだ読み込めていなければ null を返し、裏で読み込みを始めます。
   * 呼ぶ側は「null ならデフォルトアイコン」とだけ考えれば済みます。
   */
  AvatarCache.prototype.get = function (url) {
    if (!url) return null;

    var entry = this.entries[url];
    if (entry) {
      entry.usedAt = Date.now();
      if (entry.status === READY) { this.stats.hits += 1; return entry.image; }
      return null;                       // 読み込み中 / 失敗
    }

    this.stats.misses += 1;
    this._load(url);
    return null;
  };

  AvatarCache.prototype._load = function (url) {
    var self = this;
    this._evictIfNeeded();

    var entry = this.entries[url] = { status: LOADING, image: null, usedAt: Date.now() };

    if (typeof global.Image !== 'function') { entry.status = FAILED; return; }

    var image = new global.Image();
    // crossOrigin は付けません。canvas に描くだけで画素は読み返さないため、
    // CORS ヘッダーの無い TikTok の CDN でもそのまま描けます。
    image.onload = function () {
      entry.status = READY;
      entry.image = image;
      self.stats.loaded += 1;
    };
    image.onerror = function () {
      entry.status = FAILED;
      self.stats.failed += 1;
    };
    image.src = url;
  };

  /** 上限を超えたら、長く使われていないものから捨てる。 */
  AvatarCache.prototype._evictIfNeeded = function () {
    var keys = Object.keys(this.entries);
    if (keys.length < this.max) return;

    keys.sort(function (a, b) {
      return this.entries[a].usedAt - this.entries[b].usedAt;
    }.bind(this));

    var drop = Math.max(1, Math.floor(this.max * 0.2));
    for (var i = 0; i < drop && i < keys.length; i += 1) delete this.entries[keys[i]];
  };

  AvatarCache.prototype.clear = function () {
    this.entries = {};
    return this;
  };

  global.CB = global.CB || {};
  global.CB.AvatarCache = AvatarCache;
})(typeof window !== 'undefined' ? window : this);
