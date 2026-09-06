/**
 * game-session.js - ゲームイベントをバトルへつなぐ層。
 *
 *   Game Event  ->  GameSession  ->  BattleEngine (円を出す)
 *                              \->  Leaderboard  (点を入れる)
 *
 * ここが持つルールは 2 つだけです。
 *
 *   1. どのイベントで、どれだけの強さの円を何個出すか
 *   2. 敵を倒したポイントを誰に配るか (LAST HIT / ダメージ配分)
 *
 * TikTok の語彙 (giftId, diamondCount, ...) はここには届きません。
 * 届くのは event-router.js が翻訳した LIKE / FOLLOW / SHARE / GIFT / COMMENT だけです。
 *
 * 1 LIVE = 1 セッション。複数 LIVE を受けるときはセッションを増やして
 * router.attach(liveId, session) します。
 */
(function (global) {
  'use strict';

  function GameSession(engine, options) {
    options = options || {};
    this.engine = engine;
    this.config = options.config || (global.CB && global.CB.CONFIG);
    if (!this.config) throw new Error('GameSession: config が渡されていません');

    this.leaderboard = options.leaderboard || null;
    this.now = options.now || function () { return Date.now(); };
    this.liveId = options.liveId || 'live-1';

    /** userId -> まだ円になっていない LIKE の端数。 */
    this.likeBuckets = {};
    /** 本物の視聴者イベントを受け取ったか (デモを止める判断に使う)。 */
    this.realEventSeen = false;

    this.stats = { likes: 0, follows: 0, shares: 0, gifts: 0, comments: 0, circles: 0 };
    this._listeners = {};

    this._wireEngine();
  }

  // ------------------------------------------------------------- events

  GameSession.prototype.on = function (name, handler) {
    (this._listeners[name] || (this._listeners[name] = [])).push(handler);
    return this;
  };

  GameSession.prototype.emit = function (name, payload) {
    var handlers = this._listeners[name];
    if (!handlers) return;
    handlers.slice().forEach(function (handler) { handler(payload); });
  };

  // ------------------------------------------------------------ scoring

  /**
   * エンジンからの通知をランキングへ流す。
   *
   * エンジンは点の配り方を知りません。「誰がどれだけ削ったか」だけを持ってくるので、
   * それを LAST HIT にするか山分けにするかはここで決めます。
   */
  GameSession.prototype._wireEngine = function () {
    var self = this;
    if (!this.engine) return;

    this.engine.on('damage', function (hit) {
      if (!self.leaderboard || !self._creditable(hit.owner)) return;
      var scoring = self.config.scoring;
      var owner = self._ownerOf(hit.owner);
      self.leaderboard.addDamage(owner, hit.amount, hit.at);
      if (scoring.pointsPerDamage > 0) {
        self.leaderboard.addScore(owner, hit.amount * scoring.pointsPerDamage, hit.at);
      }
    });

    this.engine.on('enemy:killed', function (kill) { self._award(kill); });
  };

  /**
   * この貢献に点を入れてよいか。
   *
   * 本物の視聴者が現れたあと、まだ引き上げ切れていない仮視聴者の円が
   * 敵を倒すことがあります。そのぶんを入れるとランキングに仮の名前が
   * 復活してしまうので、加点だけ止めます (円はそのまま動き続けます)。
   */
  GameSession.prototype._creditable = function (contribution) {
    if (!contribution || !contribution.demo) return true;
    return !(this.realEventSeen && this.config.demo.clearOnRealEvent);
  };

  /** contribution / lastHit を Leaderboard が受け取れる形にする。 */
  GameSession.prototype._ownerOf = function (contribution) {
    return {
      id: contribution.ownerId,
      uniqueId: contribution.ownerName,
      displayName: contribution.displayName || contribution.ownerName,
      profileImageUrl: contribution.profileImageUrl || null,
      demo: Boolean(contribution.demo)
    };
  };

  /**
   * 撃破ポイントを配る。
   *
   *   mode 'lastHit' … とどめを刺した 1 人が全部取る (初期実装)
   *   mode 'damage'  … 与えたダメージの割合で分ける
   *
   * KILL 数は必ず 1 人にだけ付きます (割ると整数でなくなるため)。
   * 誰に付けるかは scoring.killCredit で選べます。
   */
  GameSession.prototype._award = function (kill) {
    if (!this.leaderboard) { this.emit('kill', kill); return; }

    var scoring = this.config.scoring;
    var points = kill.points || 0;
    var self = this;

    // 点を入れられない貢献 (引き上げ中の仮視聴者) はここで落とす
    var contributions = (kill.contributions || []).filter(function (c) { return self._creditable(c); });

    var credited = this._creditable(kill.lastHit) ? kill.lastHit : null;
    if (scoring.killCredit === 'topDamage' && contributions.length) {
      credited = contributions.reduce(function (best, c) {
        return !best || c.damage > best.damage ? c : best;
      }, null);
    }
    if (!credited && contributions.length) credited = contributions[0];
    if (!credited) { this.emit('kill', kill); return; }

    if (scoring.mode === 'damage' && contributions.length) {
      var total = contributions.reduce(function (sum, c) { return sum + c.damage; }, 0) || 1;

      contributions.forEach(function (c) {
        var share = c.damage / total;
        if (share < scoring.minShare) return;
        var owner = self._ownerOf(c);
        if (c.ownerId === credited.ownerId) {
          // とどめの人には KILL 数と自分のぶんのポイントを同時に入れる
          self.leaderboard.addKill(owner, points * share, 1, kill.at);
        } else {
          self.leaderboard.addScore(owner, points * share, kill.at);
        }
      });
      // 貢献が小さすぎて誰も KILL を受け取れなかった場合の保険
      if (credited.damage / total < scoring.minShare) {
        this.leaderboard.addKill(this._ownerOf(credited), points, 1, kill.at);
      }
    } else {
      this.leaderboard.addKill(this._ownerOf(credited), points, 1, kill.at);
    }

    this.emit('kill', kill);
  };

  // ------------------------------------------------------------- 円を出す

  /**
   * 円を出す共通の入口。
   * イベントごとの違いは「何個」「どれだけの強さ」だけです。
   */
  GameSession.prototype.spawnFor = function (user, spec) {
    var count = Math.max(0, Math.floor(spec.count));
    if (!count) return [];

    var created = [];
    for (var i = 0; i < count; i += 1) {
      created.push(this.engine.spawnCircle({
        ownerId: user.id,
        ownerName: user.uniqueId,
        displayName: user.displayName,
        profileImageUrl: user.profileImageUrl,
        sourceEvent: spec.sourceEvent,
        strength: spec.strength,
        demo: Boolean(user.demo)
      }, spec.at));
    }

    this.stats.circles += created.length;
    if (this.leaderboard) this.leaderboard.touch(user, spec.at);

    this.emit('spawn', {
      user: user,
      sourceEvent: spec.sourceEvent,
      count: created.length,
      strength: spec.strength,
      circles: created
    });
    return created;
  };

  // ------------------------------------------------------------ handle

  /**
   * ゲームイベントを 1 件受け取る。EventRouter から呼ばれます。
   *
   * @param {object} event { type:'LIKE'|'FOLLOW'|'SHARE'|'GIFT'|'COMMENT', user, ... }
   */
  GameSession.prototype.handle = function (event) {
    if (!event || !event.user) return null;

    var user = event.user;
    var at = event.at != null ? event.at : this.now();

    if (!user.demo && !this.realEventSeen) {
      this.realEventSeen = true;
      this.emit('real-event', event);
    }

    switch (event.type) {
      case 'LIKE':   return this._onLike(user, event, at);
      case 'FOLLOW': return this._onFollow(user, event, at);
      case 'SHARE':  return this._onShare(user, event, at);
      case 'GIFT':   return this._onGift(user, event, at);
      case 'COMMENT': return this._onComment(user, event, at);
      default: return null;
    }
  };

  /**
   * LIKE: 10 LIKE ごとに弱い円が 1 個。
   *
   * 端数はユーザーごとに持ち越します。7 LIKE + 5 LIKE = 12 で 1 個出て、
   * 2 が次へ残ります。「まとめて 100 LIKE」なら 10 個まとめて出ます。
   */
  GameSession.prototype._onLike = function (user, event, at) {
    var like = this.config.viewers.like;
    var count = Math.max(1, Math.floor(event.count || 1));
    this.stats.likes += count;

    var bucket = (this.likeBuckets[user.id] || 0) + count;
    var milestones = Math.floor(bucket / like.perCircle);
    this.likeBuckets[user.id] = bucket - milestones * like.perCircle;

    var circles = Math.min(milestones * like.circlesPerMilestone, like.maxPerEvent);
    if (this.leaderboard) this.leaderboard.touch(user, at);
    if (!circles) return [];

    return this.spawnFor(user, {
      count: circles,
      strength: like.strength,
      sourceEvent: 'LIKE',
      at: at
    });
  };

  GameSession.prototype._onFollow = function (user, event, at) {
    var follow = this.config.viewers.follow;
    this.stats.follows += 1;
    return this.spawnFor(user, {
      count: follow.circles,
      strength: follow.strength,
      sourceEvent: 'FOLLOW',
      at: at
    });
  };

  GameSession.prototype._onShare = function (user, event, at) {
    var share = this.config.viewers.share;
    this.stats.shares += 1;
    return this.spawnFor(user, {
      count: share.circles,
      strength: share.strength,
      sourceEvent: 'SHARE',
      at: at
    });
  };

  /**
   * GIFT: コイン価値 -> 強さ。
   *
   *   strength = baseStrength + coins * strengthPerCoin
   *
   * ギフトの名前も ID も見ません。価値の数字だけを見るので、
   * 新しいギフトが増えても何もしなくて済みます。
   */
  GameSession.prototype._onGift = function (user, event, at) {
    var gift = this.config.viewers.gift;
    var coins = Math.max(0, Number(event.value) || 0);
    this.stats.gifts += 1;

    var strength = gift.baseStrength + coins * gift.strengthPerCoin;
    return this.spawnFor(user, {
      count: gift.circles,
      strength: strength,
      sourceEvent: 'GIFT',
      at: at
    });
  };

  /**
   * COMMENT: 今回のゲームでは何も起こしません。
   *
   * チーム分けは無いのでコメントで参加させることもしません。
   * 将来コマンド (例: 「!attack」で特殊攻撃) を足せるように、
   * イベントとして受け取れる形だけ残しています。
   */
  GameSession.prototype._onComment = function (user, event, at) {
    this.stats.comments += 1;
    if (this.leaderboard) this.leaderboard.touch(user, at);
    this.emit('comment', { user: user, text: event.text, at: at });
    return null;
  };

  /** LIKE の端数だけを消す (次の配信を始めるときなど)。 */
  GameSession.prototype.reset = function () {
    this.likeBuckets = {};
    this.realEventSeen = false;
    return this;
  };

  global.CB = global.CB || {};
  global.CB.GameSession = GameSession;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameSession: GameSession };
  }
})(typeof window !== 'undefined' ? window : this);
