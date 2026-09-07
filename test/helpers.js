/**
 * テスト用の足場。ブラウザ無しで engine / router / session / leaderboard を組み立てる。
 *
 * 時計も乱数も外から渡すので、テストは実時間にも運にも左右されません。
 */
const { CONFIG } = require('../js/config.js');
const { BattleEngine } = require('../js/game.js');
const { GameSession } = require('../js/game-session.js');
const { EventRouter } = require('../js/event-router.js');
const { Leaderboard } = require('../js/leaderboard.js');
const { DemoDirector } = require('../js/demo.js');
const { Director } = require('../js/director.js');

/** CONFIG を壊さないように毎回コピーしてから上書きする (入れ子も辿る)。 */
function merge(base, overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      merge(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function makeConfig(overrides = {}) {
  return merge(JSON.parse(JSON.stringify(CONFIG)), overrides);
}

/** 決まった順で同じ数を返す乱数 (線形合同法)。テストが毎回同じ結果になります。 */
function seededRandom(seed = 12345) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function setup(options = {}) {
  const config = makeConfig(options.config);
  let clock = options.startTime || 1_000_000;
  const now = () => clock;
  const random = options.random || seededRandom(options.seed);

  const leaderboard = new Leaderboard({ config, now });
  const engine = new BattleEngine({ config, now, random });
  const session = new GameSession(engine, { config, leaderboard, now });
  const router = new EventRouter({ config, now });
  router.attach('live-1', session);
  const demo = new DemoDirector(session, { config, now, random });
  const director = new Director(engine, { config, now, random: options.directorRandom || random });

  const kills = [];
  session.on('kill', (kill) => kills.push(kill));

  engine.start(clock);

  return {
    config, engine, session, router, leaderboard, demo, director, kills, random,
    now: () => clock,
    /** 時計を進めて 1 フレームぶん動かす。 */
    advance(ms, { steps = 1, withDemo = false } = {}) {
      const step = ms / steps;
      for (let i = 0; i < steps; i += 1) {
        clock += step;
        if (withDemo) demo.update(clock);
        engine.update(clock);
      }
      return clock;
    },
    /** TikTok の生イベントを 1 件流す (本番と同じ経路)。 */
    send(raw) { return router.dispatch('live-1', raw); },
    /** ゲームイベントを直接流す (翻訳を飛ばしたいとき)。 */
    handle(event) { return session.handle(event); }
  };
}

module.exports = { setup, makeConfig, seededRandom };
