# sounds/ — VIDEO BATTLE MODE の音源

ここに音源ファイルを置くと、**その音だけ**が差し替わります。コードは 1 行も
変えません。置いていない音は、ブラウザの Web Audio API でその場で合成します
(だから、このフォルダが空でもゲームの音は鳴ります)。

- 読み込みは起動時に 1 回だけです (最初のクリックのとき)。
- 読めなかったファイル (無い / 壊れている / 形式が違う) は、黙って合成に落ちます。
  音が消えることはありません。
- 操作パネルの `音源:` の行に「ファイル ○ / 合成 ○」と出るので、
  差し替えが効いているかはそこで確かめられます。
- wav / mp3 / ogg など、ブラウザが `decodeAudioData` で読める形式なら何でも
  構いません。ファイル名の拡張子は `.wav` のままにしてください
  (名前は `js/video-config.js` の `audio.sounds[].file` と 1 対 1 です)。

## ファイル名

| ファイル | 鳴るところ | 大きさの目安 |
| --- | --- | --- |
| `hammer-shot.wav` | HAMMER 振りかぶり (低く重い「ドン」) | 中 |
| `hammer-hit.wav` | HAMMER 命中 (「ドゴン」) | 大 |
| `sword-shot.wav` | LONG SWORD の斬り (鋭い「シュッ」) | 中 |
| `sword-hit.wav` | LONG SWORD 命中 | 大 |
| `needle-shot.wav` | INJECTION NEEDLE の刺突 (軽い「チッ」) | 小 |
| `needle-hit.wav` | INJECTION NEEDLE 命中 | 小 |
| `needle-poison.wav` | 毒の付与 | 中 |
| `pistol-shot.wav` | PISTOL 発射 (「パンッ」) | 中 |
| `pistol-hit.wav` | PISTOL 命中 | 大 |
| `shotgun-shot.wav` | SHOTGUN 発射 (強い低音 + 散弾) | 大 |
| `shotgun-hit.wav` | SHOTGUN 命中 (複数ヒット) | 大 |
| `laser-start.wav` | LASER 充填 (「ウィーン」) | 中 |
| `laser-loop.wav` | LASER 照射中 (**繰り返して鳴らします**) | 中 |
| `laser-hit.wav` | LASER の継続ダメージ | 大 |
| `laser-end.wav` | LASER 停止 | 中 |
| `item-pickup.wav` | 武器を拾った | 中 |
| `bounce.wav` | 壁 / 相手に当たって跳ねた | 小 |
| `danger.wav` | HP が危険域に入った | 小 |
| `final-charge.wav` | 「あと一撃」の合図 | 最大 |
| `ko-impact.wav` | 決着の一撃 | 最大 |
| `defeat.wav` | 敗者が消える音 | 最大 |
| `victory.wav` | 勝者の音 (WINNER 表示と同時) | 最大 |

## 作るときの注意

- **`laser-loop.wav` は途切れずに繰り返せる音**にしてください。始まりと終わりの
  音量・音程がそろっていないと、0.5 秒ごとに「プツッ」と鳴ります。
- 音量はここでそろえなくて構いません。武器ごとの相対的な大きさは
  `js/video-config.js` の `audio.categories` (移動 < 取得 = 射出 < 命中 <
  大ダメージ < 最終攻撃) が決めます。ここでは**割れていないこと**だけを見てください。
- モノラルでもステレオでも構いません。

## 使ってよい音源

**商用利用できる音源か、自作 / 生成した音源だけ**を置いてください。
配布元のライセンス表記が必要な場合は、このフォルダに `CREDITS.md` を追加して
そこに書いてください。何も置かなければ、合成音だけで動きます (合成音はこの
リポジトリの中で作っているので、権利の問題はありません)。
