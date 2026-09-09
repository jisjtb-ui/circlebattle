/**
 * VIDEO BATTLE MODE のテスト用の足場。
 *
 * ブラウザ無しで engine と音の判断を組み立てます。時計も乱数も外から
 * 渡すので、テストは実時間にも運にも左右されません。
 */
const { VIDEO_CONFIG } = require('../js/video-config.js');
const { VideoBattle } = require('../js/video-battle.js');
const { VideoAudio } = require('../js/video-audio.js');
const { VideoSoundDirector } = require('../js/video-sound-director.js');

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
  return merge(JSON.parse(JSON.stringify(VIDEO_CONFIG)), overrides);
}

/** 決まった順で同じ数を返す乱数 (線形合同法)。 */
function seededRandom(seed = 4242) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 鳴らした音を記録するだけの偽ミキサー。
 * 「何が・どの重要度で鳴ったか」を順番どおりに確かめられます。
 */
function fakeAudio() {
  return {
    played: [],
    loops: [],
    hushes: [],
    intensity: 0,
    play(name, opts = {}) { this.played.push({ name, ...opts }); return true; },
    startLoop(name, key) { this.loops.push({ start: name, key }); return true; },
    stopLoop(key) { this.loops.push({ stop: key }); return true; },
    stopAllLoops() { this.loops.push({ stopAll: true }); },
    hush(ms, level) { this.hushes.push({ ms, level }); },
    setIntensity(value) { this.intensity = value; },
    names() { return this.played.map((entry) => entry.name); }
  };
}

/**
 * @param {object} [options] { config, startTime, seed, withSound }
 */
function setup(options = {}) {
  const config = makeConfig(options.config);
  let clock = options.startTime || 1_000_000;
  const now = () => clock;
  const random = options.random || seededRandom(options.seed);

  const battle = new VideoBattle({ config, now, random });
  const audio = options.withSound === false ? null : fakeAudio();
  if (audio) new VideoSoundDirector({ battle, audio, config });

  const hits = [];
  const events = [];
  ['hit', 'miss', 'shot', 'pickup', 'level', 'hush', 'ko', 'poison', 'beam:start', 'beam:end']
    .forEach((name) => battle.on(name, (payload) => events.push({ name, payload })));
  battle.on('hit', (hit) => hits.push(hit));

  battle.start(clock);

  return {
    config, battle, audio, hits, events, random,
    red: battle.fighters.red,
    blue: battle.fighters.blue,
    now: () => clock,
    /** 時計を進めて動かす。step ごとに 1 フレーム回します。 */
    advance(ms, { step = 16 } = {}) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + step);
        battle.update(clock);
      }
      return clock;
    },
    /** 2 つの円を指定の距離で向かい合わせる。 */
    place(gap = 40) {
      const red = battle.fighters.red;
      const blue = battle.fighters.blue;
      const y = config.field.height / 2;
      red.position = { x: config.field.width / 2 - red.radius - gap / 2, y };
      blue.position = { x: config.field.width / 2 + blue.radius + gap / 2, y };
      red.velocity = { x: 0, y: 0 };
      blue.velocity = { x: 0, y: 0 };
    },
    /** その名前のイベントだけ取り出す。 */
    of(name) { return events.filter((entry) => entry.name === name).map((entry) => entry.payload); }
  };
}

module.exports = { setup, makeConfig, seededRandom, fakeAudio, VideoAudio };
