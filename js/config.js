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

      /** 撃破や参加の通知を出す時間 (ミリ秒)。 */
      noticeMs: 1800,
      /** 画面下に出す LIVE EVENT の行数。多いとスマホでは読めません。 */
      eventLines: 3,
      /** 1 件が消えるまでの時間 (ミリ秒)。 */
      eventLifeMs: 9000,
      /** 生まれた直後の円に名前を出す時間 (ミリ秒)。0 で出しません。 */
      nameTagMs: 4000,

      /**
       * 入室 (JOIN) で生まれた円を目立たせる設定。
       *
       * JOIN は 1 人 1 回だけの「初めまして」なので、その円がどれなのかが
       * 分かると、入ってきた人が自分を見つけられます。ずっと光らせると
       * 画面が飾りだらけになるので、少しの間だけにします。
       */
      join: {
        /** 目立たせる時間 (ミリ秒)。0 で出しません。 */
        highlightMs: 7000,
        /** 光の色。他の段の色とかぶらない金色にしてあります。 */
        color: '#fbbf24',
        /** 円の上に出す文字。 */
        label: 'JOINED',

        /**
         * 入室を受け取った**その瞬間**に画面中央へ出す名前。
         *
         * 円が出るのは大砲が撃ったあと (混んでいれば数秒後) なので、
         * それだけだと「今わたしが入った」が画面に出るまで間があきます。
         * 受け取った瞬間に中央へ名前を出せば、入った本人がすぐ自分を
         * 見つけられます。
         *
         * 目立たせつつ邪魔にしないために、次の 3 つで抑えています:
         *
         *   1. 短い          … 1 人 1.1 秒。板は敷かず、文字と淡い暈しだけ
         *   2. 1 度に 1 人   … 順番に出す。重ねると誰の名前も読めません
         *   3. 混んだら縮める … 待ちが増えたら 0.52 秒。あふれたぶんは
         *                       「+12 MORE JOINED」と数だけ添えます
         */
        banner: {
          /** false で出しません。 */
          enabled: true,
          /** 1 人ぶんの表示時間 (ミリ秒)。 */
          holdMs: 1100,
          /** 次の名前を出すまでの間 (ミリ秒)。0 だと入れ替わりが読めません。 */
          gapMs: 90,
          /** これだけ待っていたら短いほうに切り替えます。 */
          rushFrom: 3,
          /** 混んでいるときの表示時間 (ミリ秒)。 */
          rushHoldMs: 520,
          /** 待ちの上限。これを超えたぶんは数だけ数えます。 */
          maxQueue: 5,
          /** 名前の下に出す文字。 */
          label: 'JOIN'
        }
      },
      /** 撃破のたびに飛ぶ「+1 KILL」などの表示時間 (ミリ秒)。 */
      floatMs: 1100,
      /** 同時に飛ばす数の上限。大量撃破で文字だらけになるのを防ぎます。 */
      floatMax: 14,
      /**
       * 画面上部に HP ゲージを出す敵の最低 HP。
       *
       * BOSS を常時出すと「またか」で終わるので、居るときだけ出します。
       * 「あと少しで倒せる」が見えると、みんなで殴りにいく理由になります。
       */
      bossBarMinHp: 1000,

      /**
       * 盤面の背景。
       *
       * 1080x1920 の画像を敷けます。操作画面から選ぶか、URL を
       * `?bg=...` で渡します。指定が無ければ下の色と罫線を描きます。
       * 画像はフィールドいっぱいに引き伸ばすので、9:16 で作ってください。
       */
      background: {
        /** 画像の URL。null なら既定の下地。 */
        url: null,
        /** 画像の上に重ねる暗幕の濃さ。円と敵を見やすくするため。 */
        dim: 0.28,
        /** 画像が無いときの下地。 */
        color: '#090a18'
      }
    },

    /**
     * PLAYER CANNON - 円の出てくる場所。
     *
     * **視聴者の円はすべてここから撃ち出されます。** フィールドのどこかに
     * ぽんと現れるのではなく、端の大砲から中央へ向かって飛び込むことで、
     * 「今この人が入ってきた」という因果が画面から読み取れます。
     *
     * 演出は engine のループとは別に進みます (js/cannon.js)。撃つ順番待ちが
     * 溜まっても、敵の生成も戦闘も止まりません。待ちが増えたときは装填を
     * 短くし、それでも追いつかないときは演出を飛ばして即座に撃ちます。
     * **入れなくなる人が出ないことを、演出の見栄えより優先します。**
     */
    cannon: {
      enabled: true,

      /** 置く場所 (フィールドに対する割合)。左下が既定。 */
      anchor: { x: 0.15, y: 0.88 },
      /** 砲身の長さ (フィールド座標)。通常時の大きさの基準になります。 */
      size: 104,
      /** 通常時と発射時の大きさの倍率。通常時は邪魔にならない大きさに。 */
      idleScale: 0.72,
      loadScale: 1,
      fireScale: 1.28,

      /** 段階の長さ (ミリ秒)。合計がそのまま 1 発ぶんの時間です。 */
      loadMs: 430,
      fireMs: 140,
      recoverMs: 170,

      /**
       * 順番待ちがこの数を超えたら、装填を短くして早く捌きます。
       * 演出の丁寧さより、待たされないことを優先します。
       */
      burstAt: 3,
      burstLoadMs: 90,
      burstRecoverMs: 50,
      /** これも超えたら演出を飛ばして即発射 (位置と向きは大砲のまま)。 */
      maxQueue: 14,

      /** 飛んでいる間 (ミリ秒)。この間は戦わず、ぶつかりもしません。 */
      launchMs: 430,
      /** 飛んでいる間の速さの倍率。撃ち出された感を出すため。 */
      launchSpeed: 2.6,
      /** 発射方向のばらつき (ラジアン)。0 だと全部同じ線に並びます。 */
      spreadRad: 0.3,
      /**
       * 発射の勢いのばらつき (割合)。
       * 同じ速さで撃つと、続けて撃ったぶんが団子になって飛びます。
       */
      speedJitter: 0.22,

      /**
       * 演出の種類。**今は normal だけを使います。**
       * 特別な演出を足すときは、ここに 1 つ書いて typeByEvent から指すだけです。
       */
      types: {
        normal: { label: 'PLAYER CANNON', color: '#22d3ee', scale: 1, particles: 14, shockwave: 1 },
        special: { label: 'SPECIAL ENTRY', color: '#fbbf24', scale: 1.35, particles: 26, shockwave: 1.6 },
        legendary: { label: 'LEGENDARY ENTRY', color: '#f472b6', scale: 1.7, particles: 40, shockwave: 2.2 }
      },
      /** どのイベントでどの種類を使うか。今はすべて normal。 */
      typeByEvent: {
        JOIN: 'normal', LIKE: 'normal', FOLLOW: 'normal', SHARE: 'normal', GIFT: 'normal'
      },

      /** 装填中に出す文字。入室だけは「初めまして」なので別の文言にします。 */
      notice: {
        JOIN: { main: 'NEW PLAYER', sub: 'ENTERED THE BATTLE' },
        default: { main: null, sub: null }
      }
    },

    /**
     * 武器の進化。
     *
     * 武器は円のまわりを**回りながら、当たった敵を斬ります**。当たり判定は
     * 見た目と同じ角度・同じ長さを使うので、「当たったように見えたのに
     * 当たらない」ことがありません (角度は engine が持ち、描画はそれを読むだけ)。
     *
     * 円そのものの HP・攻撃力・速さ・半径は今までどおり viewers.scaling が
     * 決めます。ここが足すのは**武器のぶんの攻撃と、段ごとの特殊能力**だけです。
     * 円の基本値をここで書き換えないのは、どちらが効いているのか分からなく
     * なるのを避けるためです。
     *
     * 武器は円の**外側**にだけ描きます (extent)。プロフィール画像は
     * ゲームの中で一番大事な情報なので、何があっても隠しません。
     */
    weapons: {
      enabled: true,

      /** 武器が円の外へ出る量 (半径の倍率)。大きくすると隣の円と重なります。 */
      extent: 1.8,
      /**
       * 武器の大きさ。Lv1 で minScale、Lv100 で maxScale になります。
       *
       * 段が変わると**形**が変わり、段の中では**大きさ**が少しずつ育ちます。
       * レベルに対して切れ目なく上がるので、Lv19 の武器が Lv20 の武器より
       * 大きく見える、という逆転が起きません。
       */
      minScale: 0.8,
      maxScale: 1,
      /** 見た目の半径がこれ未満の円には描かない (潰れて何も読めないため)。 */
      minRadiusPx: 7,
      /** 光り足しと軌跡を出す最小の見た目半径 (px)。小さい画面での負荷対策。 */
      detailRadiusPx: 16,
      /** 段の中でこの進み具合を超えたら軌跡が出る (Lv15/25/35… に相当)。 */
      trailFrom: 0.5,

      /**
       * 当たり判定を持たないほうの層 (周回物 / 本体) が回る速さ。
       * 当たる側の spin に対する倍率です。逆回りにして、当たる側の刃が
       * どれなのかを見分けやすくしてあります。
       */
      counterSpin: -0.35,

      /**
       * 仮の視聴者 (NPC) の武器。
       *
       * 色を落とし、光り足しもしません。**本物の視聴者より目立たせない**のが
       * 目的です。誰も居ない間も盤面は動いていてほしいけれど、その円が
       * 本物の視聴者の成果に見えてしまうと、ランキングの意味が薄れます。
       */
      npcColor: '#5b6472',
      npcAlpha: 0.62,

      /** この段に上がったときだけ画面中央に短い演出を出す。 */
      milestones: [50, 100],

      /**
       * 武器の当たり判定。
       *
       * 判定は「円の中心からの距離」と「武器の角度」の 2 つだけです。
       * 敵との距離は戦闘ループで既に出しているので、足すのは角度の比較だけで、
       * 円が 150 個あっても重くなりません。
       */
      combat: {
        enabled: true,
        /** 武器で殴る間隔 (ミリ秒)。円の本体の殴り合いとは別に数えます。 */
        intervalMs: 300,
        /** 円の攻撃力に対する武器の倍率。段ごとの倍率にさらに掛かります。 */
        damage: 0.5,
        /** 当たり判定の内側 (半径の倍率)。円のふちのすぐ外から効きます。 */
        innerReach: 1.0
      },

      /** 攻撃したときのエフェクト。 */
      attackEffects: {
        /** 同時に出せる数。超えたら古いものから消えます。 */
        max: 40,
        /** 1 つが消えるまで (ミリ秒)。長いと画面が線で埋まります。 */
        lifeMs: 220,
        /** これより小さい円の攻撃は描かない。 */
        minRadiusPx: 9
      },

      /**
       * Lv1〜100 を 10 段に分けたもの。minLevel は昇順。
       *
       * ここに 1 行足せば段が増えます (描き方は js/weapons.js の PAINTERS に
       * 同じ id で足します)。
       *
       *   attack … 攻撃エフェクトの種類。null なら出しません
       *   spin   … 武器が回る速さ (ラジアン/秒)。当たり判定もこの角度で回ります
       *   hit    … 当たり判定
       *       arms   … 腕の数。等間隔に並びます (2 なら 180 度ごと)
       *       arc    … 腕 1 本の当たる角度の半分 (ラジアン)
       *       offset … 腕が生えている向き。絵と揃えます (省略で 0)
       *       reach  … 届く距離 (円の半径の倍率)
       *       damage … 武器のダメージ倍率
       *       layer  … 見た目のどちらの層と一緒に回るか ('a' 本体 / 'b' 周回物)
       *   ability … 段の特殊能力。下の 5 つの部品の組み合わせで作ります
       *       name        … 画面に出す名前
       *       maxTargets  … 一振りで当たる敵の数
       *       lifesteal   … 武器で与えたダメージのうち、自分の HP に戻る割合
       *       rate        … 武器の攻撃間隔の倍率 (小さいほど速い)
       *       damageTaken … 受けるダメージの倍率 (小さいほど固い)
       *       nova        … { intervalMs, damage } 射程内の敵全部への衝撃波
       *
       * 特殊能力を 5 つの部品で作るのは、段ごとに専用の仕組みを書くと
       * 10 個の別々のゲームになってしまうためです。部品の数字を変えるだけなら、
       * 強さの調整も 1 か所で済みます。
       */
      tiers: [
        {
          minLevel: 1, id: 'none', name: 'NO WEAPON', color: '#94a3b8', attack: null,
          spin: 0, hit: null, ability: null
        },
        {
          minLevel: 10, id: 'blade', name: 'NEON BLADE', color: '#38bdf8', attack: 'slash',
          spin: 2.6, hit: { arms: 1, arc: 0.22, reach: 1.62, damage: 1, layer: 'a' },
          ability: null
        },
        {
          minLevel: 20, id: 'twin', name: 'TWIN BLADES', color: '#06b6d4', attack: 'twin',
          spin: 3.0, hit: { arms: 2, arc: 0.2, reach: 1.66, damage: 1, layer: 'a' },
          ability: { name: 'TWIN STRIKE', maxTargets: 2 }
        },
        {
          minLevel: 30, id: 'spear', name: 'ENERGY SPEAR', color: '#10b981', attack: 'thrust',
          spin: 2.4, hit: { arms: 1, arc: 0.18, reach: 1.82, damage: 1.45, layer: 'a' },
          ability: { name: 'PIERCE', maxTargets: 2 }
        },
        {
          minLevel: 40, id: 'axe', name: 'PLASMA AXE', color: '#f59e0b', attack: 'impact',
          spin: 2.1, hit: { arms: 1, arc: 0.48, reach: 1.78, damage: 1.6, layer: 'a' },
          ability: { name: 'CLEAVE', maxTargets: 3 }
        },
        {
          minLevel: 50, id: 'scythe', name: 'ENERGY SCYTHE', color: '#8b5cf6', attack: 'sweep',
          spin: 3.4, hit: { arms: 1, arc: 0.65, offset: 0.5, reach: 1.7, damage: 1.5, layer: 'a' },
          ability: { name: 'LIFESTEAL', maxTargets: 3, lifesteal: 0.35 }
        },
        {
          minLevel: 60, id: 'chakram', name: 'TWIN CHAKRAMS', color: '#ec4899', attack: 'spin',
          spin: 4.4, hit: { arms: 2, arc: 0.34, reach: 1.72, damage: 1.4, layer: 'b' },
          ability: { name: 'WHIRL', maxTargets: 4 }
        },
        {
          minLevel: 70, id: 'cannon', name: 'PLASMA CANNON', color: '#ef4444', attack: 'bolt',
          spin: 1.8, hit: { arms: 2, arc: 0.3, offset: Math.PI / 2, reach: 1.7, damage: 1.5, layer: 'a' },
          ability: { name: 'BARRAGE', maxTargets: 3, rate: 0.55 }
        },
        {
          minLevel: 80, id: 'wings', name: 'ENERGY WINGS', color: '#3b82f6', attack: 'wing',
          spin: 2.2, hit: { arms: 3, arc: 0.6, reach: 1.76, damage: 1.5, layer: 'a' },
          ability: { name: 'AEGIS', maxTargets: 4, damageTaken: 0.6 }
        },
        {
          minLevel: 90, id: 'orbital', name: 'ORBITAL WEAPON', color: '#a855f7', attack: 'multi',
          spin: 3.6, hit: { arms: 5, arc: 0.26, reach: 1.72, damage: 1.4, layer: 'b' },
          ability: { name: 'ORBIT STRIKE', maxTargets: 5, damageTaken: 0.8 }
        },
        {
          minLevel: 100, id: 'core', name: 'LEGENDARY CORE', color: '#facc15', attack: 'core',
          spin: 4.0, hit: { arms: 3, arc: 0.5, reach: 1.75, damage: 1.6, layer: 'b' },
          ability: {
            name: 'NOVA', maxTargets: 6, lifesteal: 0.2, rate: 0.7, damageTaken: 0.55,
            nova: { intervalMs: 2400, damage: 3.5 }
          }
        }
      ]
    },

    /**
     * バトルフィールド。すべての座標はこの単位で持ちます。
     *
     * 既定は **1080 x 1920**。TikTok LIVE の縦画面と同じ比にしてあるので、
     * 背景に敷く 1080x1920 の画像と座標が 1 対 1 で対応します
     * (画像の左上が (0, 0)、右下が (1080, 1920))。
     *
     * 実際の画面の比が 9:16 とわずかに違う端末では、engine.setFieldAspect()
     * で高さだけを合わせます。そうしないと画面の上下か左右に隙間ができて、
     * 「画面一面がスタジアム」になりません。
     */
    field: {
      width: 1080,
      height: 1920,

      /**
       * 混んできたらフィールドを広げ、空いたら戻します。
       *
       * 判定は「円と敵が床面積のどれだけを占めているか」です。数ではなく
       * 面積で見るのは、育った円が大きいからです (レベル 100 は面積が約 6 倍)。
       *
       * 広がるときは画面全体がズームアウトして見えます。座標も一緒に広がるので、
       * 円は散らばりますが、位置関係は変わりません。
       */
      expand: {
        enabled: true,
        /**
         * 占有率がこれを超えたら 1 段階広げる。
         *
         * 面積で見ているので、円を 1.5 倍にすると同じ人数でも占有率は
         * 2.25 倍になります。閾値をそのままにすると、大きくしたぶんだけ
         * すぐ広がって**画面上の大きさは元に戻ってしまいます** (実測で
         * 1.5 倍にしたのに 1.09 倍にしかなりませんでした)。
         * 人数に対する広がり方が前と同じになる値にしてあります。
         */
        growAt: 0.52,
        /** これを下回ったら 1 段階戻す。 */
        shrinkAt: 0.22,
        /** 1 段階あたりの倍率 (面積は約 1.8 倍)。 */
        step: 1.35,
        /** 何段階まで広げるか。 */
        maxSteps: 3,
        /** 広がる / 戻るのにかける時間 (ミリ秒)。 */
        durationMs: 2000,
        /** 変化のあと、次の判定をするまで待つ時間。行ったり来たりを防ぎます。 */
        cooldownMs: 4000
      }
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
      /**
       * 視聴者の円が敵を押せるかどうか。
       *
       * false だと、円は敵に当たって跳ね返るだけで、敵は押されません。
       * 視聴者が増えると円が数百個になり、あちこちから押された敵が
       * 隅へ寄せ集められて重なります (100 人規模で実測しました)。
       * 押されないほうが、敵の動きも読みやすいままです。
       */
      enemiesArePushed: false,

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
        { id: 'boss',   label: 'BOSS',   hp: 5000, radius: 66, speed: 26, attack: 60, attackIntervalMs: 600, points: 100, weight: 3,  color: '#ef4444', killPitch: 0.6 },
        /**
         * 特殊イベントでしか出ない敵 (weight: 0 なので通常抽選には乗りません)。
         * 硬くはないが逃げ足が速く、倒すと大きい。見つけたら追いかける価値がある存在。
         */
        { id: 'rare',   label: 'RARE',   hp: 2500, radius: 34, speed: 120, attack: 20, attackIntervalMs: 700, points: 300, weight: 0,  color: '#c084fc', killPitch: 1.6 }
      ],

      spawn: {
        /** 一定間隔で自動生成する。TikTok のイベントが 0 件でも画面は動き続けます。 */
        intervalMs: 1000,
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
        maxAlive: 48,
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
        circlesPerExtraEnemy: 4
      },

      /**
       * 場の勢力に合わせて敵を硬くする。
       *
       * 視聴者が育つと、敵は湧いた瞬間に溶けるようになります。そうなると
       * 画面から敵が消え、撃破数だけが跳ね上がって勝負になりません。
       * フィールドにいる円の合計レベルに応じて、敵の HP を上げます。
       *
       * 上げるのは HP だけです。撃破ポイントも敵の攻撃力も変わらないので、
       * 育っていない視聴者が不利になることはありません。
       */
      scale: {
        /** 合計レベルがこれだけ増えるごとに、敵の HP が 1 倍ぶん増えます。0 で無効。 */
        hpPerTotalLevel: 900,
        /** HP 倍率の上限。 */
        maxHpMultiplier: 15
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
     * **円は増えるのではなく、育ちます。** 1 人が持つのは基本 1 つで、
     * LIKE / FOLLOW / SHARE / GIFT でその円のレベルが上がっていきます。
     *
     *   10 LIKE  ->  1 レベル
     *   レベル 1 〜 100
     *
     * 100 に達した円はそのまま戦い続け、次の行動で新しい円が生まれます。
     */
    viewers: {
      /**
       * レベルの決まりごと。
       *
       * 何をすると何レベル上がるかは全部ここです。
       * 円の強さ (HP・攻撃力・大きさ) はレベルから計算されるので、
       * バランスを変えたいときもこの表と scaling だけを触ります。
       */
      levels: {
        /** 上限。ここに達した円はそれ以上育ちません。 */
        max: 100,

        /** 何 LIKE で 1 レベルか。端数はユーザーごとに繰り越します。 */
        likesPerLevel: 10,

        /** FOLLOW で上がるレベル (100 LIKE と同じ)。 */
        follow: 10,

        /** SHARE で上がるレベル。 */
        share: 5,

        /**
         * ギフト: コイン 1 につき何レベルか。
         * 1 コイン (バラ 1 本) = 10 LIKE と同じ 1 レベル、
         * 100 コインのギフトなら一気に最大レベルまで届きます。
         */
        giftLevelsPerCoin: 1,
        /** ギフトで上がる最低レベル (価値が取れなかったとき用)。 */
        giftMinLevels: 1,

        /** 入室 (JOIN) したときにもらえる円のレベル。 */
        join: 20,
        /** 入室でもらえるのは 1 人 1 回だけにするか。 */
        joinOncePerUser: true,

        /**
         * 最大レベルの円を持っている人が次に行動したとき、
         * 新しい円は「その行動ぶんのレベル」で生まれます。
         * 10 LIKE なら 1 レベル、50 コインのギフトなら 50 レベルです。
         */
        restartAtActionLevel: true,

        /**
         * 最大レベルに届いた円が暴れる時間 (ミリ秒)。0 で無期限。
         *
         * 育てきった円をずっと置いておくと、画面がだんだん最大レベルの円で
         * 埋まっていき、1 体あたりの見せ場もありません。短い間だけ
         * とんでもなく強くして稼がせ、燃え尽きて消える形にしています。
         */
        maxDurationMs: 20000,

        /**
         * 暴れている間の倍率。レベルから出した値にさらに掛かります。
         * (画面では金色の円になり、残り時間が外周のリングで見えます)
         */
        maxBonus: {
          attack: 2.5,
          speed: 1.8
        }
      },

      /**
       * 動き方。敵と同じで、既定は等速直線運動です。
       *
       *   'linear' … 速さも向きも変えず、壁で反射するだけ
       *   'seek'   … 最寄りの敵を追いかける
       */
      movement: { mode: 'linear' },

      /**
       * レベル 1 のときの値。
       *
       * radius はプロフィール画像が見える大きさにしてあります。
       * 小さくすると画面には多く入りますが、誰の円か分からなくなります。
       *
       * 混んでくるとフィールドが広がる (画面はズームアウトする) ので、
       * そのぶん円は小さく映ります。**顔とレベルが読めることを、
       * 何個入るかより優先**して 1.5 倍にしてあります
       * (field.expand の閾値もそれに合わせて上げてあります)。
       */
      base: {
        hp: 300,
        attack: 36,
        radius: 30,
        speed: 165,
        attackIntervalMs: 300
      },

      /**
       * レベルから各値を出すときの指数。
       *
       *   value = base * level ^ exp
       *
       * レベル 100 で HP が約 20 倍、攻撃力が約 16 倍、大きさが約 2.4 倍、
       * 速さが約 2.7 倍になります。さらに最大レベル中は maxBonus が掛かります。
       */
      scaling: {
        hpExp: 0.65,
        attackExp: 0.6,
        radiusExp: 0.19,
        /**
         * 速さもレベルで上がります (以前は少し遅くなっていました)。
         * 育つほど盤面を速く駆け回るので、育てた効果が見て分かります。
         */
        speedExp: 0.22,
        /** base.radius 30 × 100^0.19 = 72。ここを変えると Lv100 だけ形が崩れます。 */
        maxRadius: 72,
        minSpeed: 120,
        /** 速すぎて目で追えなくならないための上限。 */
        maxSpeed: 700
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
         * 普段は 1 つですが、最大レベルまで育てるたびに増えていきます。
         * ここに達したときだけ、その人の一番古い円と入れ替わります。
         * (連打する人が何十個も並べると、画面がその人だけになるためです)
         * 最大レベルの円は時間で消えるので、普段はここに届きません。
         *
         * ここに達したあとの円は**消えずに順番待ちになります**。下の queue を参照。
         */
        maxPerUser: 5,

        /**
         * 順番待ちの列の長さ。テトリスの NEXT と同じで、上限に達したあとに
         * できた円はここに積まれ、フィールドの円が減ると順に入っていきます。
         *
         * 列も埋まったら、それ以上は増やさずに**列の最後の円が強くなります**。
         * 送ったぶんが消えてなくなることはありません。
         */
        queue: 5
      }
    },

    /**
     * ギフトのコイン価値。
     *
     * 通常はイベントに入っているダイヤ数をそのまま使います。
     * 特定のギフトだけ重み付けを変えたいときに byId / byName へ書きます。
     * 「コイン価値 -> 何レベル上がるか」は viewers.levels で決めます。
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
     * 進行役 (Director)。
     *
     * 一定時間ごとに WAVE を進め、ときどき特殊イベントを起こします。
     * 「次に何か起きるかもしれない」を作るためのもので、**視聴者の円と
     * ランキングには一切触りません**。区切りは敵側にだけ入ります。
     */
    director: {
      enabled: true,
      /** ウェーブの長さ (ミリ秒)。 */
      waveMs: 90000,
      /**
       * ウェーブの節目に特殊イベントが起きる確率。
       * 毎回起こすと「特殊」ではなくなるので、半分程度にしています。
       */
      eventChance: 0.5,

      events: [
        { id: 'boss',  label: 'BOSS APPEARED',  sub: 'TAKE IT DOWN TOGETHER',       weight: 3, spawn: { type: 'boss',   count: 2 } },
        { id: 'swarm', label: 'SWARM INCOMING', sub: 'THEY KEEP COMING',           weight: 3, spawn: { type: null,     count: 12 } },
        { id: 'rare',  label: 'RARE ENEMY',     sub: '+300 SCORE IF YOU KILL IT',  weight: 2, spawn: { type: 'rare',   count: 1 } },
        { id: 'elite', label: 'ELITE SQUAD',    sub: 'FIVE ELITES AT ONCE',       weight: 2, spawn: { type: 'elite',  count: 5 } }
      ]
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
           * 100 コインのギフトと同じレベルまで引き上げます。
           * 換算はギフトと同じ式 (viewers.levels) を通すので、
           * ギフトの設定を変えればアイテムも一緒に変わります。
           * すでにそれより上のレベルの円は下がりません (全快だけします)。
           */
          effect: { type: 'level', giftCoins: 100 }
        },
        {
          id: 'heal',
          label: 'HEAL',
          color: '#4ade80',
          weight: 1.4,
          /**
           * HP を全快させ、暴れている最中なら**その時間を延ばします**。
           * 運よく拾えた円は、長く暴れ続けて稼げます。
           */
          effect: { type: 'heal', ratio: 1, extendMs: 8000, maxRemainingMs: 30000 }
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

    /**
     * コンボ。
     *
     * 同じ人が短い間に続けて倒すと COMBO が伸びます。倍率は小さく、
     * 上限も低めです (これで一気に逆転できると、育てた意味が薄れるため)。
     */
    combo: {
      enabled: true,
      /** この時間内に次を倒すと続く (ミリ秒)。 */
      windowMs: 4000,
      /** 何連続から画面に出すか。 */
      showFrom: 3,
      /** 1 連続あたりのスコア倍率の増分と上限。 */
      bonusPerHit: 0.1,
      maxBonus: 1.0
    },

    /** ランキング。 */
    ranking: {
      /** 'score' | 'kills' | 'damage' */
      sortBy: 'score',
      /** 'desc' | 'asc' */
      order: 'desc',
      /**
       * 順位を出す人数。**画面に並ぶ行数もこれです。**
       * 盤面の上に重ねるので、多いとスタジアムが隠れます。
       */
      size: 5
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
