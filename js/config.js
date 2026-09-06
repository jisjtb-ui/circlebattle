/**
 * config.js - すべての調整値をここ 1 箇所に集約する。
 *
 * ルールを変えたいときに触るのはこのファイルだけです。
 * game.js / event-router.js / game-session.js / leaderboard.js は
 * ここから値を受け取るだけで、数値をハードコードしません。
 *
 * Node からも読めます:  require('./js/config.js').CONFIG
 */
(function (global) {
  'use strict';

  var CONFIG = {

    /** 画面まわり。ゲームのルールには影響しません。 */
    ui: {
      title: 'CIRCLE BATTLE',
      subtitle: 'VIEWERS VS ENEMIES',
      /** ランキングに出す人数。 */
      rankingSize: 10,
      /**
       * ランキングの位置。
       *   'auto'  … 横長ならフィールドの右、縦長なら下
       *   'right' … 常に右
       *   'below' … 常に下
       */
      rankingPosition: 'auto',
      /** 撃破や参加の通知を出す時間 (ミリ秒)。 */
      noticeMs: 1800
    },

    /** バトルフィールド。正方形。すべての座標はこの単位で持ちます。 */
    field: {
      width: 1000,
      height: 1000
    },

    loop: {
      /**
       * 1 フレームで進める時間の上限 (ミリ秒)。
       * タブを裏に回して戻したときに、まとめて何秒も進んで
       * 円がフィールドを突き抜けるのを防ぎます。
       */
      maxDeltaMs: 50
    },

    // ---------------------------------------------------------------- 敵

    /**
     * 敵。
     *
     * types に 1 行足すだけで敵の種類が増えます。ゲーム側は id を見ないので、
     * ボスでもイベントボスでも、ここへ定義を足すだけで出てくるようになります。
     *
     *   hp               … 体力
     *   radius           … 半径 (field 単位)
     *   speed            … 移動速度 (field 単位 / 秒)
     *   attack           … 接触した視聴者円へ与えるダメージ
     *   attackIntervalMs … 攻撃の間隔
     *   points           … 倒したときに視聴者へ入る撃破ポイント
     *   weight           … 出現しやすさ (相対値)
     *   color            … 画面上の色
     */
    enemies: {
      types: [
        { id: 'normal', label: 'NORMAL', hp: 100,  radius: 20, speed: 58, attack: 6,  attackIntervalMs: 700, points: 1,   weight: 62, color: '#67e8f9' },
        { id: 'strong', label: 'STRONG', hp: 300,  radius: 28, speed: 48, attack: 12, attackIntervalMs: 700, points: 5,   weight: 24, color: '#fbbf24' },
        { id: 'elite',  label: 'ELITE',  hp: 1000, radius: 40, speed: 38, attack: 26, attackIntervalMs: 650, points: 20,  weight: 11, color: '#f472b6' },
        { id: 'boss',   label: 'BOSS',   hp: 5000, radius: 66, speed: 26, attack: 60, attackIntervalMs: 600, points: 100, weight: 3,  color: '#ef4444' }
      ],

      spawn: {
        /** 一定間隔で自動生成する。TikTok のイベントが 0 件でも画面は動き続けます。 */
        intervalMs: 1300,
        /** 1 回の生成で出す数。 */
        batch: 1,
        /** 起動直後に置いておく数。 */
        initialCount: 8,
        /** これ以上は増やさない。 */
        maxAlive: 36,
        /**
         * これを下回ったら間隔を待たずに補充する。
         * 「敵がいなくて画面が止まる」状態を作らないための下限です。
         */
        minAlive: 6,
        /**
         * 視聴者の円がこの数だけ増えるごとに、敵の下限を 1 体増やす。
         * 人が集まったときに敵が一瞬で溶けてしまわないようにするためです。
         * 0 にすると常に minAlive のままになります (maxAlive は必ず守ります)。
         */
        circlesPerExtraEnemy: 8
      },

      movement: {
        /** 進む向きを変える間隔 (ミリ秒)。この範囲でばらつきます。 */
        turnIntervalMs: { min: 900, max: 2400 },
        /** 0 で完全にランダム、1 で最寄りの視聴者円へまっすぐ向かう。 */
        chase: 0.25,
        /** 敵同士が重なったときに押し返す強さ (field 単位 / 秒)。 */
        separation: 120
      }
    },

    // ------------------------------------------------------------ 視聴者円

    /**
     * 視聴者の円。
     *
     * 強さ (strength) を 1 つ決めれば、HP / 攻撃力 / 大きさ / 速度は
     * すべてそこから計算されます。イベントの種類ごとに違う式を持たせない
     * ことで、あとから「新しいイベントで円を出す」を足しやすくしています。
     *
     *   strength = 1   … LIKE でできる弱い円
     *   strength = 4   … FOLLOW / SHARE の中くらいの円
     *   strength = 3 + coins * 0.6 … GIFT (コイン価値ぶん強くなる)
     */
    viewers: {
      /** strength = 1 のときの値。 */
      base: {
        hp: 40,
        attack: 12,
        radius: 11,
        speed: 165,
        attackIntervalMs: 320
      },

      /**
       * strength から各値を出すときの指数。
       * value = base * strength ^ exp
       *
       * HP は素直に比例させ、攻撃力は少し抑え、見た目 (半径) は
       * 大きくなりすぎないように緩やかに増やします。
       */
      scaling: {
        hpExp: 1,
        attackExp: 0.85,
        radiusExp: 0.3,
        speedExp: -0.1,
        maxRadius: 34,
        minSpeed: 80,
        /** 強さの上限。高額ギフトでも画面を壊さないための蓋。 */
        maxStrength: 80
      },

      /** 円同士が重なったときに押し返す強さ (field 単位 / 秒)。 */
      separation: 140,

      limits: {
        /** フィールド上の視聴者円の総数。超えると古いものから消えます。 */
        maxCircles: 260,
        /** 1 人が同時に持てる数。 */
        maxPerUser: 24
      },

      /** LIKE: 10 LIKE ごとに弱い円 1 個。端数は次へ繰り越します。 */
      like: {
        perCircle: 10,
        circlesPerMilestone: 1,
        strength: 1,
        /** 1 イベントで出す上限 (まとめて 5000 LIKE 来ても壊れないように)。 */
        maxPerEvent: 20
      },

      /** FOLLOW: 中くらいの円 1 個。 */
      follow: { circles: 1, strength: 4 },

      /** SHARE: 中くらいの円 1 個。 */
      share: { circles: 1, strength: 4 },

      /**
       * GIFT: コイン価値 -> 強さ。
       * strength = baseStrength + coins * strengthPerCoin
       */
      gift: {
        circles: 1,
        baseStrength: 3,
        strengthPerCoin: 0.6
      }
    },

    /**
     * ギフトのコイン価値。
     *
     * 通常はイベントに入っているダイヤ数をそのまま使います。
     * 特定のギフトだけ重み付けを変えたいときに byId / byName へ書きます。
     */
    gifts: {
      byId: {},          // { '5655': 1 }
      byName: {},        // { 'rose': 1 }
      coinsPerDiamond: 1,
      /** ダイヤ数が取れなかったときの値。 */
      defaultCoins: 1
    },

    // ------------------------------------------------------------ ポイント

    /**
     * 撃破ポイントの配り方。
     *
     *   'lastHit' … とどめを刺した 1 人が全ポイントを取る (初期実装)
     *   'damage'  … 与えたダメージの割合でポイントを分ける
     *
     * どちらでも動くように、敵は「誰がどれだけ削ったか」を常に記録しています。
     */
    scoring: {
      mode: 'lastHit',
      /** mode:'damage' のとき、KILL 数を誰に付けるか。'lastHit' | 'topDamage' */
      killCredit: 'lastHit',
      /** ダメージ 1 につき入るスコア。0 なら撃破ポイントだけ。 */
      pointsPerDamage: 0,
      /** mode:'damage' のとき、この割合未満の貢献は無視する。 */
      minShare: 0.02
    },

    /** ランキング。 */
    ranking: {
      /** 'score' | 'kills' | 'damage' */
      sortBy: 'score',
      /** 'desc' | 'asc' */
      order: 'desc',
      size: 10
    },

    /**
     * デモ視聴者。
     *
     * TikTok に繋いでいない / まだ誰も反応していない間、画面が
     * 「敵がうろつくだけ」にならないように仮の視聴者を動かします。
     * 本物のイベントが 1 件でも届いたら止まり、記録も消えます。
     */
    demo: {
      enabled: true,
      /** 仮視聴者の人数。 */
      players: 6,
      /** イベントを起こす間隔 (ミリ秒)。 */
      intervalMs: 900,
      /** 視聴者円がこの数を下回っているときだけ補充する。 */
      keepCircles: 18,
      /** 本物のイベントが来たら止める。 */
      stopOnRealEvent: true,
      /** 止めるときに、仮視聴者のランキング記録も消す。 */
      clearOnRealEvent: true,
      namePrefix: 'guest'
    }
  };

  global.CB = global.CB || {};
  global.CB.CONFIG = CONFIG;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG: CONFIG };
  }
})(typeof window !== 'undefined' ? window : this);
