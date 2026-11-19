# 旧 Palladio のプロジェクトファイル（実データ）

## `maghrib-20231106.json`

- 形式: Palladio のプロジェクトファイル（`"version": "1.2.9"`）。利用者が Palladio で作ったもの。
- 中身: マグリブの人物の伝承・師弟の関係（アラビア文字）。
  - `Relations`: 204 行（`No`、`From`、`To`）。`From`/`To` は人名（ラベル）で、旧版はこれでノードを照合する（filter-audit #7）。
  - `Persons`: 219 行（`Id`、`Label`、`Type`［1〜3］、`Year`［ヒジュラ暦の年とみられる］、`地名`、`Coordinate`［`緯度,経度` の 1 列］）。
  - 保存されたビュー: グラフ、地図、表、一覧、フィルタ（主な配置は地図）。
- 用途（Q-03 の決定。設計書 D-28）:
  - 旧 Palladio のプロジェクトの読み込み（FR-IN-11、フェーズ 4）のテスト。
  - 公開サンプル（T1-22。`public/samples/` に Relata の形式で置く）の元データ。
- 利用者の判断により、公開してよい（GitHub Pages で誰でも見られる）。
- 保存の形: 中身は受け取ったファイルと同じ（JSON として等しいことを確かめた）。Prettier の検査を通すため、空白だけを整形してある。

### 公開するときの題名と説明（利用者が確認済み。英語）

T1-22 で公開サンプルにするとき、次の文をそのまま使う（日本語の画面では和訳を添える）。

- **Title**: Scholars and Sufis of the Maghrib in the Fifteenth and Sixteenth Centuries
- **Description**: This dataset records the social network of scholars and Sufis in the Maghrib during the fifteenth and sixteenth centuries. It is derived from _Dawḥat al-nāshir li-maḥāsin man kāna bi-l-Maghrib min mashāyikh al-qarn al-ʿāshir_ by Ibn ʿAskar al-Shafshāwanī (d. 986/1578), and was originally prepared for Palladio to visualize the network on a map.

表記は IJMES 式の転写に合わせた（Maghrib、ʿ と ʾ、長母音の ā ī ū、ḥ など）。
