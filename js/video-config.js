/**
 * video-config.js - VIDEO BATTLE MODE の調整値をここ 1 箇所に集約する。
 *
 * **LIVE 版 (js/config.js) には一切触りません。** 動画用のモードは
 * RED と BLUE の 1 対 1 で、視聴者イベントもランキングも要らないため、
 * 設定も別に持ちます。LIVE 版を触らずに数値をいじれるのが目的です。
 *
 * Node からも読めます:  require('./js/video-config.js').VIDEO_CONFIG
 *
 * 音について:
 *
 *   音は「ファイルがあればファイル、無ければその場で合成」です。
 *   sounds/hammer-shot.wav を置けばそれが鳴り、置かなければ下の synth の
 *   レシピから同じ名前の音を作ります。差し替えたいときはファイルを置くだけで、
 *   コードは 1 行も変えません (js/video-sound-bank.js 参照)。
 */
(function (global) {
  'use strict';

  /**
   * 音の合成レシピ。
   *
   *   type   … sine / square / saw / triangle / noise
   *   freq   … 数値 (一定) か [始まり, 終わり] (滑らせる)
   *   sweep  … 'exp' (音程らしい) か 'lin'
   *   dur    … 長さ (秒)。delay で鳴り始めをずらせます
   *   gain   … 0〜1。層を足した合計が 1 を超えたら最後に正規化します
   *   attack … 立ち上がり (秒)。0.001 で「カチッ」、0.05 で「フワッ」
   *   filter … { type:'lp'|'hp'|'bp', freq, q } freq も [from,to] で滑らせられます
   *   drive  … 1 より大きいと歪んで音が太くなります (打撃音向け)
   *   vibrato… { rate, depth } 機械音・エネルギー音向け
   */

  var VIDEO_CONFIG = {

    /** 盤面。9:16。画面の比に合わせて engine 側も伸縮します。 */
    field: {
      width: 1080,
      height: 1920,
      /** 壁の内側の余白 (px)。HP バーの下に潜り込まないようにします。 */
      topMargin: 240,
      bottomMargin: 90
    },

    loop: {
      /** 1 フレームの上限 (ミリ秒)。タブを戻した瞬間に一気に進むのを防ぎます。 */
      maxDeltaMs: 50
    },

    /** RED と BLUE。強さは完全に同じで、色と名前だけが違います。 */
    fighters: {
      maxHp: 1000,
      radius: 104,
      /** 基本の速さ (px/秒)。 */
      speed: 430,
      /** 相手へ寄っていく強さ (0 でまっすぐ跳ね回るだけ)。 */
      chase: 1.5,
      /** 落ちている武器へ寄っていく強さ。相手より少し強く引きます。 */
      itemChase: 2.6,
      /** ふらつき (0 で直線的)。同じ動きの繰り返しを避けるためのものです。 */
      wander: 0.9,
      /** ぶつかったときの反発。 */
      bounce: 1.0,
      /** ノックバックから戻るまでの速さ (1 秒あたりの減衰率)。 */
      knockbackDamping: 3.4,

      red: {
        id: 'red',
        name: 'RED',
        /** 円とエフェクトの色。HP バーもこの 2 色で作ります。 */
        color: '#ff2f6d',
        glow: '#ff8ab4',
        bar: ['#ff2f6d', '#ff7ab0'],
        startWeapon: 'sword'
      },
      blue: {
        id: 'blue',
        name: 'BLUE',
        color: '#22a7ff',
        glow: '#8ce0ff',
        bar: ['#1f6dff', '#4fe9ff'],
        startWeapon: 'pistol'
      }
    },

    /**
     * HP まわり。
     *
     * 数値は出しません。長さだけで「どちらが優勢か」を分からせるのが目的です
     * (画面を見た瞬間に理解できること)。
     */
    hp: {
      /** バーが実際の HP へ追いつく速さ (1 秒あたりの割合)。 */
      easePerSecond: 6.5,
      /** 減ったぶんを白く残す「残像」が消え始めるまで (ミリ秒)。 */
      ghostHoldMs: 260,
      /** 残像が消える速さ (1 秒あたりの割合)。ゆっくり追うほど減少量が目立ちます。 */
      ghostPerSecond: 1.6,

      /** 最大 HP に対してこの割合を超えたら「大ダメージ」。演出も音も強くなります。 */
      bigDamageRatio: 0.09,

      /** 危険域。上から順に判定します (割合)。 */
      warnRatio: 0.30,     // 強調
      dangerRatio: 0.15,   // 危険
      criticalRatio: 0.05, // あと一撃

      /**
       * 「最後の一撃」の前に入れる短い無音 (ミリ秒)。
       * criticalRatio を初めて割った瞬間に 1 回だけ入ります。
       */
      hushMs: 420,
      /** 無音中に残す音量 (0 で完全な無音)。 */
      hushLevel: 0.12
    },

    /**
     * 演出。どれも短くします。長い演出はテンポを殺すためです。
     * 大ダメージのときは big 側の値を使います。
     */
    effects: {
      /** 命中で止まる時間 (ミリ秒)。 */
      hitstopMs: 55,
      bigHitstopMs: 130,
      /** 決着の一撃だけは長めに止めます。 */
      koHitstopMs: 260,

      /** 画面振動の強さ (px) と長さ (ミリ秒)。 */
      shake: 7,
      bigShake: 20,
      koShake: 34,
      shakeMs: 160,
      bigShakeMs: 300,

      /** 被弾した円が光る時間 (ミリ秒)。 */
      flashMs: 120,
      bigFlashMs: 220,

      /** ヒットエフェクトの寿命 (ミリ秒)。 */
      hitLifeMs: 260,
      /** 画面に残すエフェクトの上限。 */
      maxEffects: 80
    },

    /**
     * 戦況のエスカレーション。
     *
     * 時間が経つほどダメージが上がります。動画の後半ほど 1 発が重くなり、
     * 音の密度も上がる (audio.intensity) ので、終盤ほど盛り上がります。
     * 決着しないまま延々と続くのも防げます。
     */
    escalation: {
      /** ここから効き始める (ミリ秒)。 */
      fromMs: 25000,
      /** ここで最大 (ミリ秒)。 */
      toMs: 130000,
      /** 最大のときのダメージ倍率。 */
      maxMultiplier: 2.4
    },

    /** 武器アイテム。拾うと武器が変わります。 */
    items: {
      /** 最初に落ちるまで (ミリ秒)。 */
      firstDelayMs: 4500,
      /** 落ちる間隔 (ミリ秒)。1 試合で 6 種類が一巡するくらいの速さです。 */
      intervalMs: 5500,
      /** 同時に置ける数。 */
      maxAlive: 3,
      /** 拾われずに消えるまで (ミリ秒)。 */
      lifeMs: 14000,
      radius: 46,
      /** 壁からの最低距離 (px)。 */
      margin: 150,
      /** この距離までは、相手より武器を優先して取りに行きます。 */
      attractRadius: 820
    },

    /**
     * 武器。
     *
     *   kind … melee (振る) / gun (撃つ) / beam (照射する)
     *
     * damage は 1 発ぶん。命中して初めて HP が減り、HP が減って初めて
     * ヒット音が鳴ります (「撃ったから鳴る」ではありません)。
     */
    weapons: {
      order: ['hammer', 'sword', 'needle', 'pistol', 'shotgun', 'laser'],

      hammer: {
        id: 'hammer',
        name: 'HAMMER',
        kind: 'melee',
        color: '#fb923c',
        /** 1 発が重い。最大 HP の 10% を超えるので、必ず「大ダメージ」になります。 */
        damage: 105,
        cooldownMs: 1500,
        /** 振りかぶってから当たるまで (ミリ秒)。射出音はここで鳴ります。 */
        windupMs: 300,
        /** 届く距離 (円のふちからの px)。 */
        reach: 165,
        /** 判定の広さ (ラジアン)。 */
        arc: 1.3,
        /** 当たったときに相手を吹き飛ばす強さ。 */
        knockback: 1150,
        /** 武器の絵の回る速さ (ラジアン/秒)。 */
        spin: 3.0,
        sfx: { shot: 'hammer-shot', hit: 'hammer-hit' }
      },

      sword: {
        id: 'sword',
        name: 'LONG SWORD',
        kind: 'melee',
        color: '#a5f3fc',
        damage: 17,
        cooldownMs: 430,
        windupMs: 150,
        reach: 210,
        arc: 1.7,
        knockback: 380,
        spin: 8.5,
        sfx: { shot: 'sword-shot', hit: 'sword-hit' }
      },

      needle: {
        id: 'needle',
        name: 'INJECTION NEEDLE',
        kind: 'melee',
        color: '#a3e635',
        damage: 8,
        cooldownMs: 300,
        windupMs: 60,
        reach: 120,
        arc: 0.9,
        knockback: 120,
        spin: 12,
        /** 刺さると継続ダメージ。ここだけの特殊能力です。 */
        poison: { dps: 12, durationMs: 3200, tickMs: 400 },
        sfx: { shot: 'needle-shot', hit: 'needle-hit', extra: 'needle-poison' }
      },

      pistol: {
        id: 'pistol',
        name: 'PISTOL',
        kind: 'gun',
        color: '#fde047',
        damage: 21,
        cooldownMs: 760,
        pellets: 1,
        spread: 0.09,
        bulletSpeed: 1550,
        bulletRadius: 12,
        knockback: 260,
        spin: 0,
        sfx: { shot: 'pistol-shot', hit: 'pistol-hit' }
      },

      shotgun: {
        id: 'shotgun',
        name: 'SHOTGUN',
        kind: 'gun',
        color: '#f472b6',
        /** 1 粒ぶん。6 粒すべて当たれば 72。近いほど強い武器です。 */
        damage: 12,
        cooldownMs: 1650,
        pellets: 6,
        spread: 0.34,
        bulletSpeed: 1250,
        bulletRadius: 9,
        /** 散弾は飛ぶほど散って弱くなります。 */
        falloffFrom: 420,
        falloffTo: 1100,
        knockback: 190,
        spin: 0,
        sfx: { shot: 'shotgun-shot', hit: 'shotgun-hit' }
      },

      laser: {
        id: 'laser',
        name: 'LASER',
        kind: 'beam',
        color: '#c084fc',
        /** 照射中、tickMs ごとにこのダメージ。 */
        damage: 9,
        tickMs: 190,
        cooldownMs: 2900,
        /** 充填 (ウィーン) の時間。ここでは当たりません。 */
        chargeMs: 520,
        /** 照射している時間。 */
        beamMs: 1500,
        /** ビームの太さ (px)。 */
        width: 26,
        knockback: 90,
        spin: 0,
        sfx: {
          shot: 'laser-start',
          loop: 'laser-loop',
          hit: 'laser-hit',
          end: 'laser-end'
        }
      }
    },

    /**
     * 音。
     *
     * 音量は「重要度の順」で決めます。全部同じ音量にすると、何が起きたのかが
     * 音から分からなくなるためです:
     *
     *   移動 < アイテム = 射出 < 命中 < 大ダメージ < 最終攻撃
     */
    audio: {
      master: 0.85,
      sfx: 0.9,
      music: 0.4,

      /** 1 秒あたりに鳴らす音の総数の上限 (これを超えたら捨てます)。 */
      maxPerSecond: 26,

      /** 重要度ごとの音量。 */
      categories: {
        move: 0.16,
        pickup: 0.52,
        shot: 0.58,
        hit: 0.82,
        big: 0.95,
        final: 1.0,
        ui: 0.5
      },

      /**
       * 終盤ほど音を厚くする。
       * 戦況 (減った HP の合計) が進むほど、効果音全体をこの範囲で持ち上げます。
       */
      intensity: { from: 0.82, to: 1.15 },

      /**
       * BGM を入れても効果音が埋もれないように、大きい音が鳴った瞬間だけ
       * BGM を下げます (サイドチェイン)。
       */
      duck: { amount: 0.45, attackMs: 30, releaseMs: 420 },

      /**
       * 音源。file があればそれを読み、読めなければ synth から作ります。
       * ファイルを置くだけで差し替えられるように、名前とファイル名は 1 対 1 です。
       */
      dir: 'sounds/',
      sounds: {

        // ---------------------------------------------------- HAMMER
        /** 振りかぶり。低く重い「ドン」+ 風を切る重量感。 */
        'hammer-shot': {
          file: 'hammer-shot.wav', category: 'shot', minIntervalMs: 120,
          synth: {
            duration: 0.38,
            layers: [
              { type: 'sine', freq: [190, 52], sweep: 'exp', dur: 0.3, gain: 0.9, attack: 0.004, drive: 2.2 },
              { type: 'triangle', freq: [120, 44], sweep: 'exp', dur: 0.34, gain: 0.5, attack: 0.01 },
              { type: 'noise', dur: 0.32, delay: 0.04, gain: 0.34, attack: 0.09,
                filter: { type: 'lp', freq: [1100, 260], q: 0.8 } }
            ]
          }
        },
        /** 命中。「ドゴン」。一番低く、一番長く響きます。 */
        'hammer-hit': {
          file: 'hammer-hit.wav', category: 'big', minIntervalMs: 90,
          synth: {
            duration: 0.62,
            layers: [
              { type: 'sine', freq: [140, 34], sweep: 'exp', dur: 0.55, gain: 1.0, attack: 0.002, drive: 3.0 },
              { type: 'square', freq: [90, 40], sweep: 'exp', dur: 0.16, gain: 0.4, attack: 0.001, drive: 2.0 },
              { type: 'noise', dur: 0.4, gain: 0.55, attack: 0.001,
                filter: { type: 'lp', freq: [1800, 90], q: 0.9 } }
            ]
          }
        },

        // ------------------------------------------------ LONG SWORD
        /** 空を切る鋭い「シュッ」。短く、高く。 */
        'sword-shot': {
          file: 'sword-shot.wav', category: 'shot', minIntervalMs: 70,
          synth: {
            duration: 0.16,
            layers: [
              { type: 'noise', dur: 0.13, gain: 0.85, attack: 0.012,
                filter: { type: 'bp', freq: [5600, 1500], q: 2.6 } },
              { type: 'triangle', freq: [2600, 900], sweep: 'exp', dur: 0.1, gain: 0.18, attack: 0.004 }
            ]
          }
        },
        /** 斬撃ヒット。金属質の高い成分を足します。 */
        'sword-hit': {
          file: 'sword-hit.wav', category: 'hit', minIntervalMs: 60,
          synth: {
            duration: 0.26,
            layers: [
              { type: 'noise', dur: 0.09, gain: 0.9, attack: 0.001,
                filter: { type: 'bp', freq: [8200, 2400], q: 1.8 } },
              { type: 'square', freq: [1500, 520], sweep: 'exp', dur: 0.12, gain: 0.3, attack: 0.001, drive: 1.6 },
              { type: 'triangle', freq: 2350, dur: 0.22, gain: 0.16, attack: 0.002 },
              { type: 'sine', freq: [320, 110], sweep: 'exp', dur: 0.14, gain: 0.35, attack: 0.001 }
            ]
          }
        },

        // ------------------------------------------- INJECTION NEEDLE
        /** 一番静かな武器。ごく短い「チッ」。 */
        'needle-shot': {
          file: 'needle-shot.wav', category: 'shot', minIntervalMs: 55, gain: 0.55,
          synth: {
            duration: 0.07,
            layers: [
              { type: 'noise', dur: 0.028, gain: 0.5, attack: 0.001,
                filter: { type: 'hp', freq: 5200, q: 0.7 } },
              { type: 'sine', freq: [2100, 1300], sweep: 'exp', dur: 0.045, gain: 0.22, attack: 0.001 }
            ]
          }
        },
        /** 刺さった瞬間。小さく鋭い。 */
        'needle-hit': {
          file: 'needle-hit.wav', category: 'hit', minIntervalMs: 55, gain: 0.6,
          synth: {
            duration: 0.09,
            layers: [
              { type: 'noise', dur: 0.03, gain: 0.6, attack: 0.001,
                filter: { type: 'hp', freq: 7000, q: 0.8 } },
              { type: 'triangle', freq: [3200, 1800], sweep: 'exp', dur: 0.06, gain: 0.25, attack: 0.001 }
            ]
          }
        },
        /** 毒を注入した音。ヒット音の直後に鳴ります。 */
        'needle-poison': {
          file: 'needle-poison.wav', category: 'hit', minIntervalMs: 260, gain: 0.7,
          synth: {
            duration: 0.42,
            layers: [
              { type: 'triangle', freq: [880, 220], sweep: 'exp', dur: 0.38, gain: 0.4, attack: 0.02,
                vibrato: { rate: 17, depth: 0.28 } },
              { type: 'sine', freq: [420, 130], sweep: 'exp', dur: 0.34, gain: 0.28, attack: 0.03 }
            ]
          }
        },

        // ---------------------------------------------------- PISTOL
        /** 単発の「パンッ」。連射が遅いので 1 発ずつ聞き取れます。 */
        'pistol-shot': {
          file: 'pistol-shot.wav', category: 'shot', minIntervalMs: 90,
          synth: {
            duration: 0.22,
            layers: [
              { type: 'noise', dur: 0.11, gain: 0.95, attack: 0.001, drive: 1.8,
                filter: { type: 'lp', freq: [3600, 420], q: 0.9 } },
              { type: 'sine', freq: [260, 62], sweep: 'exp', dur: 0.12, gain: 0.6, attack: 0.001, drive: 1.6 },
              { type: 'noise', dur: 0.05, gain: 0.3, attack: 0.001,
                filter: { type: 'hp', freq: 4200, q: 0.8 } }
            ]
          }
        },
        'pistol-hit': {
          file: 'pistol-hit.wav', category: 'hit', minIntervalMs: 55,
          synth: {
            duration: 0.2,
            layers: [
              { type: 'noise', dur: 0.06, gain: 0.8, attack: 0.001,
                filter: { type: 'bp', freq: [2400, 900], q: 1.4 } },
              { type: 'sine', freq: [440, 120], sweep: 'exp', dur: 0.12, gain: 0.5, attack: 0.001, drive: 1.4 }
            ]
          }
        },

        // --------------------------------------------------- SHOTGUN
        /** 強い低音 + 散っていく粒。1 発で複数飛んだことが音で分かります。 */
        'shotgun-shot': {
          file: 'shotgun-shot.wav', category: 'big', minIntervalMs: 150,
          synth: {
            duration: 0.5,
            layers: [
              { type: 'sine', freq: [110, 30], sweep: 'exp', dur: 0.42, gain: 1.0, attack: 0.001, drive: 3.2 },
              { type: 'noise', dur: 0.3, gain: 0.9, attack: 0.001, drive: 1.6,
                filter: { type: 'lp', freq: [5200, 240], q: 0.9 } },
              // 少しずつ遅れて散る粒。ここが「複数飛んだ」感の正体です
              { type: 'noise', dur: 0.14, delay: 0.02, gain: 0.34, attack: 0.002,
                filter: { type: 'bp', freq: [3000, 1200], q: 1.2 } },
              { type: 'noise', dur: 0.12, delay: 0.045, gain: 0.26, attack: 0.002,
                filter: { type: 'bp', freq: [2200, 800], q: 1.2 } },
              { type: 'noise', dur: 0.2, delay: 0.07, gain: 0.2, attack: 0.01,
                filter: { type: 'hp', freq: 1800, q: 0.7 } }
            ]
          }
        },
        /** 複数ヒット。3 連の衝撃で「粒が続けて当たった」と分かります。 */
        'shotgun-hit': {
          file: 'shotgun-hit.wav', category: 'hit', minIntervalMs: 70,
          synth: {
            duration: 0.34,
            layers: [
              { type: 'noise', dur: 0.06, gain: 0.8, attack: 0.001,
                filter: { type: 'bp', freq: [2600, 900], q: 1.3 } },
              { type: 'noise', dur: 0.05, delay: 0.045, gain: 0.6, attack: 0.001,
                filter: { type: 'bp', freq: [2100, 700], q: 1.3 } },
              { type: 'noise', dur: 0.05, delay: 0.085, gain: 0.45, attack: 0.001,
                filter: { type: 'bp', freq: [1700, 600], q: 1.3 } },
              { type: 'sine', freq: [300, 70], sweep: 'exp', dur: 0.2, gain: 0.55, attack: 0.001, drive: 1.8 }
            ]
          }
        },

        // ----------------------------------------------------- LASER
        /** 充填。「ウィーン」と上がっていきます。 */
        'laser-start': {
          file: 'laser-start.wav', category: 'shot', minIntervalMs: 200,
          synth: {
            duration: 0.56,
            layers: [
              { type: 'saw', freq: [130, 920], sweep: 'exp', dur: 0.52, gain: 0.5, attack: 0.05, release: 'lin',
                filter: { type: 'lp', freq: [900, 4200], q: 0.9 } },
              { type: 'sine', freq: [260, 1840], sweep: 'exp', dur: 0.52, gain: 0.22, attack: 0.08, release: 'lin' },
              { type: 'noise', dur: 0.5, gain: 0.12, attack: 0.15, release: 'lin',
                filter: { type: 'bp', freq: [700, 3200], q: 1.6 } }
            ]
          }
        },
        /**
         * 照射中。**繰り返して鳴らす音**なので、始まりと終わりが同じ形に
         * なるようにしてあります (一定の音程・一定の音量・整数周期)。
         */
        'laser-loop': {
          file: 'laser-loop.wav', category: 'shot', loop: true, gain: 0.75,
          synth: {
            duration: 0.5,
            seamless: true,
            layers: [
              { type: 'saw', freq: 116, dur: 0.5, gain: 0.45, attack: 0, release: 'none',
                filter: { type: 'lp', freq: 2600, q: 1.1 }, vibrato: { rate: 24, depth: 0.06 } },
              { type: 'square', freq: 232, dur: 0.5, gain: 0.16, attack: 0, release: 'none' },
              { type: 'noise', dur: 0.5, gain: 0.1, attack: 0, release: 'none',
                filter: { type: 'bp', freq: 1800, q: 2.2 } }
            ]
          }
        },
        /** 照射中のダメージ音。tickMs ごとに鳴ります (毎フレームではありません)。 */
        'laser-hit': {
          file: 'laser-hit.wav', category: 'hit', minIntervalMs: 120, gain: 0.7,
          synth: {
            duration: 0.14,
            layers: [
              { type: 'square', freq: [760, 420], sweep: 'exp', dur: 0.08, gain: 0.45, attack: 0.001, drive: 1.5 },
              { type: 'noise', dur: 0.07, gain: 0.4, attack: 0.001,
                filter: { type: 'bp', freq: [3400, 1400], q: 1.8 } }
            ]
          }
        },
        /** 照射終了。短い電気的な停止音。 */
        'laser-end': {
          file: 'laser-end.wav', category: 'shot', minIntervalMs: 150, gain: 0.7,
          synth: {
            duration: 0.2,
            layers: [
              { type: 'saw', freq: [820, 90], sweep: 'exp', dur: 0.16, gain: 0.42, attack: 0.001,
                filter: { type: 'lp', freq: [3400, 400], q: 1.0 } },
              { type: 'noise', dur: 0.06, gain: 0.2, attack: 0.001,
                filter: { type: 'hp', freq: 3000, q: 0.8 } }
            ]
          }
        },

        // ------------------------------------------------- イベント音
        /** 武器を拾った。 */
        'item-pickup': {
          file: 'item-pickup.wav', category: 'pickup', minIntervalMs: 140,
          synth: {
            duration: 0.34,
            layers: [
              { type: 'triangle', freq: 880, dur: 0.07, gain: 0.5, attack: 0.002 },
              { type: 'triangle', freq: 1320, dur: 0.07, delay: 0.07, gain: 0.5, attack: 0.002 },
              { type: 'triangle', freq: 1760, dur: 0.18, delay: 0.14, gain: 0.55, attack: 0.002 }
            ]
          }
        },
        /** 壁や相手に当たって跳ねた。一番小さい音です。 */
        'bounce': {
          file: 'bounce.wav', category: 'move', minIntervalMs: 110, gain: 0.5,
          synth: {
            duration: 0.1,
            layers: [
              { type: 'sine', freq: [320, 150], sweep: 'exp', dur: 0.07, gain: 0.3, attack: 0.001 },
              { type: 'noise', dur: 0.03, gain: 0.12, attack: 0.001,
                filter: { type: 'lp', freq: [1200, 400], q: 0.7 } }
            ]
          }
        },
        /** 危険域に入った合図。うるさくならないよう間隔を長くとります。 */
        'danger': {
          file: 'danger.wav', category: 'ui', minIntervalMs: 900, gain: 0.6,
          synth: {
            duration: 0.3,
            layers: [
              { type: 'sine', freq: 1180, dur: 0.09, gain: 0.3, attack: 0.004 },
              { type: 'sine', freq: 1180, dur: 0.12, delay: 0.14, gain: 0.3, attack: 0.004 }
            ]
          }
        },
        /** 「あと一撃」。短い無音の直前に鳴る張りつめた音。 */
        'final-charge': {
          file: 'final-charge.wav', category: 'final', minIntervalMs: 2000,
          synth: {
            duration: 0.7,
            layers: [
              { type: 'sine', freq: [180, 1100], sweep: 'exp', dur: 0.6, gain: 0.5, attack: 0.15, release: 'lin' },
              { type: 'saw', freq: [90, 550], sweep: 'exp', dur: 0.6, gain: 0.22, attack: 0.2, release: 'lin',
                filter: { type: 'lp', freq: [600, 2600], q: 1.2 } }
            ]
          }
        },
        /** 撃破。決着の一撃そのもの。一番大きい音です。 */
        'ko-impact': {
          file: 'ko-impact.wav', category: 'final', minIntervalMs: 400,
          synth: {
            duration: 0.9,
            layers: [
              { type: 'sine', freq: [180, 28], sweep: 'exp', dur: 0.8, gain: 1.0, attack: 0.001, drive: 3.4 },
              { type: 'noise', dur: 0.5, gain: 0.8, attack: 0.001, drive: 1.8,
                filter: { type: 'lp', freq: [4200, 120], q: 0.9 } },
              { type: 'square', freq: [400, 60], sweep: 'exp', dur: 0.3, gain: 0.4, attack: 0.001, drive: 2.4 }
            ]
          }
        },
        /** 敗者。エネルギーが消えていく音。 */
        'defeat': {
          file: 'defeat.wav', category: 'final', minIntervalMs: 400,
          synth: {
            duration: 1.1,
            layers: [
              { type: 'saw', freq: [420, 38], sweep: 'exp', dur: 1.0, gain: 0.45, attack: 0.01,
                filter: { type: 'lp', freq: [2600, 200], q: 1.0 } },
              { type: 'sine', freq: [220, 30], sweep: 'exp', dur: 1.05, gain: 0.4, attack: 0.02 },
              { type: 'noise', dur: 0.9, gain: 0.22, attack: 0.02,
                filter: { type: 'lp', freq: [1800, 120], q: 0.8 } }
            ]
          }
        },
        /** 勝者。上がっていくエネルギーと短いファンファーレ。 */
        'victory': {
          file: 'victory.wav', category: 'final', minIntervalMs: 400,
          synth: {
            duration: 1.5,
            layers: [
              { type: 'saw', freq: [160, 1320], sweep: 'exp', dur: 0.5, gain: 0.3, attack: 0.12, release: 'lin',
                filter: { type: 'lp', freq: [900, 5200], q: 1.0 } },
              { type: 'triangle', freq: 880, dur: 0.14, delay: 0.42, gain: 0.5, attack: 0.004 },
              { type: 'triangle', freq: 1108, dur: 0.14, delay: 0.56, gain: 0.5, attack: 0.004 },
              { type: 'triangle', freq: 1320, dur: 0.5, delay: 0.7, gain: 0.6, attack: 0.004 },
              { type: 'square', freq: 660, dur: 0.5, delay: 0.7, gain: 0.2, attack: 0.01 },
              { type: 'sine', freq: [110, 220], sweep: 'exp', dur: 0.9, delay: 0.6, gain: 0.35, attack: 0.05 }
            ]
          }
        }
      }
    },

    /** 録画。ゲーム画面と**ゲーム音**をまとめて 1 本の動画にします。 */
    record: {
      fps: 60,
      /** 上から順に、ブラウザが対応しているものを使います。 */
      mimeTypes: [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ],
      videoBitsPerSecond: 12000000,
      audioBitsPerSecond: 192000,
      fileName: 'circle-battle'
    }
  };

  global.CB = global.CB || {};
  global.CB.VIDEO_CONFIG = VIDEO_CONFIG;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VIDEO_CONFIG: VIDEO_CONFIG };
  }
})(typeof window !== 'undefined' ? window : this);
