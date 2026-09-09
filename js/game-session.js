/**
 * game-session.js - ゲームイベントをバトルへつなぐ層。
 *
 *   Game Event  ->  GameSession  ->  BattleEngine (円を出す)
 *                              \->  Leaderboard  (点を入れる)
 *
 * ここが持つルールは 3 つだけです。
 *
 *   1. どのイベントで、どの力が増えるか (いいね→HP / ギフト→攻撃力 /
 *      シェア→ドレイン / フォロー→スパイク)
 *   2. 敵を倒したポイントを誰に配るか (LAST HIT / ダメージ配分)
 *   3. 視聴者どうしの撃破を誰に付けるか
 *
 * **円は 1 人 1 つだけ**です。行動しても増えず、その 1 つが強くなります。
 * 倒されて消えても、貯めた力は人のほうに残るので、次の行動で同じ強さのまま
 * もう一度撃ち出されます。
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

    /** userId -> まだ 1 ポイントに届いていない LIKE の端数。 */
    this.likeBuckets = {};
    /** userId -> user。順番待ちの円を出すときに、名前とアイコンが要ります。 */
    this.users = {};
    /**
     * userId -> { circleId, joined, followed, points, queue }
     *   circleId … いま持っている円
     *   joined   … 入室ぶんを渡したか
     *   followed … フォローぶん (スパイク) を渡したか
     *   points   … **貯めた力**。円が倒されても残ります
     *   queue    … 順番待ち。1 人 1 つになったので普段は使いません
     */
    this.players = {};
    /** 本物の視聴者イベントを受け取ったか (デモを止める判断に使う)。 */
    this.realEventSeen = false;
    /** userId -> { count, at } 連続撃破。短い間に続けて倒すと伸びます。 */
    this.combos = {};
    /**
     * 円を撃ち出す大砲 (js/cannon.js)。付いていれば、円の生成はすべて
     * そこを通ります。付いていなければ今までどおりその場で生成します
     * (テストや、演出を使わない構成のため)。
     */
    this.launcher = options.launcher || null;

    this.stats = { likes: 0, follows: 0, shares: 0, gifts: 0, joins: 0, comments: 0, circles: 0 };
    this._listeners = {};

    this._wireEngine();
  }

  // ------------------------------------------------------------- events

  GameSession.prototype.on = function (name, handler) {
    (this._listeners[name] || (this._listeners[name] = [])).push(handler);
    return this;
  };

  /**
   * 購読をやめる。
   *
   * 画面は 2 つ (操作画面 / ゲームウィンドウ) あり、ゲームウィンドウは
   * 閉じられます。閉じた画面の handler を残したままにすると、
   * 既に無いウィンドウの音や DOM を触りにいってエラーになります。
   */
  GameSession.prototype.off = function (name, handler) {
    var handlers = this._listeners[name];
    if (!handlers) return this;
    var i = handlers.indexOf(handler);
    if (i !== -1) handlers.splice(i, 1);
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

    // 円が 1 つ減ったら、その人の順番待ちから次を出します。
    // 他の人の円に倒されたのなら、倒したほうへポイントを入れます。
    this.engine.on('circle:removed', function (removed) {
      var at = self.now();
      self._awardPvp(removed, at);
      self._releaseQueued(removed.circle.ownerId, removed.reason, at);
    });
  };

  /**
   * 視聴者どうしの撃破にポイントを入れる。
   *
   * **入るのは相手が貯めたぶんに比例した点**です。固定にすると、入りたての
   * 円を狩り続けるのがいちばん効率のいい戦い方になってしまいます。
   * 強い相手を倒したときだけ大きく入るので、狩る旨みがありません。
   */
  GameSession.prototype._awardPvp = function (removed, at) {
    var pvp = this.config.viewers.pvp;
    if (!pvp || !pvp.enabled || !removed.by) return null;

    var killer = this.users[removed.by.ownerId];
    if (!killer) return null;
    if (!this._creditable({ demo: removed.by.demo, ownerId: removed.by.ownerId })) return null;

    var points = Math.max(pvp.minPoints,
      Math.round(removed.circle.power * pvp.pointsPerVictimPoint));

    if (this.leaderboard) this.leaderboard.addKill(killer, points, 1, at);
    this.emit('ko', {
      killer: killer, victim: removed.circle, points: points, at: at
    });
    return points;
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
  /**
   * 連続撃破を数える。
   *
   * 短い間に続けて倒すほど伸び、途切れると 1 に戻ります。
   * 倍率は控えめ (最大 +100%) にしてあります。ここで一気に逆転できてしまうと、
   * こつこつ育てた人の積み上げが軽くなるためです。
   *
   * @returns {object} { count, bonus }
   */
  GameSession.prototype._combo = function (ownerId, at) {
    var combo = this.config.combo;
    if (!combo || !combo.enabled) return { count: 1, bonus: 0 };

    var current = this.combos[ownerId];
    var count = (current && at - current.at <= combo.windowMs) ? current.count + 1 : 1;
    this.combos[ownerId] = { count: count, at: at };

    return {
      count: count,
      bonus: Math.min((count - 1) * combo.bonusPerHit, combo.maxBonus)
    };
  };

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

    // 連続撃破の倍率は、とどめを刺した人にだけ掛かる
    var combo = this._combo(credited.ownerId, kill.at);
    points = Math.round(points * (1 + combo.bonus));
    kill.combo = combo.count;
    kill.points = points;
    kill.credited = credited;

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

  /**
   * その人の記録。
   *
   * **ポイントは人が持ちます** (円ではありません)。円が倒されても
   * ここは残るので、次の行動で同じ強さのまま撃ち出せます。
   */
  GameSession.prototype._player = function (userId) {
    return this.players[userId] ||
      (this.players[userId] = {
        circleId: null,
        joined: false,
        followed: false,
        points: { hp: 0, attack: 0, drain: 0, spike: 0 },
        queue: []
      });
  };

  /** その人が貯めたポイントの合計。 */
  GameSession.prototype.powerOf = function (userId) {
    var p = this._player(userId).points;
    return p.hp + p.attack + p.drain + p.spike;
  };

  /** 上限に収めながらポイントを足す。実際に増えたぶんを返します。 */
  GameSession.prototype._addPoints = function (userId, add) {
    var stats = this.config.viewers.stats;
    var points = this._player(userId).points;
    var gained = { hp: 0, attack: 0, drain: 0, spike: 0 };

    for (var key in gained) {
      if (!Object.prototype.hasOwnProperty.call(gained, key)) continue;
      var want = Math.max(0, Math.floor((add && add[key]) || 0));
      if (!want) continue;
      var cap = stats[key] && stats[key].max > 0
        ? Math.floor(stats[key].max / stats[key].per) : Infinity;
      var next = Math.min(points[key] + want, cap);
      gained[key] = next - points[key];
      points[key] = next;
    }
    return gained;
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
  /** その人が今フィールドに持っている数 (大砲の中で待っているぶんも数えます)。 */
  GameSession.prototype.circleCountOf = function (ownerId) {
    var count = this.engine.circleCountOf(ownerId);
    if (this.launcher) count += this.launcher.pendingCount(ownerId);
    return count;
  };

  GameSession.prototype._spawnOrQueue = function (user, spec) {
    var limits = this.config.viewers.limits;

    if (this.circleCountOf(user.id) < limits.maxPerUser) {
      return this.spawnFor(user, spec);
    }
    return this._queueOnly(user, spec);
  };

  /**
   * 順番待ちの列に積むだけ (フィールドにも大砲にも入れません)。
   *
   * 1 人 1 つになったので普段は使いません。行動は今ある円に足されるので、
   * ここへ来るのは「大砲の中で待っている間に上限へ当たった」ときだけです。
   */
  GameSession.prototype._queueOnly = function (user, spec) {
    var limits = this.config.viewers.limits;
    var player = this._player(user.id);

    if (player.queue.length < limits.queue) {
      player.queue.push({ sourceEvent: spec.sourceEvent });
      this._syncQueue(user, spec.at);
      this.emit('queued', {
        user: user, sourceEvent: spec.sourceEvent,
        waiting: player.queue.length, at: spec.at
      });
    }
    // 列に積めなくても、貯めたポイントは既に人のほうへ入っています。
    // 送ったぶんが消えてなくなることはありません。
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
    // 大砲の中で待っているぶんも数えます。数えないと、1 つ倒れたときに
    // 列からも大砲からも出てきて、保有上限を超えます。
    if (this.circleCountOf(ownerId) >= this.config.viewers.limits.maxPerUser) return null;

    var next = player.queue.shift();
    var user = this.users[ownerId];
    if (!user) return null;

    var circle = this.spawnFor(user, {
      points: player.points,
      sourceEvent: next.sourceEvent,
      at: at
    });
    this._syncQueue(user, at);
    return circle;
  };

  /**
   * 力を足す。ここがこのゲームの中心です。
   *
   * レベルという 1 本の物差しはやめました。行動ごとに**別の力**が付きます:
   *
   *   いいね   → HP        タダで押せる。硬くなって盤面に残る
   *   ギフト   → 攻撃力    お金を払った人がいちばん強く殴れる
   *   シェア   → ドレイン  与えたダメージのぶんだけ回復する
   *   フォロー → スパイク  360° の棘。触れてきた相手を刺し返す
   *
   * ポイントは**人が持ちます**。円が倒されても消えないので、
   *
   *   1. 円があれば、その円に足す
   *   2. 大砲の中で待っているなら、撃たれる弾に反映される (人のぶんを写すだけ)
   *   3. 円が無ければ (倒された / まだ出ていない)、**その場で撃ち出す**
   *
   * 3 が「倒れても、何か行動すればまた出てくる」の実体です。
   *
   * @param {object} add { hp, attack, drain, spike } 増やすポイント
   * @returns {object|null} 育てた / 作った円
   */
  GameSession.prototype.gainPoints = function (user, add, sourceEvent, at) {
    var gained = this._addPoints(user.id, add);
    var any = gained.hp + gained.attack + gained.drain + gained.spike;

    var player = this._player(user.id);
    if (this.leaderboard) this.leaderboard.setPower(user, this.powerOf(user.id), at);

    var circle = player.circleId ? this.engine.circleOf(user.id, player.circleId) : null;

    // 大砲の中で待っている弾があるなら、そちらは撃つときに人のポイントを
    // 読むので何もしません。ここで新しく積むと円が 2 つになります。
    var pending = this.launcher && this.launcher.pendingFor(user.id);
    if (!circle && pending) {
      pending.points = player.points;
      return null;
    }

    if (circle) {
      if (!any) return circle;                 // 全部の力が上限に届いている
      this.engine.addPoints(circle, gained, at);
      this.emit('grew', {
        user: user, circle: circle, gained: gained, points: player.points,
        sourceEvent: sourceEvent, at: at
      });
      return circle;
    }

    // 円が無い -> 貯めた力をそのまま持って、もう一度撃ち出す
    return this._spawnOrQueue(user, {
      points: player.points,
      sourceEvent: sourceEvent,
      at: at
    });
  };

  /**
   * 新しい円を 1 つ作って、その人の「育てている円」にする。
   */
  GameSession.prototype.spawnFor = function (user, spec) {
    // **円はすべて大砲から出ます。** 一度ここで受け取ってもらい、
    // 撃つ瞬間に launched を付けて戻ってきます。
    if (this.launcher && !spec.launched && this.launcher.enqueue(user, spec)) return null;

    var circle = this.engine.spawnCircle({
      ownerId: user.id,
      ownerName: user.uniqueId,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl,
      sourceEvent: spec.sourceEvent,
      points: spec.points || this._player(user.id).points,
      demo: Boolean(user.demo),
      // 大砲から撃つときだけ付きます (出る場所・向き・飛んでいる時間)
      x: spec.x,
      y: spec.y,
      heading: spec.heading,
      launchMs: spec.launchMs,
      launchSpeed: spec.launchSpeed
    }, spec.at);

    // 上限に当たって出せないことがあります (大砲の中で待っている間に、
    // その人の円が上限まで増えた場合など)。順番待ちへ回します。
    if (!circle) return this._queueOnly(user, spec);

    this._player(user.id).circleId = circle.id;
    this.stats.circles += 1;

    if (this.leaderboard) this.leaderboard.setPower(user, circle.power, spec.at);

    this.emit('spawn', {
      user: user,
      sourceEvent: spec.sourceEvent,
      count: 1,
      power: circle.power,
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
   * LIKE: 10 いいねで HP が 1 ポイント。
   *
   * **タダで押せる行動が、盤面に居続ける力になります。** 端数はユーザーごとに
   * 持ち越します。7 + 5 = 12 で 1 ポイント、2 が次へ残ります。
   */
  GameSession.prototype._onLike = function (user, event, at) {
    var gain = this.config.viewers.gain;
    var count = Math.max(1, Math.floor(event.count || 1));
    this.stats.likes += count;

    var bucket = (this.likeBuckets[user.id] || 0) + count;
    var gained = Math.floor(bucket / gain.likesPerPoint);
    this.likeBuckets[user.id] = bucket - gained * gain.likesPerPoint;

    if (this.leaderboard) this.leaderboard.touch(user, at);
    if (!gained) return null;

    return this.gainPoints(user, { hp: gained }, 'LIKE', at);
  };

  /**
   * FOLLOW: 360° のスパイクをまとう。
   *
   * 1 人 1 回だけです。入り直して何度ももらえると、フォローを外して
   * 付け直す人が得をしてしまいます。
   *
   * 棘は触れてきた相手を刺し返し、威力は自分の最大 HP から出ます。
   * **いいねしか押さない人でも、フォローさえしていれば戦えます。**
   */
  GameSession.prototype._onFollow = function (user, event, at) {
    var gain = this.config.viewers.gain;
    var player = this._player(user.id);
    this.stats.follows += 1;

    if (gain.followOncePerUser && player.followed) {
      if (this.leaderboard) this.leaderboard.touch(user, at);
      return null;
    }
    player.followed = true;

    return this.gainPoints(user, { spike: gain.followPoints }, 'FOLLOW', at);
  };

  /**
   * SHARE: ドレイン (与えたダメージのぶんだけ回復)。
   *
   * 配信を広める行為なので、回数は少なく価値は高い、という形にしてあります。
   */
  GameSession.prototype._onShare = function (user, event, at) {
    this.stats.shares += 1;
    return this.gainPoints(user, { drain: this.config.viewers.gain.sharePoints }, 'SHARE', at);
  };

  /**
   * GIFT: コイン価値 -> 攻撃力。
   *
   * ギフトの名前も ID も見ません。価値の数字だけを見るので、
   * 新しいギフトが増えても何もしなくて済みます。
   * 攻撃力が上がると**武器の段**も上がります (config.weapons.tiers)。
   */
  GameSession.prototype._onGift = function (user, event, at) {
    this.stats.gifts += 1;
    var points = this.engine.attackPointsFromGift(event.value);
    return this.gainPoints(user, { attack: points }, 'GIFT', at);
  };

  /**
   * JOIN (入室): 最初の 1 回だけ、少しの HP を持って出撃します。
   *
   * 2 回目以降は何も起きません。入り直すだけで何度ももらえると、
   * 見ている人より出入りした人が得をしてしまうためです。
   */
  GameSession.prototype._onJoin = function (user, event, at) {
    var gain = this.config.viewers.gain;
    var player = this._player(user.id);

    this.stats.joins += 1;
    if (this.leaderboard) this.leaderboard.touch(user, at);

    if (gain.joinOncePerUser && player.joined) return null;
    player.joined = true;

    /**
     * 入ってきたことを**受け取ったこの瞬間**に知らせます。
     *
     * 円が出るのは大砲が撃ったあとで、混んでいれば数秒あとになります。
     * 'spawn' だけに任せると「今わたしが入った」が画面に出るまで間が
     * あくので、円とは別にここで 1 回だけ流します。2 回目以降の入室では
     * 流れません (出入りするだけで何度も名前が出てしまうため)。
     */
    this.emit('join', { user: user, at: at });

    return this.gainPoints(user, gain.joinPoints, 'JOIN', at);
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

  /**
   * 次の HP ポイントまであと何 LIKE か。
   *
   * 「あと 3 回」が見えると、そこで止めずにもう一押しする理由になります。
   * 画面に出すためだけの読み取りで、進行には影響しません。
   */
  GameSession.prototype.likesToNextPoint = function (userId) {
    var per = this.config.viewers.gain.likesPerPoint;
    return per - ((this.likeBuckets[userId] || 0) % per);
  };

  GameSession.prototype.reset = function () {
    this.likeBuckets = {};
    this.players = {};
    this.users = {};
    this.combos = {};
    this.realEventSeen = false;
    return this;
  };

  global.CB = global.CB || {};
  global.CB.GameSession = GameSession;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameSession: GameSession };
  }
})(typeof window !== 'undefined' ? window : this);
