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

    /**
     * 動き方の共通設定 (敵にも視聴者の円にも効きます)。
     *
     * 壁の反射は速度の x と y の大きさを変えません。つまり**壁とほぼ平行な
     * 向きで生まれた円は、いつまでもその壁沿いを往復します**。角に溜まって
     * 見えるのはこれが理由なので、生まれる向きと居座り対策をここで持ちます。
     */
    motion: {
      /**
       * 生まれた瞬間に中央へ向ける度合い。
       *   1   … 必ず中央へまっすぐ
       *   0.6 … 中央方向から左右 72 度までのばらつき (既定)
       *   0   … 完全にランダム (壁沿いに生まれることがある)
       */
      aimAtCenter: 0.6,
      /**
       * 壁と平行になりすぎる向きを避ける角度 (度)。
       * 縦や横にまっすぐ進む円は、フィールドの端をなぞり続けてしまいます。
       */
      minWallAngleDeg: 20,
      /**
       * 壁際に居続けたら中央へ向け直すまでの時間 (ミリ秒)。0 で向け直しません。
       * ぶつかった拍子に壁沿いの向きになってしまったときの保険です。
       */
      recenterAfterMs: 4000,
      /** 「壁際」と見なす距離 (自分の半径の倍数)。 */
      wallBand: 1.8
    },

    /**
     * 円同士がぶつかったときの挙動。
     *
     * 敵も視聴者の円も、すべて円として同じ扱いです。
     */
    collision: {
      /**
       * true … ぶつかった向きへ跳ね返る (ビリヤードと同じ)
       * false … 重ならないように押し離すだけ
       */
      bounce: true,
      /** 反発係数。1 で完全弾性衝突。小さくすると跳ね返りが弱くなります。 */
      restitution: 1,
      /**
       * 質量を半径から決めるか。
       * true にすると大きい円ほど押し勝ち、ボスは小さい円に当たっても揺るぎません。
       */
      massFromRadius: true,
      /**
       * 跳ね返ったあとに元の速さへ戻すか。
       * 当たりどころで円が止まってしまわないようにするためのもので、
       * 「向きだけが変わり、速さは変わらない」動きになります。
       */
      keepSpeed: true,
      /** 重なったときに押し離す強さ (field 単位 / 秒)。 */
      separation: 140,
      /**
       * 深く重なっているときに、1 フレームで重なりの何割まで解消するか。
       * 上の separation だけだと、大きい円に小さい円が深く入り込んだときに
       * 抜け出すまで何十フレームもかかります。
       */
      separationRatio: 0.3
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
     *   killPitch        … 撃破音の高さ。大きい敵ほど低くする (省略すると 1)
     */
    enemies: {
      types: [
        { id: 'normal', label: 'NORMAL', hp: 100,  radius: 20, speed: 58, attack: 6,  attackIntervalMs: 700, points: 1,   weight: 62, color: '#67e8f9', killPitch: 1.45 },
        { id: 'strong', label: 'STRONG', hp: 300,  radius: 28, speed: 48, attack: 12, attackIntervalMs: 700, points: 5,   weight: 24, color: '#fbbf24', killPitch: 1.15 },
        { id: 'elite',  label: 'ELITE',  hp: 1000, radius: 40, speed: 38, attack: 26, attackIntervalMs: 650, points: 20,  weight: 11, color: '#f472b6', killPitch: 0.88 },
        { id: 'boss',   label: 'BOSS',   hp: 5000, radius: 66, speed: 26, attack: 60, attackIntervalMs: 600, points: 100, weight: 3,  color: '#ef4444', killPitch: 0.6 }
      ],

      spawn: {
        /** 一定間隔で自動生成する。TikTok のイベントが 0 件でも画面は動き続けます。 */
        intervalMs: 1300,
        /** 1 回の生成で出す数。 */
        batch: 1,
        /** 起動直後に置いておく数。 */
        initialCount: 8,
        /**
         * 湧く位置を壁からどれだけ内側にするか (フィールドの短辺に対する割合)。
         *
         * 壁の上に湧かせると、敵は生きている時間の大半を端で過ごします
         * (倒されるまでが短いので、湧いた場所の印象がそのまま画面になります)。
         * 少し内側から中央へ向けて出すことで、真ん中を通る敵が増えます。
         */
        edgeInset: 0.13,
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
        circlesPerExtraEnemy: 5
      },

      movement: {
        /**
         * 動き方。
         *
         *   'linear' … 等速直線運動。速さも向きも変えず、壁で反射するだけ。
         *              次にどこへ行くかが見て分かるので、狙って当てられます。
         *   'wander' … ふらふら向きを変えつつ、視聴者円へ少し寄っていく。
         *
         * 'wander' のときだけ turnIntervalMs と chase を使います。
         */
        mode: 'linear',
        /** 進む向きを変える間隔 (ミリ秒)。'wander' のときだけ。 */
        turnIntervalMs: { min: 900, max: 2400 },
        /** 0 で完全にランダム、1 で最寄りの視聴者円へまっすぐ向かう。'wander' のときだけ。 */
        chase: 0.25,
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
      /**
       * 動き方。敵と同じで、既定は等速直線運動です。
       *
       *   'linear' … 速さも向きも変えず、壁で反射するだけ
       *   'seek'   … 最寄りの敵を追いかける
       */
      movement: { mode: 'linear' },

      /**
       * strength = 1 のときの値。
       *
       * radius はプロフィール画像が見える大きさにしてあります。
       * 小さくすると画面には多く入りますが、誰の円か分からなくなります。
       */
      base: {
        /**
         * 円は敵に当たると跳ね返るので、1 回の接触で殴れるのは 1 発だけです。
         * 張り付いて削り続けられない代わりに、1 発を重くし、打たれ強くしてあります
         * (跳ね返る前の値のままだと、当たっても倒せず自分だけ減っていきます)。
         */
        hp: 300,
        attack: 36,
        radius: 20,
        speed: 165,
        attackIntervalMs: 200
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
        maxRadius: 48,
        minSpeed: 80,
        /** 強さの上限。高額ギフトでも画面を壊さないための蓋。 */
        maxStrength: 80
      },

      limits: {
        /**
         * フィールド上の視聴者円の総数。超えると古いものから消えます。
         *
         * 描画と当たり判定が破綻しないための安全弁で、普段は届きません。
         * 当たり判定はフィールドを格子に切って隣だけを見るので、
         * 円が増えても 1 つあたりの計算量は増えません。
         */
        maxCircles: 400,
        /**
         * 1 人が同時に持てる数。
         *
         * 円は**足し算**です。10 個出ている人が 100 LIKE すれば 20 個になります。
         * ここに達したときだけ、その人の一番古い円と入れ替わります。
         *
         * 視聴者が少ないうちは届かない数にしてあります。1 人で 1000 LIKE
         * (= 100 個) 送っても入れ替わりません。
         */
        maxPerUser: 100
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

    /**
     * アイテム。
     *
     * 一定間隔でフィールドに置かれ、**視聴者の円だけが拾えます**。
     * 敵は触れても素通りします (敵が強くなると視聴者の不利益になるため)。
     *
     * 効果は**良くなるものだけ**です。エンジン側も「今の値より大きいほう」しか
     * 採らないので、拾って弱くなることはありません。
     *
     * types に 1 行足せば種類を増やせます。
     */
    items: {
      enabled: true,

      spawn: {
        /** 置く間隔 (ミリ秒)。 */
        intervalMs: 14000,
        /** 起動してから最初に置くまで。 */
        firstDelayMs: 8000,
        /** 同時にフィールドへ置く数の上限。 */
        maxAlive: 3
      },

      /** 拾われないまま消えるまでの時間。0 で消えません。 */
      lifetimeMs: 30000,
      /** 既定の大きさ。types 側で個別に指定もできます。 */
      radius: 30,

      types: [
        {
          id: 'power',
          label: 'POWER',
          color: '#facc15',
          weight: 1,
          /**
           * 100 コインのギフトと同じ強さまで引き上げます。
           * 換算はギフトと同じ式 (viewers.gift) を通すので、
           * ギフトの設定を変えればアイテムも一緒に変わります。
           * すでにそれより強い円は弱くなりません (全快だけします)。
           */
          effect: { type: 'strength', giftCoins: 100 }
        },
        {
          id: 'speed',
          label: 'SPEED',
          color: '#38bdf8',
          weight: 1,
          /**
           * 速くなります。何度拾っても、その円の元の速さの
           * maxMultiplier 倍までで止まります (速すぎて見えなくならないように)。
           */
          effect: { type: 'speed', multiplier: 1.6, maxMultiplier: 2.4 }
        }
      ]
    },

    /**
     * 効果音。
     *
     * 音は WebAudio でその場で作ります (音源ファイルは要りません)。
     * 鳴らし方はここに全部書いてあり、audio.js は書かれたとおりに鳴らすだけです。
     *
     *   kind 'tone'     … 音程のある音。from -> to へ滑らせる
     *   kind 'noise'    … 雑音を帯域で削った打撃音
     *   kind 'sequence' … 上のものを delay 秒ずらして重ねる
     *
     *   minIntervalMs … その音の最短間隔。撃破が連続しても潰れないように
     */
    audio: {
      enabled: true,
      /** 0.0 〜 1.0。配信では BGM とのバランスで下げてください。 */
      volume: 0.35,
      /** 1 秒あたりに鳴らす音の総数の上限。 */
      maxPerSecond: 22,

      sfx: {
        /** 敵に当たった。1 番よく鳴るので短く小さく。 */
        hit: { kind: 'noise', freq: 1500, q: 1.1, duration: 0.045, gain: 0.09, minIntervalMs: 70 },

        /** 敵を倒した。敵の killPitch で高さが変わります。 */
        kill: { kind: 'tone', wave: 'sawtooth', from: 620, to: 170, duration: 0.22, gain: 0.26, minIntervalMs: 55 },

        /** 視聴者の円が力尽きた。 */
        lose: { kind: 'tone', wave: 'square', from: 220, to: 80, duration: 0.12, gain: 0.09, minIntervalMs: 120 },

        /** LIKE で円が出た。 */
        spawn: { kind: 'tone', wave: 'sine', from: 500, to: 900, duration: 0.09, gain: 0.13, minIntervalMs: 70 },

        /** FOLLOW。2 音。 */
        follow: {
          kind: 'sequence',
          minIntervalMs: 140,
          steps: [
            { wave: 'triangle', from: 660, to: 660, duration: 0.09, gain: 0.2 },
            { delay: 0.09, wave: 'triangle', from: 990, to: 990, duration: 0.14, gain: 0.2 }
          ]
        },

        /** SHARE。FOLLOW と同じ形で高さだけ変えたもの。 */
        share: {
          kind: 'sequence',
          minIntervalMs: 140,
          steps: [
            { wave: 'triangle', from: 880, to: 880, duration: 0.09, gain: 0.18 },
            { delay: 0.09, wave: 'triangle', from: 1320, to: 1320, duration: 0.14, gain: 0.18 }
          ]
        },

        /** GIFT。3 音の上がり。 */
        gift: {
          kind: 'sequence',
          minIntervalMs: 180,
          steps: [
            { wave: 'square', from: 660, to: 660, duration: 0.08, gain: 0.16 },
            { delay: 0.08, wave: 'square', from: 880, to: 880, duration: 0.08, gain: 0.16 },
            { delay: 0.16, wave: 'square', from: 1320, to: 1320, duration: 0.22, gain: 0.18 }
          ]
        },

        /** アイテムを拾った。 */
        item: {
          kind: 'sequence',
          minIntervalMs: 200,
          steps: [
            { wave: 'triangle', from: 880, to: 880, duration: 0.07, gain: 0.18 },
            { delay: 0.07, wave: 'triangle', from: 1320, to: 1320, duration: 0.07, gain: 0.18 },
            { delay: 0.14, wave: 'triangle', from: 1760, to: 1760, duration: 0.18, gain: 0.2 }
          ]
        },

        /** 1 位が入れ替わった。 */
        rank: {
          kind: 'sequence',
          minIntervalMs: 1200,
          steps: [
            { wave: 'sine', from: 1046, to: 1046, duration: 0.3, gain: 0.18 },
            { delay: 0.07, wave: 'sine', from: 1568, to: 1568, duration: 0.4, gain: 0.14 }
          ]
        }
      }
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
      /**
       * 仮視聴者の円を引き上げる間隔 (ミリ秒に 1 つずつ)。
       *
       * 全部まとめて消すと、最初の LIKE が来た瞬間に画面の円が一斉に消えて
       * 「リセットされた」ように見えます。1 つずつ引き上げれば、本物の
       * 視聴者の円と自然に入れ替わります。0 にすると即座に全部消します。
       */
      retireIntervalMs: 260,
      namePrefix: 'guest'
    }
  };

  global.CB = global.CB || {};
  global.CB.CONFIG = CONFIG;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG: CONFIG };
  }
})(typeof window !== 'undefined' ? window : this);
