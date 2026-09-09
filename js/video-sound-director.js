/**
 * video-sound-director.js - ゲームで起きたことを音に翻訳する。
 *
 * ここが「攻撃したから音が鳴る」を避けるための層です。engine が出す
 * イベントと音は 1 対 1 で対応していて、
 *
 *   'shot'       → 武器ごとの射出音
 *   'miss'       → **鳴らしません** (外れたことは音の不在で伝えます)
 *   'hit'        → 武器ごとのヒット音 (HP が減ったときだけ)
 *   'poison'     → 毒付与音
 *   'beam:start' → 照射のループ音を始める
 *   'beam:end'   → ループを止めて、停止音
 *   'pickup'     → アイテム取得音
 *   'bounce'     → 移動の音 (一番小さい)
 *   'level'      → 危険域に入った合図
 *   'hush'       → 最後の一撃の前の短い無音
 *   'ko'         → 撃破音 + 敗北音 + 勝利音
 *
 * 音量は video-audio.js の categories が決めます。ここでは「大ダメージなら
 * big、決着なら final」というように**重要度だけ**を渡します。
 */
(function (global) {
  'use strict';

  function VideoSoundDirector(options) {
    options = options || {};
    this.battle = options.battle;
    this.audio = options.audio;
    this.config = options.config || this.battle.config;
    if (!this.battle || !this.audio) throw new Error('VideoSoundDirector: battle と audio が要ります');

    this._attach();
  }

  VideoSoundDirector.prototype._attach = function () {
    var self = this;
    var battle = this.battle;
    var audio = this.audio;

    // ---------------------------------------------------------- 射出
    battle.on('shot', function (shot) {
      var sfx = shot.weapon.sfx;
      if (!sfx || !sfx.shot) return;
      audio.play(sfx.shot, { at: shot.at, category: 'shot' });
    });

    // ---------------------------------------------------------- 命中
    battle.on('hit', function (hit) {
      // 毒の継続ダメージはヒット音を鳴らしません (0.4 秒ごとに鳴ると耳障りです)
      if (hit.silent) return;

      var sfx = hit.weapon.sfx;
      if (!sfx || !sfx.hit) return;

      /*
       * 決着の一撃は専用の音です。短い無音のあとに来るので、ここが
       * 動画の中で一番大きな音になります。
       */
      if (hit.lethal) {
        audio.play('ko-impact', { at: hit.at, category: 'final', force: true });
        return;
      }

      audio.play(sfx.hit, {
        at: hit.at,
        category: hit.big ? 'big' : undefined,
        // 大ダメージは少し低く鳴らします (同じ音でも重く聞こえます)
        rate: hit.big ? 0.88 : 1
      });
    });

    // 毒。ヒット音の直後に 1 回だけ
    battle.on('poison', function (event) {
      var sfx = event.weapon.sfx;
      if (sfx && sfx.extra) audio.play(sfx.extra, { at: event.at });
    });

    // -------------------------------------------------------- LASER
    battle.on('beam:start', function (event) {
      var sfx = event.weapon.sfx;
      if (sfx && sfx.loop) audio.startLoop(sfx.loop, 'beam:' + event.fighter.id);
    });

    battle.on('beam:end', function (event) {
      audio.stopLoop('beam:' + event.fighter.id);
      var sfx = event.weapon.sfx;
      if (sfx && sfx.end && !event.aborted) audio.play(sfx.end, { at: event.at, category: 'shot' });
    });

    // ------------------------------------------------------ そのほか
    battle.on('pickup', function (taken) {
      audio.play('item-pickup', { at: taken.at, category: 'pickup' });
    });

    battle.on('bounce', function (event) {
      audio.play('bounce', { at: event.at, category: 'move' });
    });

    battle.on('level', function (event) {
      // 危険域に入った合図。30% の時点では鳴らしません (鳴りすぎるため)
      if (event.level === 'danger' || event.level === 'critical') {
        audio.play('danger', { at: event.at, category: 'ui' });
      }
    });

    /*
     * 「あと一撃」。
     *
     *   張りつめた音 → 短い無音 → 最後の一撃
     *
     * の順で、最後の一撃を際立たせます。無音は audio 側が
     * 効果音バスを一時的に下げて作ります。
     */
    battle.on('hush', function (event) {
      audio.play('final-charge', { at: event.at, category: 'final', force: true });
      audio.hush(self.config.hp.hushMs, self.config.hp.hushLevel);
    });

    // ---------------------------------------------------------- 決着
    battle.on('ko', function (ko) {
      // 敗者が消える音と、勝者の音を**同じ瞬間**に始めます。
      // 画面の WINNER もこの ko の時刻から動くので、音と表示がずれません。
      audio.play('defeat', { at: ko.at, category: 'final', force: true });
      audio.play('victory', { at: ko.at, category: 'final', force: true });
      audio.stopAllLoops();
    });

    // 戦況が進むほど音を厚くします (序盤は軽く、終盤は迫力が出ます)
    battle.on('tick', function (tick) {
      audio.setIntensity(battle.intensity(tick.at));
    });

    battle.on('reset', function () {
      audio.stopAllLoops();
      audio.setIntensity(0);
    });
  };

  global.CB = global.CB || {};
  global.CB.VideoSoundDirector = VideoSoundDirector;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoSoundDirector: VideoSoundDirector };
  }
})(typeof window !== 'undefined' ? window : this);
