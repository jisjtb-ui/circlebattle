# CIRCLE BATTLE

TikTok LIVE 連動のバトルゲーム。

```
        【自動生成される敵】
                VS
        【TikTok LIVE 視聴者】
```

視聴者が **LIKE / FOLLOW / SHARE / GIFT** をすると、その人専用の円が生まれます。
円は自動生成される敵を攻撃し、倒した数とスコアで **TOP 10 PLAYER** を競います。

チームはありません。`Team A` / `Team B` のような固定の陣営概念は 1 つも実装していません。
並ぶのは常に個人です。

TikTok の接続部分は **KAWAII VS BEAUTIFUL / tikhub で作ったものをそのまま使います**
(→ [8. 既存システムとの関係](#8-既存システムとの関係))。

---

## 1. 動かす

`index.html` をブラウザで開くだけです (`file://` で動きます)。

| URL | 用途 |
| --- | --- |
| `index.html` | テストパネル付き (開発・動作確認用) |
| `index.html?obs=1` | 配信画面のみ (OBS 用) |
| `index.html?offline=1` | TikTok に繋がない |
| `index.html?demo=0` | デモ視聴者を出さない |
| `index.html?sound=0` | 効果音を鳴らさない (`?mute=1` も同じ) |
| `index.html?sort=kills` | ランキングの基準を変える (`score` / `kills` / `damage`) |
| `index.html?ranking=right` | ランキングの位置を固定する (`right` / `below` / `auto`) |

**TikTok の実配信と繋ぐ場合**は tikhub を起動し、出てくる URL を開きます
(→ [8.3](#83-tikhub-から配信する))。

ルールのテスト:

```
npm test     # 67 件。ブラウザ不要
npm run check
```

---

## 2. 視聴者から見たルール

| 操作 | 起きること |
| --- | --- |
| **いいね 10 回** | 弱い円が 1 個 (20 回で 2 個、100 回で 10 個) |
| **フォロー** | 中くらいの円が 1 個 |
| **シェア** | 中くらいの円が 1 個 |
| **ギフト** | コイン価値ぶん強い円が 1 個 |
| コメント | 何も起きません (将来のコマンド用に受け取るだけ) |

- いいねの端数は**ユーザーごとに**次へ持ち越します。7 + 5 = 12 で 1 個出て、2 が残ります。
- 円には**プロフィール画像**が入ります。取れなければ頭文字のアイコンになります。
- 円は敵を自動で追いかけて攻撃します。視聴者の操作は要りません。
- 敵を倒すと**撃破ポイント**が入り、ランキングが即座に更新されます。

---

## 3. 画面

```
┌──────────────────────────┐
│ CIRCLE BATTLE            │
│ ENEMIES DEFEATED         │
│ 1234                     │
├──────────────────────────┤
│                          │
│    ○      ●      ○       │  ← 正方形のバトルフィールド
│         ●     ○          │     ● 敵 / ○ 視聴者の円
│   ○         ●            │
│                          │
├──────────────────────────┤
│ TOP 10 PLAYER      SCORE │
│ 1 @PlayerA     128 SCORE │
│ 2 @PlayerB      96 SCORE │
│ …                        │
└──────────────────────────┘
```

TikTok LIVE の縦画面 (9:16) を想定した配置です。
ランキングは**常時表示**で、縦画面ではフィールドの下、横長の画面では右に出ます
(`ui.rankingPosition` で固定できます)。11 位以下は表示しません。

---

## 4. 止まらない画面

**このゲームの最重要仕様です。** TikTok のイベントが 1 件も来なくても、画面は動き続けます。

- 敵は一定間隔で自動生成され、常にフィールド内を動きます
- 敵が下限を割ったら、間隔を待たずに補充します
- 敵同士・円同士は重なったままにならないよう押し離します
- 誰も反応していない間は**デモ視聴者**が円を出し、戦闘が続きます
  (本物の視聴者のイベントが 1 件でも届いたら、デモは止まって記録も円も引き上げます)

`test/idle-loop.test.js` が、イベント 0 件のまま 60 秒回して
「敵が出続ける / 戦闘が起きる / 敵が倒れる / ランキングが動く」を確認しています。

---

## 5. 効果音

音源ファイルは要りません。**WebAudio でその場で合成**しているので、
`file://` で開いても、素材を配らなくても鳴ります。

| いつ | 音 |
| --- | --- |
| 敵に当たった | 短い打撃音 (いちばんよく鳴るので小さめ) |
| 敵を倒した | 「ドーン」。**敵が大きいほど低い音**になります |
| 視聴者の円が力尽きた | 低い短音 |
| LIKE で円が出た | 小さな上がり音 |
| FOLLOW / SHARE | 2 音 |
| GIFT | 3 音の上がり |
| ランキング 1 位が入れ替わった | ベル |

- 撃破もダメージも 1 秒に何十回も起きるので、**音ごとの最短間隔**と
  **1 秒あたりの上限**で間引いています (`config.audio`)。潰れて聞こえなくなりません。
- 敵ごとの音の高さは `enemies.types[].killPitch` です。敵を足すときに一緒に決められます。
- ブラウザは操作前の自動再生を止めます。止められている間は画面に
  「🔇 クリックで音が出ます」と出て、**最初のクリックで鳴り始めます**
  (ゲームの進行は止まりません)。OBS のブラウザソースはそのまま鳴ります。
- テストパネルの `SOUND ON` / `VOL` で切り替えと音量調整ができます。
  配信中にコンソールからでも変えられます。

```js
CB.sfx.toggle();        // 入 / 切
CB.sfx.setVolume(0.2);  // 音量
```

音量の初期値は `config.audio.volume` (既定 0.35)。BGM を流すなら下げてください。

---

## 6. 設定

調整値はすべて [`js/config.js`](js/config.js) にあります。ゲームのコードに数値はありません。

### 6.1 敵の種類を足す

`enemies.types` に 1 行足すだけです。ゲーム側は id を見ないので、それだけで出てきます。

```js
{ id: 'megaboss', label: 'MEGA', hp: 20000, radius: 90, speed: 18,
  attack: 120, attackIntervalMs: 600, points: 500, weight: 1, color: '#a855f7' }
```

実行中に足すこともできます (イベントボスなどを想定):

```js
CB.engine.addEnemyType({ id: 'event-boss', /* ... */ });
CB.engine.spawnEnemy('event-boss');
```

| 種類 | HP | 撃破ポイント |
| --- | --- | --- |
| NORMAL | 100 | +1 |
| STRONG | 300 | +5 |
| ELITE | 1000 | +20 |
| BOSS | 5000 | +100 |

### 6.2 円の強さ

イベントごとに違うのは **strength という 1 つの数字だけ**です。
HP / 攻撃力 / 半径 / 速度はそこから計算されます (`viewers.base` と `viewers.scaling`)。

```
LIKE   strength 1
FOLLOW strength 4
SHARE  strength 4
GIFT   strength = baseStrength + coins * strengthPerCoin
```

ギフトはギフト名も ID も見ません。**コイン価値の数字だけ**を見るので、
新しいギフトが増えても何もしなくて構いません
(特定のギフトだけ重み付けを変えたいときは `gifts.byId` / `gifts.byName`)。

### 6.3 撃破ポイントの配り方

```js
scoring: {
  mode: 'lastHit',        // 'lastHit' | 'damage'
  killCredit: 'lastHit',  // 'lastHit' | 'topDamage'
  pointsPerDamage: 0
}
```

- `lastHit` … とどめを刺した人が全ポイントを取る (初期設定)
- `damage` … 与えたダメージの割合でポイントを分ける

どちらでも動くように、敵は**常に「誰がどれだけ削ったか」を記録**しています。
KILL 数だけは 1 人にしか付きません (割ると整数でなくなるため)。

### 6.4 ランキングの基準

```js
ranking: { sortBy: 'score', order: 'desc', size: 10 }
```

`score` / `kills` / `damage` のどれでも並べられます。実行中にも変えられます。

```js
CB.leaderboard.setSort('kills');
```

---

## 7. 作り

```
TikTok Event  ->  Game Event  ->  Battle Entity  ->  Enemy  ->  Battle  ->  Leaderboard
```

| ファイル | 役割 | TikTok を知っているか |
| --- | --- | --- |
| `js/tiktok-adapter.js` | 中継サーバーからイベントを受け取る | **はい** |
| `js/event-router.js` | TikTok の語彙をゲームイベントへ翻訳する | **はい (ここが最後)** |
| `js/game-session.js` | イベント -> 円の生成 / ポイントの配分 | いいえ |
| `js/game.js` | 敵の生成・移動・衝突・戦闘 (バトルエンジン) | いいえ |
| `js/leaderboard.js` | ユーザーごとの成績とランキング | いいえ |
| `js/demo.js` | 誰も居ない間の仮の視聴者 | いいえ |
| `js/avatars.js` | プロフィール画像のキャッシュ | いいえ |
| `js/audio.js` | 効果音 (WebAudio で合成) | いいえ |
| `js/renderer.js` | 画面 (canvas + DOM) | いいえ |
| `js/config.js` | すべての調整値 | いいえ |

**ゲーム側は TikTok Connector を直接操作しません。**
`game.js` / `game-session.js` / `leaderboard.js` に `giftId` も `uniqueId` も出てきません。
別の配信サービスを足すときは、アダプタとルーターをもう 1 組書くだけで済みます。

複数 LIVE を同時に受けるときは、LIVE ごとに engine + session を作って
`router.attach(liveId, session)` します。

将来足せるように分けてあるもの: 敵の種類 / ボス / イベントボス / ランキング報酬 /
ユーザーレベル / 装備 / 特殊攻撃 / ギフト専用攻撃 / 視聴者同士の戦闘 / PvP / 複数 LIVE 接続。

### 7.1 視聴者の円が持つ情報

```js
{ id, ownerId, ownerName, displayName, profileImageUrl, sourceEvent,
  strength, hp, maxHp, attack, radius, speed,
  position: { x, y }, velocity: { x, y }, kills, damage, bornAt }
```

### 7.2 ランキングが持つ情報

```js
{ userId, userName, profileImageUrl, kills, damage, score, lastActivity }
```

---

## 8. 既存システムとの関係

**TikTok 接続は作り直していません。** 既存の 2 つをそのまま使います。

### 8.1 再利用しているもの

| 元 | 何を | どう使ったか |
| --- | --- | --- |
| tikhub | TikTok LIVE への接続、イベントの正規化、SSE 中継、ゲームの配信 | **そのまま**。ゲーム側の変更は不要 |
| kawaiivsbeautiful | `js/tiktok-adapter.js` (SSE / WebSocket 受信、`/connect` 操作) | **ほぼそのまま**。名前空間を `KVB` -> `CB` に変えただけ |
| kawaiivsbeautiful | Adapter -> Router -> Session という層の分け方 | 同じ形を踏襲 |

tikhub に 1 つだけ足したもの: **プロフィール画像の取り出し**
(`normalizeUser` に `profileImageUrl` を追加)。既存のフィールドは変えていないので、
KAWAII VS BEAUTIFUL は今までどおり動きます。

### 8.2 新しく作ったもの

`js/config.js` / `js/event-router.js` (SHARE とプロフィール画像に対応した版) /
`js/game.js` / `js/game-session.js` / `js/leaderboard.js` / `js/demo.js` /
`js/avatars.js` / `js/audio.js` / `js/renderer.js` / `js/controls.js` / `js/main.js` /
`index.html` / `css/style.css`

### 8.3 tikhub から配信する

tikhub は同じ場所に並んでいるゲームのフォルダを**全部**探して配信します。
KAWAII VS BEAUTIFUL と両方置いていれば、起動時に両方の URL が出ます。

```
起動:  npm start          （TikTok の実配信に繋ぐ）
       npm run mock       （TikTok に繋がず動作確認）

  ゲームが 2 つ見つかりました。使うほうの URL を開いてください
      http://127.0.0.1:8787/kawaiivsbeautiful/   KAWAII vs BEAUTIFUL
      http://127.0.0.1:8787/circlebattle/        CIRCLE BATTLE
```

`http://127.0.0.1:8787/` を開くと選択画面が出ます。
1 つに固定したいときは `npm start -- --game="../circlebattle"`。

イベントの中継 (`/events`) は 1 本だけで、**どちらのゲームからでも同じものを受け取ります**。
2 つ同時に開いて見比べることもできます。

画面下のパネルに LIVE の URL / `@ユーザー名` を貼って CONNECT でも繋げます。

### 8.4 受け取っているイベント

`COMMENT` / `LIKE` / `FOLLOW` / `SHARE` / `GIFT` と、
`USER ID` / `USERNAME` / `PROFILE IMAGE`。

コメントは今回のゲームでは何も起こしませんが、
将来のコマンド (例: 特殊攻撃) 用にイベントとしては届いています。

```js
CB.session.on('comment', (c) => console.log(c.user.uniqueId, c.text));
```

---

## 9. コンソールから試す

```js
// 本番と同じ経路で 1 件流し込む
CB.tiktok.handleEvent({ type: 'like',   user: { uniqueId: 'taro' }, count: 100 });
CB.tiktok.handleEvent({ type: 'follow', user: { uniqueId: 'taro' } });
CB.tiktok.handleEvent({ type: 'share',  user: { uniqueId: 'taro' } });
CB.tiktok.handleEvent({ type: 'gift',   user: { uniqueId: 'taro' }, diamondCount: 100 });

CB.engine.spawnEnemy('boss');      // 敵を出す
CB.leaderboard.setSort('kills');   // ランキングの基準を変える
CB.sfx.toggle();                   // 効果音の入 / 切
CB.reset();                        // 全部やり直す
```
