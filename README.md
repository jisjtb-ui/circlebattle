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
(→ [10. 既存システムとの関係](#10-既存システムとの関係))。

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
(→ [10.3](#103-tikhub-から配信する))。

ルールのテスト:

```
npm test     # 104 件。ブラウザ不要
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

フィールドにはときどき**アイテム**が落ちます。視聴者の円が触れると拾えます（→ [5. アイテム](#5-アイテム)）。

- いいねの端数は**ユーザーごとに**次へ持ち越します。7 + 5 = 12 で 1 個出て、2 が残ります。
- 円は**足し算**です。10 個出ている人が 100 LIKE すれば 20 個になります。
  上限は 1 人 100 個 / 全体 400 個ですが、これは画面が破綻しないための安全弁で、
  視聴者が少ないうちは届きません (`viewers.limits`)。
- 円には**その人の TikTok プロフィール画像**が入ります。取れなければ頭文字のアイコンです。
- 円も敵も**等速直線運動**です。速さも向きも変わらず、壁で反射するだけなので、
  次にどこへ行くか・どこでぶつかるかが見て分かります。
- 敵に当たるとダメージを与えます。倒すと**撃破ポイント**が入り、ランキングが即座に更新されます。

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

## 4. 円の動きとアイコン

### 動き

円も敵も**等速直線運動**で、**ぶつかると跳ね返ります**（ビリヤードと同じ）。

- 生まれたときの向きと速さのまま進み、**壁で反射**します
- 向きを変えるのは、壁か他の円にぶつかったときだけ。追いかけたり、ふらついたりしません
- **大きい円ほど押し勝ちます**（質量は半径から決まるので、ボスは小さい円に当たっても揺るぎません）
- 跳ね返ったあとも**速さは変わりません**。当たりどころで円が止まってしまわないようにしてあります

盤面が読めるので「あの円があの敵に当たりそう」が見て分かります。
動きを変えたいときは `js/config.js` で:

```js
collision: { bounce: false }                // 跳ね返らず、押し離すだけ
collision: { restitution: 0.6 }             // 跳ね返りを弱く
collision: { massFromRadius: false }         // 大きさに関係なく同じ重さ
enemies: { movement: { mode: 'wander' } }   // ふらふら + 視聴者円に寄る
viewers: { movement: { mode: 'seek' } }     // 最寄りの敵を追いかける
```

跳ね返るということは、**1 回の接触で殴れるのは 1 発だけ**ということです
（張り付いて削り続けられません）。そのぶん円は 1 発が重く、打たれ強くしてあります
（`viewers.base` の `hp` と `attack`）。ここを跳ね返る前の値に戻すと、
当たっても敵を倒せず自分だけ減っていきます。

当たり判定はフィールドを格子に切って隣の升だけを見るので、
円が 400 個あっても 1 フレーム 0.1ms 程度で、増えても重くなりません。

### アイコン

TikTok から取れたプロフィール画像を、そのまま円の中に描きます。

- 画像は**ユーザーごとに 1 回だけ**取得してキャッシュします（毎フレーム取りにいきません）
- 取れなかった / 読み込みに失敗した場合は、頭文字と色のアイコンになります
- ランキングの行にも同じ画像が出ます
- アイコンが見える大きさになるよう、視聴者円は直径 40px 以上（1080 幅換算）にしてあります。
  ギフトが大きいほど円も大きくなります（`viewers.base.radius` と `scaling.maxRadius`）

画像が出ない場合は **tikhub 側が新しいか**を確認してください
（プロフィール画像を送るようになったのはこのブランチからです）。

---

## 5. アイテム

ときどきフィールドにアイテムが落ちます。**拾えるのは視聴者の円だけ**で、
敵は触れても素通りします（敵が強くなると視聴者の不利益になるため）。

| アイテム | 効果 |
| --- | --- |
| **POWER** | **100 コインのギフトと同じ強さ**まで引き上げ、HP を全快 |
| **SPEED** | 速くなる（何度拾っても、その円の元の速さの 2.4 倍まで） |

- **拾って弱くなることはありません。** エンジンは「今の値より大きいほう」しか採らないので、
  HP も攻撃力も大きさも速さも下がりません。すでに 100 コイン相当より強い円が POWER を
  拾った場合も、弱くはならず HP が全快します。
- POWER の強さはギフトと**同じ換算式**（`viewers.gift`）を通します。ギフトの設定を変えれば
  アイテムも一緒に変わるので、片方だけずれることはありません。
- 14 秒ごとに 1 つ、同時に 3 つまで。30 秒で消えます（消える前は点滅します）。
- 拾われないまま消えても、誰も損をしません。

種類は `js/config.js` の `items.types` に 1 行足すだけで増やせます。

```js
{ id: 'mega', label: 'MEGA', color: '#a855f7', weight: 1,
  effect: { type: 'strength', giftCoins: 500 } }
```

実行中に足すこともできます。

```js
CB.engine.addItemType({ id: 'event', label: 'EVENT', color: '#fff', weight: 0,
                        effect: { type: 'speed', multiplier: 2, maxMultiplier: 3 } });
CB.engine.spawnItem('event');     // その場に 1 つ置く
```

---

## 6. 止まらない画面

**このゲームの最重要仕様です。** TikTok のイベントが 1 件も来なくても、画面は動き続けます。

- 敵は一定間隔で自動生成され、常にフィールド内を動きます
- 敵が下限を割ったら、間隔を待たずに補充します
- 敵同士・円同士は重なったままにならないよう押し離します
- 誰も反応していない間は**デモ視聴者**が円を出し、戦闘が続きます

本物の視聴者のイベント（LIKE など）が 1 件でも届いたら、デモは止まります。
このとき円は**1 つずつ**引き上げます（`demo.retireIntervalMs`）。一斉に消すと、
最初の LIKE の瞬間に画面の円が全部消えて**リセットされたように見える**ためです。
ランキングの記録はその場で消え、引き上げ中の円が敵を倒しても点は入りません。

`test/idle-loop.test.js` が、イベント 0 件のまま 60 秒回して
「敵が出続ける / 戦闘が起きる / 敵が倒れる / ランキングが動く」を確認しています。

---

## 7. 効果音

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
| アイテムを拾った | 3 音の上がり |
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

## 8. 設定

調整値はすべて [`js/config.js`](js/config.js) にあります。ゲームのコードに数値はありません。

### 8.1 敵の種類を足す

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

### 8.2 円の強さ

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

### 8.3 撃破ポイントの配り方

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

### 8.4 ランキングの基準

```js
ranking: { sortBy: 'score', order: 'desc', size: 10 }
```

`score` / `kills` / `damage` のどれでも並べられます。実行中にも変えられます。

```js
CB.leaderboard.setSort('kills');
```

---

## 9. 作り

```
TikTok Event  ->  Game Event  ->  Battle Entity  ->  Enemy  ->  Battle  ->  Leaderboard
```

| ファイル | 役割 | TikTok を知っているか |
| --- | --- | --- |
| `js/tiktok-adapter.js` | 中継サーバーからイベントを受け取る | **はい** |
| `js/event-router.js` | TikTok の語彙をゲームイベントへ翻訳する | **はい (ここが最後)** |
| `js/game-session.js` | イベント -> 円の生成 / ポイントの配分 | いいえ |
| `js/game.js` | 敵とアイテムの生成・移動・衝突・戦闘 (バトルエンジン) | いいえ |
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

### 9.1 視聴者の円が持つ情報

```js
{ id, ownerId, ownerName, displayName, profileImageUrl, sourceEvent,
  strength, hp, maxHp, attack, radius, speed,
  position: { x, y }, velocity: { x, y }, kills, damage, bornAt }
```

### 9.2 ランキングが持つ情報

```js
{ userId, userName, profileImageUrl, kills, damage, score, lastActivity }
```

---

## 10. 既存システムとの関係

**TikTok 接続は作り直していません。** 既存の 2 つをそのまま使います。

### 10.1 再利用しているもの

| 元 | 何を | どう使ったか |
| --- | --- | --- |
| tikhub | TikTok LIVE への接続、イベントの正規化、SSE 中継、ゲームの配信 | **そのまま**。ゲーム側の変更は不要 |
| kawaiivsbeautiful | `js/tiktok-adapter.js` (SSE / WebSocket 受信、`/connect` 操作) | **ほぼそのまま**。名前空間を `KVB` -> `CB` に変えただけ |
| kawaiivsbeautiful | Adapter -> Router -> Session という層の分け方 | 同じ形を踏襲 |

tikhub に 1 つだけ足したもの: **プロフィール画像の取り出し**
(`normalizeUser` に `profileImageUrl` を追加)。既存のフィールドは変えていないので、
KAWAII VS BEAUTIFUL は今までどおり動きます。

### 10.2 新しく作ったもの

`js/config.js` / `js/event-router.js` (SHARE とプロフィール画像に対応した版) /
`js/game.js` / `js/game-session.js` / `js/leaderboard.js` / `js/demo.js` /
`js/avatars.js` / `js/audio.js` / `js/renderer.js` / `js/controls.js` / `js/main.js` /
`index.html` / `css/style.css`

### 10.3 tikhub から配信する

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

### 10.4 受け取っているイベント

`COMMENT` / `LIKE` / `FOLLOW` / `SHARE` / `GIFT` と、
`USER ID` / `USERNAME` / `PROFILE IMAGE`。

コメントは今回のゲームでは何も起こしませんが、
将来のコマンド (例: 特殊攻撃) 用にイベントとしては届いています。

```js
CB.session.on('comment', (c) => console.log(c.user.uniqueId, c.text));
```

---

## 11. 繋がらないとき

画面右上が「中継サーバー未接続」のままのときは、括弧の中に**どこを見にいっているか**が出ます。

| 状態 | 意味 |
| --- | --- |
| `LIVE @名前` | 配信に繋がっている（正常） |
| `中継サーバーに接続済み` | tikhub には繋がったが、まだ配信を指定していない |
| `配信の開始を待っています` | 指定した人がまだ配信していない |
| `中継サーバー未接続 (127.0.0.1:8787)` | tikhub が動いていない / 別のポートで動いている |

順に確認してください。

1. **tikhub が動いているか。** `http://127.0.0.1:8787/health` をブラウザで開いて
   `{"ok":true...}` が出れば動いています。
2. **ポートが違わないか。** 8787 が埋まっていると tikhub は `--serve=8788` などで
   起動されている場合があります。そのときは `?bridge=http://127.0.0.1:8788/events` を
   URL の後ろに付けてください。
3. **別の PC の tikhub に繋ぐ場合。** `?bridge=http://その PC の IP:8787/events` を付け、
   tikhub 側は `BRIDGE_HOST=0.0.0.0` で起動します。

ゲームは **tikhub 以外の場所から開いても繋がります**。VS Code の Live Server、
社内サーバー、`index.html` の直接オープン（`file://`）のいずれでも、
同じ PC の `127.0.0.1:8787` を自動で探しにいきます。
`?bridge=` を付けたときだけ、そこだけを見ます。

> https のサイトに置いた場合、Safari は `http://127.0.0.1` への接続を止めます。
> Chrome / Edge / Firefox は繋がります。

---

## 12. コンソールから試す

```js
// 本番と同じ経路で 1 件流し込む
CB.tiktok.handleEvent({ type: 'like',   user: { uniqueId: 'taro' }, count: 100 });
CB.tiktok.handleEvent({ type: 'follow', user: { uniqueId: 'taro' } });
CB.tiktok.handleEvent({ type: 'share',  user: { uniqueId: 'taro' } });
CB.tiktok.handleEvent({ type: 'gift',   user: { uniqueId: 'taro' }, diamondCount: 100 });

CB.engine.spawnEnemy('boss');      // 敵を出す
CB.engine.spawnItem('power');      // アイテムを置く
CB.leaderboard.setSort('kills');   // ランキングの基準を変える
CB.sfx.toggle();                   // 効果音の入 / 切
CB.reset();                        // 全部やり直す
```
