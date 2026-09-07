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
   * @param {object} [options] { max, size } 覚えておく枚数の上限と、丸く切った画像の大きさ
   */
  function AvatarCache(options) {
    options = options || {};
    this.max = options.max || 400;
    /**
     * 丸く切り抜いた画像を作っておく大きさ (px)。
     * 画面に出る円は最大でも 100px 程度なので、これで足ります。
     */
    this.size = options.size || 128;
    this.entries = {};        // url -> { status, image, masked, usedAt }
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
      if (entry.status === READY) { this.stats.hits += 1; return entry.masked || entry.image; }
      return null;                       // 読み込み中 / 失敗
    }

    this.stats.misses += 1;
    this._load(url);
    return null;
  };

  /**
   * 丸く切り抜いた画像を 1 枚だけ作っておく。
   *
   * 描くたびに円で切り抜く (ctx.clip) と、円が数百個あるフレームでは
   * それだけで重くなります。最初に 1 回だけ切り抜いておけば、
   * あとは切り抜き済みの絵を貼るだけで済みます。
   */
  AvatarCache.prototype._mask = function (image) {
    if (typeof document === 'undefined' || !document.createElement) return null;

    var size = this.size;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();

    // 正方形でない画像でも顔が伸びないよう、短い辺で中央を切り出す
    var iw = image.naturalWidth || image.width || size;
    var ih = image.naturalHeight || image.height || size;
    var side = Math.min(iw, ih);
    ctx.drawImage(image, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, size, size);
    return canvas;
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
      entry.masked = self._mask(image);
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
