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

    /** userId -> まだレベルになっていない LIKE の端数。 */
    this.likeBuckets = {};
    /** userId -> user。順番待ちの円を出すときに、名前とアイコンが要ります。 */
    this.users = {};
    /**
     * userId -> { circleId, joined, queue }
     *   circleId … いま育てている円
     *   joined   … 入室ボーナスを渡したか
     *   queue    … 順番待ちの円 (レベルの配列)。テトリスの NEXT と同じです。
     */
    this.players = {};
    /** 本物の視聴者イベントを受け取ったか (デモを止める判断に使う)。 */
    this.realEventSeen = false;

    this.stats = { likes: 0, follows: 0, shares: 0, gifts: 0, joins: 0, comments: 0, circles: 0 };
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

    // 円が 1 つ減ったら、その人の順番待ちから次を出します
    this.engine.on('circle:removed', function (removed) {
      self._releaseQueued(removed.circle.ownerId, removed.reason, self.now());
    });
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

  // ------------------------------------------------------------ レベル

  GameSession.prototype._player = function (userId) {
    return this.players[userId] ||
      (this.players[userId] = { circleId: null, joined: false, queue: [] });
  };

  /**
   * 円を出す。フィールドがその人の上限で埋まっていたら順番待ちに積みます。
   *
   * 押し出して入れ替えないのは、せっかく育てた円が新しい円のせいで消えるのを
   * 避けるためです。列も埋まっているときは、列の最後の円を強くします
   * (送ったぶんが消えてなくなることはありません)。
   *
   * @returns {object|null} 出せた円。順番待ちになった場合は null
   */
  GameSession.prototype._spawnOrQueue = function (user, spec) {
    var limits = this.config.viewers.limits;
    var player = this._player(user.id);

    if (this.engine.circleCountOf(user.id) < limits.maxPerUser) {
      return this.spawnFor(user, spec);
    }

    var max = this.config.viewers.levels.max;
    if (player.queue.length < limits.queue) {
      player.queue.push({ level: Math.min(spec.level, max), sourceEvent: spec.sourceEvent });
    } else {
      // 列も満杯。最後の円に足して強くする
      var last = player.queue[player.queue.length - 1];
      last.level = Math.min(last.level + spec.level, max);
    }

    this._syncQueue(user, spec.at);
    this.emit('queued', {
      user: user, level: spec.level, sourceEvent: spec.sourceEvent,
      waiting: player.queue.length, at: spec.at
    });
    return null;
  };

  /** 順番待ちの数をランキングへ伝える (画面に「+2」と出ます)。 */
  GameSession.prototype._syncQueue = function (user, at) {
    if (!this.leaderboard) return;
    this.leaderboard.setQueue(user, this._player(user.id).queue.length, at);
  };

  /**
   * 円が減った人の列から 1 つ出す。
   *
   * フィールドが全体の上限で埋まって押し出された場合 ('evicted') は出しません。
   * 出したそばからまた押し出されて、他の人の円を巻き添えにするためです。
   */
  GameSession.prototype._releaseQueued = function (ownerId, reason, at) {
    if (reason === 'evicted') return null;

    var player = this.players[ownerId];
    if (!player || !player.queue.length) return null;
    if (this.engine.circleCountOf(ownerId) >= this.config.viewers.limits.maxPerUser) return null;

    var next = player.queue.shift();
    var user = this.users[ownerId];
    if (!user) return null;

    var circle = this.spawnFor(user, {
      level: next.level,
      sourceEvent: next.sourceEvent,
      at: at
    });
    this._syncQueue(user, at);
    return circle;
  };

  /**
   * レベルを上げる。ここがこのゲームの中心です。
   *
   *   1. その人がいま育てている円があれば、その円を育てる
   *   2. 無ければ (まだ 1 つも無い / 力尽きた) 新しい円を作る
   *   3. 上限 (100) の円しか無ければ、その円はそのままにして新しい円を作る
   *
   * 3 の新しい円は「その行動ぶんのレベル」で生まれます。
   * 10 LIKE なら 1 レベル、50 コインのギフトなら 50 レベルです。
   *
   * @returns {object|null} 育てた / 作った円
   */
  GameSession.prototype.gainLevels = function (user, levels, sourceEvent, at) {
    var gained = Math.max(0, Math.floor(levels));
    if (!gained) return null;

    var player = this._player(user.id);
    var circle = player.circleId ? this.engine.circleOf(user.id, player.circleId) : null;
    var max = this.config.viewers.levels.max;

    if (circle && circle.level < max) {
      var before = circle.level;
      this.engine.levelUp(circle, gained, at);
      if (this.leaderboard) this.leaderboard.setLevel(user, circle.level, at);
      this.emit('levelup', {
        user: user, circle: circle, from: before, to: circle.level,
        sourceEvent: sourceEvent, at: at
      });
      return circle;
    }

    // 円が無い / 上限に達している -> 新しい円を作る (満員なら順番待ち)
    return this._spawnOrQueue(user, {
      level: this.config.viewers.levels.restartAtActionLevel ? gained : 1,
      sourceEvent: sourceEvent,
      at: at
    });
  };

  /**
   * 新しい円を 1 つ作って、その人の「育てている円」にする。
   */
  GameSession.prototype.spawnFor = function (user, spec) {
    var circle = this.engine.spawnCircle({
      ownerId: user.id,
      ownerName: user.uniqueId,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl,
      sourceEvent: spec.sourceEvent,
      level: spec.level,
      demo: Boolean(user.demo)
    }, spec.at);

    this._player(user.id).circleId = circle.id;
    this.stats.circles += 1;

    if (this.leaderboard) this.leaderboard.setLevel(user, circle.level, spec.at);

    this.emit('spawn', {
      user: user,
      sourceEvent: spec.sourceEvent,
      count: 1,
      level: circle.level,
      circle: circle,
      circles: [circle]
    });
    return circle;
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

    this.users[user.id] = user;

    if (!user.demo && !this.realEventSeen) {
      this.realEventSeen = true;
      this.emit('real-event', event);
    }

    switch (event.type) {
      case 'LIKE':   return this._onLike(user, event, at);
      case 'FOLLOW': return this._onFollow(user, event, at);
      case 'SHARE':  return this._onShare(user, event, at);
      case 'GIFT':   return this._onGift(user, event, at);
      case 'JOIN':   return this._onJoin(user, event, at);
      case 'COMMENT': return this._onComment(user, event, at);
      default: return null;
    }
  };

  /**
   * LIKE: 10 いいねで 1 レベル。
   *
   * 端数はユーザーごとに持ち越します。7 + 5 = 12 で 1 レベル上がり、
   * 2 が次へ残ります。「まとめて 100 LIKE」なら一度に 10 レベルです。
   */
  GameSession.prototype._onLike = function (user, event, at) {
    var levels = this.config.viewers.levels;
    var count = Math.max(1, Math.floor(event.count || 1));
    this.stats.likes += count;

    var bucket = (this.likeBuckets[user.id] || 0) + count;
    var gained = Math.floor(bucket / levels.likesPerLevel);
    this.likeBuckets[user.id] = bucket - gained * levels.likesPerLevel;

    if (this.leaderboard) this.leaderboard.touch(user, at);
    if (!gained) return null;

    return this.gainLevels(user, gained, 'LIKE', at);
  };

  GameSession.prototype._onFollow = function (user, event, at) {
    this.stats.follows += 1;
    return this.gainLevels(user, this.config.viewers.levels.follow, 'FOLLOW', at);
  };

  GameSession.prototype._onShare = function (user, event, at) {
    this.stats.shares += 1;
    return this.gainLevels(user, this.config.viewers.levels.share, 'SHARE', at);
  };

  /**
   * GIFT: コイン価値 -> レベル。
   *
   * ギフトの名前も ID も見ません。価値の数字だけを見るので、
   * 新しいギフトが増えても何もしなくて済みます。
   */
  GameSession.prototype._onGift = function (user, event, at) {
    this.stats.gifts += 1;
    var levels = this.engine.levelsFromGift(event.value);
    return this.gainLevels(user, levels, 'GIFT', at);
  };

  /**
   * JOIN (入室): 最初の 1 回だけ、レベル 20 の円をもらえます。
   *
   * 2 回目以降は何も起きません。入り直すだけで何度ももらえると、
   * 見ている人より出入りした人が得をしてしまうためです。
   */
  GameSession.prototype._onJoin = function (user, event, at) {
    var levels = this.config.viewers.levels;
    var player = this._player(user.id);

    this.stats.joins += 1;
    if (this.leaderboard) this.leaderboard.touch(user, at);

    if (levels.joinOncePerUser && player.joined) return null;
    player.joined = true;

    return this._spawnOrQueue(user, { level: levels.join, sourceEvent: 'JOIN', at: at });
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

  /** LIKE の端数と、誰がどの円を育てているかを消す (次の配信を始めるときなど)。 */
  GameSession.prototype.reset = function () {
    this.likeBuckets = {};
    this.players = {};
    this.users = {};
    this.realEventSeen = false;
    return this;
  };

  global.CB = global.CB || {};
  global.CB.GameSession = GameSession;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameSession: GameSession };
  }
})(typeof window !== 'undefined' ? window : this);
