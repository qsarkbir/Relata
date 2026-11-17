# Palladio フィルタ機能の精査メモ（2026-11-17）

対象ソース（`upstream/` に zip で取得、各リポジトリの master/main）
- palladio（コア）、palladio-app
- palladio-facet-component / graph / map / timeline / timespan / table

方法: コードを読んで確認。アプリは起動しておらず、再現テストはしていない（git・Node.js 未導入）。

## 確度の高いバグ

### 1. グラフ: 集計フィールドを切り替えてもエッジの重みが更新されない
- `palladio-graph-component-master/palladio-graph-view.js:255-263`
- 再計算のきっかけに `'aggregationKey'` を監視しているが、実際の変数名は `aggregateKey`（44行目、template.html:16）。
- 結果: 同じ表の数値フィールド A の合計から B の合計に切り替えても、集計がやり直されない。それ以降に追加・除外される行だけが B で増減するため、A と B が混ざった重みになる。

### 2. facet: 集計方法を変えると絞り込みが黙って外れ、表示だけ残る
- `palladio-facet-filter.js:167-182` → `buildFacetData`（407-455行）
- 集計方法を変更すると、次元を作り直して `data.filters = []` にする。そのため実際の絞り込みは解除されるが、画面上部の「適用中のフィルタ」表示（`setFilter` で登録したもの）は消えない。
- 結果: 絞り込んでいるように見えて、実際は全件が表示される。

### 3. facet: リセット後もフィルタ表示が残る
- `palladio-facet-filter.js:594-601`
- 登録時のキーは `uniqueToggleId + d.key`（元のフィールド名）、削除時のキーは `uniqueToggleId + calculateDomKey(d.key)`（空白・括弧・カンマ等を除去したもの）で、一致しない。
- 結果: フィールド名に空白や記号を含む場合（「Date of birth」など、ごく普通のケース）、リセットしても表示が消えない。

### 4. コア filterService: キューに入ったフィルタの処理が壊れている／例外で恒久停止する
- `palladio-master/src/js/services/filter.js:20-52`
- 34行目の `filter(dimension, dimension.filterQueued).then(...)` は、サービスのメソッドではなく引数の関数（名前が同じで上書きされている）を呼ぶ。戻り値は Promise ではないため TypeError になり、`filterQueued` も消されない。
- `filter(dimension)` の中で例外が起きると `filterRunning = true` のまま戻らず、以後その次元のフィルタはすべてキューに入ったまま実行されない。
- timespan フィルタと app の controllers.js で使われている。

### 5. グラフ: 数値合計で集計していると、絞り込み後に消えるべきエッジが残ることがある
- `palladio-master/src/js/helpers/crossfilter-helpers.js:15-47` と graph-view の 177-204行
- 同じ集計キーを持つ行のうち、加算するのは最初の1行の値、減算するのは最後に除外された1行の値。値が行ごとに違う場合（複数値フィールドの展開など）は差分が残り、`agg > 0` のままエッジが表示される。

## 設計上の問題（バグというより仕様の限界）

### 6. 「ノードのフィルタ」は存在せず、すべて行（＝エッジ）のフィルタ
- crossfilter は行単位で絞り込み、グラフは残った行からノードを作る（d3.graph.js:37-95）。
- 人物の属性で絞ると、その人物が source 側にいる行だけが残り、相手側の属性は見ていない。孤立ノードは表示できない（graph-view.js:219 で `agg > 0` の行だけに限定）。
- 作り直しでは「ノード表」と「エッジ表」を分け、ノードフィルタとエッジフィルタを別々に用意すべき。

### 7. ノードを名前の文字列だけで識別している
- d3.graph.js の `nodes` は名前をキーにした map。jsnx の指標計算も同じ。
- 二部グラフで人名と地名が同じ文字列だと、一つのノードに合流する（例: 人物「Paris」と都市「Paris」）。同名異人も区別できない。k-partite 対応ではノード ID ＋型が必要。

### 8. 有向性を無視している
- 指標は `jsnx.Graph()`（無向）で計算（graph-view.js:125）。描画の source/target の強調は見た目だけ。

### 9. エッジのキーが [source, target] の配列
- crossfilter 内部で文字列に変換されて比較されるため、カンマを含む名前（"Smith, John"）で別のペアが同じキーになり得る（graph-view.js:421）。発生は稀。

### 10. 欠損値の扱い
- facet: 欠損値は `"" + undefined` で文字列 "undefined" という値になる（facet-filter.js:412）。
- timeline: 日付の欠損した行は、範囲を選ぶと何の表示もなく除外される（timeline-filter.js:433-442）。

### 11. 地図からのフィルタはコメントアウトされている
- palladio-map-view.js:631-701。issue #83 で意図的に止めたもの。

## GitHub issue（未解決でフィルタ関連）
- palladio #167 地点と地点の組み合わせで LatLon:Exists が facet で混乱を招く
- palladio #166 facet にリセットと適用中フィルタの表示が必要
- palladio #81 timeline の特定次元でのグルーピング不具合
- palladio #104 データ画面と可視化画面を行き来すると状態が消える
- 解決済みだが関連: #192 facet のボタンが効かないことがある, app #3/#9 facet の集計値が合わない
