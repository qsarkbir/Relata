# Relata 設計書（開発計画書を兼ねる）

| 項目 | 内容 |
|---|---|
| 文書番号 | RLT-DES |
| 版 | 3.4（2026-11-22） |
| 状態 | 承認済み（内容を変えるときは版を上げ、[進行表](progress.md) の更新履歴に記録する） |
| 関連文書 | [要件定義書](requirements.md)（RLT-REQ）、[進行表](progress.md)（RLT-PRG）、[旧 Palladio フィルタ精査](filter-audit.md)、[共通規約](../CLAUDE.md) |

この文書は「Relata をどう作るか」（第 I 部）と「どう進めるか」（第 II 部）を定める。「何をするか」は要件定義書に書く。要件は `FR-…` / `NFR-…` の ID で参照する。

**実装中に設計を変えるときは、先にこの文書を更新する。**

---

# 第 I 部 設計

## 1. 設計方針

1. **静的サイトとして動かす。** サーバーを持たず、GitHub Pages で配信する（NFR-01）。データはブラウザの外に出さない（NFR-02）。
2. **データモデルを最初に固める。** 旧版の不具合の多くは、「1 行 ＝ 1 エッジ」「ノードを名前で識別」というデータモデルに由来する（§13）。
3. **計算と描画を分ける。** 計算部分（`src/core/`）は DOM や React に依存しない純粋な TypeScript にする。単体テストがしやすく、Web Worker でもそのまま動く。
4. **状態は 1 か所に、表示はそこから導き出す。** 同じ情報を 2 か所で持たない。旧版の「表示と実際の絞り込みのずれ」を構造的に防ぐ。
5. **差分で更新せず、計算し直す。** 想定規模（NFR-03）なら十分速い。速度が足りなければ、正しさを保ったまま結果をキャッシュする。
6. **重い計算は Web Worker で行う。** 画面を止めない（FR-MT-03）。
7. **学習用に、コードに詳しいコメントを付ける。**（§15）

---

## 2. 決定事項

| ID | 決定 | 理由 |
|---|---|---|
| D-01 | ツール名は **Relata** | 利用者の決定 |
| D-02 | UI は React | 資料と型付けの実例が多く、学習に向く |
| D-03 | コメントは日本語、識別子は英語 | 学習のため |
| D-04 | ライセンスは BSD-3-Clause | 原典の Palladio に合わせる |
| D-05 | フェーズの順は「MVP → k-partite・欠損・時間 → 地図・bundling → 拡張」 | データモデルとフィルタを先に固めるため |
| D-06 | 作業場所はメインのマシンの `C:\Users\qsark\Documents\GitHub\2026_relata`。Nextcloud の同期フォルダは使わない | `node_modules` の大量のファイルで同期が詰まるため。共有は GitHub で行う |
| D-07 | 有向エッジの既定の表し方は**矢印** | 利用者の決定。最もなじみがある |
| D-08 | 大きさと太さのスケールの既定は**平方根** | 線形だと最大の値が他を圧倒し、特に bundling の束が不格好に太くなるため（利用者の指摘） |
| D-09 | 西暦以外の暦は**ヒジュラ暦を最優先**し、フェーズ 1 で対応する。和暦は対象外とする | 主な利用者が西アジア史の研究者のため（利用者の指摘） |
| D-10 | アラビア文字（右から左へ書く文字）の表示と、表記の揺れを無視した検索を、フェーズ 1 から必須とする | D-09 と同じ理由 |
| D-11 | リポジトリは `qsarkbir/relata`。**v0.1 の公開まで非公開**にする | 利用者の決定。有料アカウントのため、非公開のままでも GitHub Pages を使える |
| D-12 | GitHub Pages には**フェーズ 0 から配信する**（サイトは誰でも見られる） | 利用者の決定。中身は空のアプリで、データを含まないため |
| D-13 | 統括役と reviewer は **Opus**、実装担当（qa-tester を含む）は **Sonnet**、軽い仕事（検索、一覧づくり、定型の確認など）は **Haiku** で動かす（§16.1） | 利用者の決定。判断と確認に強いモデルを、量の多い実装に速く安いモデルを充てる |
| D-14 | TypeScript は 6.0 系に固定する（`~6.0.3`）。7 系への移行は typescript-eslint が対応してから判断する | 7 系では typescript-eslint が動かず、層の境界の検査（§4.1）ができないため（T0-06 のレビューで判明） |
| D-15 | 多言語対応（FR-UI-01）はライブラリを使わず、`src/i18n/` に型付きの辞書と純粋な翻訳関数を自作する。日本語の辞書を正とし、英語の辞書は同じキーをすべて持つことを型で強制する | 対象は日英の 2 言語で、複数形の規則なども要らない。React に依存しない関数にすれば、`render`（書き出しのラベル）からも使える（§4.1）。キーの打ち間違いと訳し漏れを型検査で防げる |
| D-16 | 画面の言語の既定は日本語（`DEFAULT_LOCALE`）。ただし、ブラウザの言語の一覧が日本語にも英語にも当たらないときは英語（`FALLBACK_LOCALE`）にする | 主な利用者は西アジア史の研究者で、ブラウザの言語がアラビア語、ペルシア語、トルコ語などの人も多い。その人たちには日本語より英語のほうが読める見込みが高い（T0-11 のレビューで指摘） |
| D-17 | Worker の起動は `src/workers/*.client.ts`、版番号と古い結果の破棄は `src/state/`、計算の中止は Worker の terminate で行う。レイアウトの純粋な算法は `src/core/layout/`（graph-algo）に置く。`render` は SVG を文字列で作り、文字の幅の測定は関数で受け取る。時間の再生の時計はアプリに 1 つだけ置き（state は `tick` などの更新の関数だけ、駆動は `src/app/` のフック）、地図は props で受け取る（§4.1、§7.3、§8.1、§8.5、§8.6、§9.2） | T0-13 の試運転で、graph-algo、renderer、map-geo から、設計書の書き方では担当や置き場所が決まらないと指摘されたため |
| D-18 | データモデルの細部（R-01、R-02）: 日付の属性は `{ kind: 'date' }`（`FuzzyDate` に元の暦 `calendar` を持たせる）。ノードとエッジの `geo` と `time` は「項目が無い ＝ 列が無い」「`Missing` ＝ 値が欠けている」と区別する。読み込みの設定は `Dataset` に入れず、プロジェクトファイルの `importSettings` に置く。地図の範囲選択のフィルタ（`geo`）は T3-06 で足す（§5） | 日付を数値に潰すと幅と元の表記が失われる。`undefined` で欠損を表さない規約（CLAUDE.md）と、「列が無い」場合を両立させるため。`Dataset` を読み込みの手段から独立させ、GraphML などから読んでも同じ形にするため |
| D-19 | T1-01 のレビューを受けたデータモデルの補足: `Node`/`Edge` を `GraphNode`/`GraphEdge` に改名する。`attrs` は `getAttr`/`makeAttrs` を通して扱う。ノード ID は型ごとの名前空間に入れ、ID の列から作るものとラベルから作るものを印で区別する。属性の「キーが無い ＝ 当てはまらない」「`Missing` ＝ 欠損」。空の値は `Missing` で表す。`TimeSpan.end` に `Missing`（終わりが分からない）を許す。欠損の記号の対応表は `Dataset` から外す。外から来た値は `parseDataset` で組み立て直す（§5） | DOM の `Node` との取り違えを防ぐため。列名が `constructor` などのとき `attrs[key]` が誤った値を返すため。k-partite の表の ID の衝突を防ぐため。旧版の「黙って除外」（filter-audit #10）を構造的に防ぐため。自動保存から戻れなくなるのを防ぐため |
| D-20 | 照合キー（T1-26、§5.2）: `matchKey(text, options)` を `src/core/text/` に置く。設定は手順ごとの真偽値 `compat`、`arabic`、`diacritics`、`digits`、`caseFold`、`invisibles`、`spaces` で、既定の「ゆるい照合」（`LOOSE_MATCH`）はすべて有効、「厳密な照合」（`STRICT_MATCH`）はすべて無効（NFC 正規化だけ）。手順の順序は「`compat` なら NFKC、でなければ NFC → arabic → diacritics → digits → caseFold → invisibles → spaces」（補助記号の除去を小文字化より先にするのは、İ が NFD で I ＋ U+0307 になるため）。**arabic**: 母音記号（U+064B〜U+065F。ハムザ上下とマッダを含む）、U+0670、コーランの記号（U+06D6〜U+06ED）、タトウィール（U+0640）を除き、أ إ آ ٱ を ا に、ؤ を و に、ئ を ي に、ة・ۀ・ە を ه に、ى・ی を ي に、ک を ك にそろえる。**diacritics**: NFD に分解して**結合用補助記号（U+0300〜U+036F）だけ**を除き、NFC に戻す。単独で書いた補助記号（´ ¨ など。NFKC で「空白＋結合文字」になる）は空白ごと除く。転写の記号 ʿ ʾ ʻ ʼ ʹ ˊ ˋ ′ ‘ ’ ' \` と、言語学式の ʕ ʔ ˁ ˀ を除き、ı を i にする。**invisibles**: ゼロ幅の文字（ZWSP、ZWNJ、ZWJ、WORD JOINER、BOM）、双方向の制御文字（U+061C、U+200E、U+200F、U+202A〜U+202E、U+2066〜U+2069）、ソフトハイフンを除く。**spaces**: 連続する空白を 1 つにして前後を除く。部分一致の判定 `matchIncludes(haystack, needle, options)` も置く。小文字化は `toLowerCase` で、完全な case folding ではない（ß と ss は別） | 濁点（U+3099）などを除くと「が」と「か」が同じになり、日本語の検索が壊れるため、除く範囲を限る。ZWNJ はペルシア語の表記で入ったり入らなかったりし、U+061C はアラビア文字の入力で紛れ込むため。設定を手順ごとに独立させ、何が起きるかを予測しやすくするため。厳密な照合は「見た目が同じなら同じ」（NFC）までにとどめる |
| D-21 | フィルタの細部（T1-03、§6）: (1) テキストのフィルタは `matching: 'loose' \| 'strict'` を持ち、ノードではラベルと文字列の属性値、エッジでは `relation` と文字列の属性値を照合キーで部分一致させる。空の検索語は全件を通す。(2) カテゴリと範囲のフィルタは、その属性のキーを持たない要素（その型に当てはまらない属性）を**そのまま通す**。複数値は、どれか 1 つが条件に合えば通す。カテゴリの値は `String(値)` で比べる。`include` が空なら、その属性を持つ要素をすべて除く（選択が空になったフィルタを消すのは画面の役目）。(3) 範囲は両端を含む。数値でない値は条件に合わないとみなす。(4) 時間のフィルタは `time` の項目が無い要素を通し、`Missing` は `missing` の指定に従う。期間は [始点の earliest, 終点の latest] とし、終わりが分からない期間は終わりを無限とみなす（`within` は通らない）。(5) `edgeRule: 'either-end'` のとき、表示するエッジの両端は、フィルタで除かれたノードでも表示する。(6) ファセットの件数は「同じ対象・同じ属性のカテゴリのフィルタを除いた、その対象のフィルタ」を通った要素（§6.2 の手順 1、2 の段階。エッジの規則と孤立ノードの除去の前）で数え、全体の件数はその属性のキーを持つ要素の数とする。画面では「条件に合う件数」として示し、表示中の件数（FR-FL-09）とは別に出す。範囲（`min > max`）と時間（`from > to`）が逆転したフィルタは何も通さず、`parseFilterState` は失敗にする。存在しない属性・ノード型・値を指すフィルタは `checkFilterState(dataset, state)` が警告として返す（プロジェクトファイルの読み込みと画面で使う。旧版の「一覧に出ているのに効かない」を見えるようにするため）。(7) 欠損で除いた件数は、フィルタごとに対象の全要素で数える。(8) `FilterState` を外から読む `parseFilterState` を `core/filter` に置く（プロジェクトファイルで使う） | 旧版の「k-partite で別の型のノードが巻き添えで消える」問題を避けるため。片端だけ表示されたエッジが宙に浮かないようにするため。ファセットの件数を、エッジの規則や孤立ノードの設定に左右されない、説明しやすい数にするため（旧版の数え方とも近い）。手順 3、4 の後で数えると、自分のフィルタを外したときにエッジの集合が変わり、選んだ値の件数と表示の件数が既定の設定で食い違うため（T1-03 のレビューで判明） |
| D-22 | グラフの構築（T1-04、§7.1）: graphology を使う。`buildGraph(dataset, filterResult, options)` は表示ノード集合と表示エッジ集合からグラフを作り、型は `graphMode` に合わせる（多重エッジなし）。まとめ方は「有向は (始点, 終点) ごと、無向は順序を問わない組ごと」で、混在グラフでは有向と無向を別にまとめる。重みは `weight: 'count'`（件数）、`'weight'`（`GraphEdge.weight` の合計。既定）、`{ attr }`（数値属性の合計）から選ぶ。属性の合計では、欠損と数値でない値を 0 として足さず、その件数をまとめたエッジに持たせる。まとめたエッジのキーは `JSON.stringify` で作り（文字列の単純な連結にしない。filter-audit #9）、元のエッジ ID の一覧を持たせる。自己ループは `selfLoops` で含めるか除く（既定は含める）。Worker に渡す `GraphSnapshot` は `graph.export()` の結果とし、`toSnapshot`、`fromSnapshot`（`Graph.from` で型ごと組み立て直す）を `core/graph` に置く。重みが有限でないか負の値のときも、足さずに欠損の件数に数える。ノード ID が重複していれば先に出たものを採る（重複は `checkDataset` が報告する。フィルタを変えるたびに呼ぶ関数を、読み込めたデータで落とさないため）。`graphology-types` は型だけなので devDependencies に置く | 重みの列を読み込んだ利用者には、その合計が自然なため。キーの連結による衝突を構造的に防ぐため |
| D-23 | 見た目への割り当て（T1-05、§8.2、R-08）: 配色は `src/core/encode/` に置く。カテゴリは Okabe-Ito の 8 色（Okabe & Ito 2008）を順に使い、9 個目以降のカテゴリはまとめて灰色（`#999999`、凡例では「その他」）、欠損は薄い灰色（`#DDDDDD`）にする（色を巡回させない）。連続値は viridis（CC0）の色を補間する。`NodeType.color`、`NodeType.shape` があれば型の色と形に優先して使う。スケールの定義域は [min(0, 最小値), 最大値] とする（0 を基準にし、平方根では最小値 0 のときに面積が値に正確に比例する）。出力は「最小 + t ×（最大 − 最小）」で、平方根と対数では負の値を 0 として扱い、その件数を返す。値が欠損の要素は最小の大きさにし、欠損の印を付ける。割り当ての設定 `EncodingSettings` は JSON にできる値とし、`parseEncodingSettings` と既定値を置く。**補足（T1-05 のレビュー）**: 定義域は線形でも [min(0, 最小値), max(0, 最大値)]（常に 0 を含む）。平方根で面積が値に比例するのは表示の最小が 0 のときだけ。有限でない値（NaN、±∞）は欠損として扱う。凡例には、スケールの代表値（core で計算した値と大きさの組）、欠損の有無、連続値の色の状態（範囲／1 種類／値なし）を持たせる。カテゴリの色は、絞り込み前の全要素の値（`basis`。必須）での件数の多い順（同数は文字列順）に当て、絞り込みで色が入れ替わらないようにする。カテゴリの値は `String(値)` で比べ、照合キーは使わない（D-21 と同じ。ファセットの 1 項目に 1 色）。複数値の要素は最初の値の色で塗り、複数値の印を付ける。欠損は理由を問わず 1 色。型の色と形は型の並び順で当て（色は 9 つ目以降が灰色、形は 4 種を巡回）、色と形の組が他の型と重なる型、利用者の指定色が他の型の色と重なる型を報告する（画面で型の色や形の設定を促す）。連続値の色は最小〜最大に線形に当てる。定数の大きさは範囲の中央。既定はノードの半径 4〜16 px、エッジの太さ 1〜4 px | 色を巡回させると別のカテゴリが同じ色になり、色の意味が崩れるため。0 を基準にしないと、値の差が実際より大きく見えるため |
| D-24 | プロジェクトファイル（T1-08、§11.3、R-02）: 版 1 は `{ app: 'Relata', formatVersion: 1, savedAt, dataset, importSettings, view: { filter } }` とする。`importSettings` は `{ missingTokens: { token, reason }[]; encoding?: string; columnCalendars: { column, calendar }[] }`（利用者の列名をキーにしないため配列で持つ）。見た目、配置、時間の設定は、それぞれのタスク（T1-05、T1-10、T2-05 など）で `view` に**任意の項目として**足す。**`formatVersion` は互換性のない変更のときだけ上げ、任意の項目の追加では上げない**（無い項目は既定値で補う）。`savedAt` は呼ぶ側が渡す（関数を純粋に保つため）。読み込みでは、版の移行 → 各部の parse（`parseDataset`、`parseFilterState`）→ `checkDataset` の順に行い、問題は警告として返す。これより新しい版のファイルは読み込まず、その旨を返す。欠損の記号は、前後の空白と見えない書式文字（ゼロ幅の文字、双方向の制御文字、BOM など。語の中の ZWNJ は残す）を除いて NFC 正規化した後の完全一致で照合する（照合キーは使わない。記号の揺れは利用者が意図したものとみなす）。照合の関数 `matchMissingToken` は、保存の形と同じ `io/project/missing.ts` に置き、読み込み（T1-06）から使う。正規化すると同じになる記号の重複と、空白だけの記号は壊れたファイルとする。`savedAt` は任意の項目（無ければ結果にも持たない。文字列でなければ壊れたファイル）。**列挙や判別共用体に要素を足すとき（暦、フィルタの種類、欠損の理由など）は `formatVersion` を上げる**（古いアプリが「壊れたファイル」ではなく「新しい版のファイル」と伝えられるようにするため）。読み込みで落とした未知の項目は警告で返す | 項目を足すたびに版を上げると移行の関数が増えるため。後から来るタスクが、プロジェクトファイルの形を壊さずに設定を足せるようにするため |
| D-25 | アプリの骨格（T1-16、§10）: ストアは Zustand で、§10 の 4 つに分ける。T1-16 では `uiStore`（言語、進行中の処理の一覧、開いているダイアログ）と `dataStore`（`Dataset \| null`）を作り、`filterStore` と `viewStore` は T1-18、T1-21 などで足す。言語は「利用者が選んだ値（`localStorage`）→ `pickLocale(navigator.languages)`」の順に決め、`<html lang dir>` を合わせる。進行表示（FR-UI-03）は `startTask(label, cancel?)` が ID を返し、`updateTask`、`endTask` で更新する汎用の仕組みにする。「このツールについて」は `<dialog>` で出し、使用ライブラリの一覧は手で保守し、`package.json` の `dependencies` と一致することをテストで確かめる。CSS は素の CSS で、左右は論理プロパティ（`margin-inline-start` など）で書く | 骨格の段階で、まだ型が決まっていないストアを作らないため。アラビア語圏の利用者の画面で左右が崩れないようにするため。ライブラリの一覧の書き漏れを防ぐため |
| D-26 | 画面の部品の置き場所と state の依存（T1-16 のレビュー）: React の部品（ダイアログ、進行表示など）と、ストアを読む React のフック（`useUi`、`useData`、`useT` など）は `src/views/` に置く。`src/app/` は起動処理（`main.tsx`）、画面の配置（`App.tsx`）、ブラウザとの橋渡し（`localStorage`、`<html lang dir>`）だけにする。`state` は `i18n` の型と定数（`Locale` など）に依存してよい。`state` の層の境界は ESLint で検査する（React、`zustand` の React 用の入口、views、app、render、map、io、`*.worker.ts`、DOM のグローバルを禁止。`zustand/vanilla` は許す） | views から app を import する逆向きの依存を作らないため。言語は state が持つ値なので、その型が要るため。§4.1 の規則を機械で守るため |
| D-27 | 文字コード（R-06）: フェーズ 1 で読み込めるのは、要件 FR-IN-01 のとおり UTF-8 と Shift_JIS だけとし、今は広げない。後から UTF-16 やアラビア語・トルコ語の 1 バイトの文字コード（Windows-1256、1254）を足せるよう、T1-06 は次を守る: (1) 文字コードは WHATWG のラベルの文字列で扱い、プロジェクトファイルにもその文字列で保存する（`importSettings.encoding?: string`。版を上げずに足せる）。(2) 自動判定の候補と、手動で選べる文字コードを、それぞれ 1 つの一覧（定数）にし、判定や画面の処理に文字コード名を直接書かない。(3) 変換は標準の `TextDecoder` だけで行う。(4) 対応しない文字コードの BOM（UTF-16 など）で始まるファイルは、黙って読まず、対応していない旨を伝える | 利用者の判断（後で広げられるなら今は広げない）。上の (1)〜(3) を守れば、追加は一覧への登録と表示名とテストだけで済み、大きな手直しは要らない |
| D-28 | サンプルデータ（Q-03）: 利用者が Palladio で作ったマグリブの人物の関係のプロジェクトファイル（`tests/fixtures/io/palladio/maghrib-20231106.json`。人物 219、関係 204、アラビア文字、ヒジュラ暦の年、座標）を、公開サンプル（T1-22）の元データと、旧 Palladio のプロジェクトの読み込み（FR-IN-11）のテストに使う。サンプルは Relata の形式に直して `public/samples/` に置き、題名と出典の説明を付ける | 利用者の判断（公開してよい）。主な利用者に合う西アジア史の例で、アラビア文字、ヒジュラ暦、地図、有向の関係を一度に試せるため |
| D-29 | 日付の解析と暦（T1-02、§5.1、要件 §6.4）: `src/core/time/calendars/` に `gregorian.ts`、`hijri.ts` を置き、それぞれ「暦の日付 → JDN」「JDN → 暦の日付」を持つ（Reingold & Dershowitz の算法。ヒジュラ暦は 30 年周期で、閏年は (14 + 11y) mod 30 < 11、紀元はユリウス暦 622 年 7 月 16 日 ＝ JDN 1948440。convertdate と同じ）。年は天文学的な数え方（紀元前 1 年 ＝ 0 年）。`parseDate(text, options)` は `FuzzyDate` と警告を返し、例外を投げない。選択肢は列の暦（`calendar`）、「頃」の幅（`circaYears`、既定 5）、ヒジュラ暦の日付の幅（`hijriDayMargin`、既定 2）。区切りの規則: `YYYY-MM`（右が 2 桁で 1〜12）は年月、`YYYY-MM-DD` は年月日、範囲は `/`、`〜`、`～`、または右が 3 桁以上の `-`。「頃」は幅を広げて確からしさを `probable`、`?` は `possible`。併記（`1050 AH / 1640 CE`）はヒジュラ暦の値を採り、西暦と重ならなければ警告する。ヒジュラ暦の月名はアラビア文字と転写（IJMES 式、補助記号の有無）を `matchKey`（D-20）で照合する。西暦の月名は今は受け付けない。正解値は convertdate で作り、生成の Python と結果の JSON は `src/core/time/fixtures/` に置く（core-model の範囲で完結させる）。**補足（T1-02 のレビュー）**: (1) 併記: 括弧の形（`1050 AH (1640)`）は常に併記。`/` や `-` で片側だけに暦の印があるときは、印の無い側を相手と違う暦として読んで相手と重なれば（前後 1 年まで）併記とみなして警告（`parallel-inferred`）を付け、重ならなければ同じ暦の範囲とする（`1050 AH / 1640` は併記、`1050/1060 AH` は範囲）。併記の確からしさは両側の弱い方。(2) 年月・年月日と読むのは、左の年が 3 桁以上のときだけ（`8-10 AH` は 8〜10 年の範囲）。(3) `/` の片側が 1〜2 桁でもう片側が 3 桁以上なら曖昧として失敗（`10/1050` は月/年か範囲か決められない）。(4) en ダッシュ（–）、em ダッシュ（—）、`〜`、`～` は常に範囲の記号。en ダッシュの右が 1〜2 桁なら上位の桁を補う略記（`1640–41` ＝ 1640〜1641）。ハイフン（-）の `1611-12` は年月のまま。(5) 先頭の `〜` と `～` は開いた範囲（「〜まで」）なので、今は未対応として失敗。「頃」の印は c.、ca.、頃、ASCII の `~`。(6) 「頃」の幅は、ずらした年で年・月の範囲を作り直す（閏年で末日が欠けないように）。紀元前やヒジュラ暦の紀元より前に及んでもよい（表示側で扱う）。(7) 年 0 は拒否、年は 6 桁まで。範囲の片側の印（AH、BC）はもう片側にも及ぶ。(8) 選択肢の上限: 頃は 1000 年、ヒジュラ暦の日の幅は 366 日まで（超えれば既定値）。負の値や整数でない値（2.5 など）も既定値に戻す（切り捨てない）。(9) ヒジュラ暦の月名にオスマン語の綴り（Muharrem、Safer、Rebiülevvel、Cemaziyelevvel、Zilkade、Zilhicce など）を含め、年の前の `سنة` を読み飛ばす。日本語の `1650年3月15日` を受け付ける。`17th century`、`1650s`、`1650年代` は今は失敗。(11) 月が 00 や 13 以上、日がその月の日数を超える値（`1640-13`、`1640-00`、`1640-02-30`）は、範囲などに読み替えず失敗（`invalid-month`、`invalid-day`）。(12) 年月の区切りのハイフンは、ASCII のハイフンマイナス（-）、全角のハイフンマイナス（－。NFKC で -）、ハイフン（‐ U+2010）、改行しないハイフン（‑ U+2011）、数字用のダッシュ（‒ U+2012）、マイナス（− U+2212）、小さいハイフンマイナス（﹣ U+FE63）を同じに扱う（表計算ソフトやワープロが自動で置き換えるため）。en ダッシュ（–）と em ダッシュ（—）は区切りではなく範囲の記号（補足 (4)）。(13) 年-月-日 の直後にさらに `-` と 1〜2 桁の数字が続く入力（`1640-12-3-5`）は、範囲と読まず、読めない書式（`unrecognized`）として失敗。括弧の併記は末尾の括弧 1 組だけを読み、入れ子の括弧（`1050 AH (1640 (CE))`）、併記の後ろの補足の括弧（`1050 AH (1640) (uncertain)`）、先頭の括弧（`(1640) 1050 AH`）は読めない書式として失敗（誤読より失敗を選ぶ）。(14) 末尾の `?` と `頃` の繰り返し（`1650??`、`1650頃頃`）は 1 つと同じに読む（史料の目録で疑いの強さを `??` と書く習慣があるが、確からしさは `possible` より細かく分けない）。先頭の「頃」の印の繰り返し（`c. c. 1650`、`~~1650`）は失敗。(15) 末尾の暦・紀元の印（AH、A.H.、H、ه、ه.ق、BC、B.C.、BCE、CE、C.E.、AD、A.D.）の後ろの終止符は 0 個か 1 個（`a.h` も `A.H.` も `CE.` も同じ）。2 個以上は失敗。アラビア語の `هجري`、`هجرية`、`للهجرة`、`ق` だけの印は今は未対応で失敗（`هـ` と `ه.ق` は読む）。(10) `parseTimeSpan` は、終点の列が無ければ `end` を持たず、列はあるが空なら `end` を `Missing`（unrecorded）にする | 要件 §6.4 の書式を、曖昧さなく機械で読めるようにするため。`1640-12` を範囲と年月のどちらと読むかを決めておくため。正解値を他の担当の場所に置くと、並行作業で書き込み先がぶつかるため |
| D-30 | 指標（T1-09、§7.3、R-07、R-13）: 媒介中心性と近接中心性は重みなし（ホップ数）で計算し、graphology-metrics には重みを使わない指定を明示して渡す。自己ループの次数は networkx に合わせる（無向の自己ループは 2）。平均次数は有向なら E/V、無向なら 2E/V。混在グラフは、無向エッジを両向きの 2 本の有向エッジとみなして計算し（相互性には数えない）、注意を返す。有向グラフの固有ベクトル中心性は HITS（ハブと権威）で代える。k-core とクラスタ係数は、有向でも無向として計算して注意を返す。計算できなかった指標は、その指標だけ理由つきの失敗として返す（§12）。Worker の型検査は `tsconfig.worker.json` が `*.worker.ts` と、そこから使う core と render/bundling だけを含め、`*.client.ts` は app の設定で検査する（`tsconfig.app.json` は worker を除き、`composite` ではなく `incremental` にする。client が `import type` で worker の型を読むため。Vite の Worker の出力は `format: 'es'`）。正解値は networkx で作り `tests/golden/`（graph-algo）に置く。T1-09 は `core/metrics`、`workers/metrics.worker.ts`、`metrics.client.ts` までとし、state での版番号と 200 ミリ秒の待ちは画面のタスク（T1-20）で作る。**補足（T1-09 のレビュー）**: グラフの種類は snapshot の `options.type` で決める（`mixed` は、表示中に有向エッジが無くても混在として扱い、フィルタの操作で表の形が変わらないようにする）。混在グラフでは、同じ 2 点間の無向と有向は 1 本の弧にまとめる（networkx の DiGraph と同じ意味。重みを使わない指標では有向エッジの有無が効かない）。重みを使う指標（PageRank、固有ベクトル、HITS）では重み 0 の弧を除いて計算する（0 除算で反復が壊れるのを防ぐ。数学的に同じ結果）。重みの合計が 0 なら HITS は `notDefined`。近接中心性は、非連結のグラフでも定義できるよう Wasserman と Faust（1994）の補正を使う（networkx の既定 `wf_improved=True` と同じ）。ノード u に届く（有向では u へ届く）ノードの数を自分を含めて r、全ノード数を N、u までの距離の合計を Σd として、C(u) = ((r − 1)/(N − 1)) × ((r − 1)/Σd)。どこからも届かないノード（孤立ノードなど）は 0。有向グラフでは「他のノードから u へ」の距離による値を `value`、「u から他のノードへ」の距離による値を `outgoing` として両方を出す。小さな成分の中だけで値が大きくならないよう、届く割合 (r − 1)/(N − 1) を掛ける。ノード型が 2 種類以上のときの注意（FR-MT-05）には、中心性に加えてクラスタ係数、密度、推移性を含める。snapshot の無向の判定（`undirected: true` は mixed のときだけ付く）は、後で `core/graph` に共有の関数として置く | 進行表の R-07、R-13 の推奨どおり。重みを距離とみなすか強さとみなすかで結果が逆になるため、まず意味のはっきりしたホップ数にする |
| D-31 | シーンと SVG（T1-11、§8.1、R-10）: `buildScene(graph, positions, encoded, options)` は、ノードの位置（レイアウトの結果。今は引数で受け取る）と割り当ての結果（D-23）から `Scene` を作る。書き出す図は、画面の拡大に関係なくグラフ全体を収める。選択の強調は、既定では書き出しに含めず、選べるようにする。`renderSvg(scene)` はノード、エッジ、ラベル、凡例をそれぞれ `<g>` にまとめた SVG の文字列を返す（FR-OUT-01。T1-14 の書き出しでそのまま使う）。文字列と属性値はすべてエスケープし、色は `#rrggbb` を検証する。ラベルの向きは、最初の強い向きの文字（Unicode の Bidi_Class）で判定し、右から左のラベルには `direction="rtl"` を付ける。文字の幅の測定は関数で受け取る（D-17）。T1-11 ではエッジは直線だけを描き、矢印と曲線は T1-12、ラベルの重なりの解消は T1-13 で足す。**補足（T1-11 のレビュー）**: §8.1 の型に、`SceneEdge` の `source`/`target`/`directed`、`SceneNode` の `strokeWidth`/`selected`、`Scene` の `fontFamily`（測定と描画で同じものを使う）と `omitted`（位置の無いノード、端点の無いエッジ、自己ループ、太さの対応が 1 件も無いこと）を足す。ラベルの `anchor` は物理的な意味（x が文字列の左端か右端か）とし、SVG では `direction` と組み合わせて `text-anchor` を決める（`direction="rtl"` のとき `end` は左端になるため）。位置の無いノードとそのエッジはシーンに入れない。画面に埋め込むときの id の衝突を避けるため `idPrefix` を持つ（英数字、`_`、`-` 以外は `_` に替え、先頭が英字か `_` でなければ `_` を付ける。XML の id と CSS のセレクタの両方で使えるようにするため） | 進行表の R-10 の推奨どおり。論文の図に使うので、画面の状態に左右されない全体の図が既定であるべきため |
| D-32 | フィルタパネルと保存の画面（T1-18、T1-21、§10）: `filterStore` は `FilterHistory`（D-21 の履歴）だけを持ち、現在の `FilterState` は履歴の現在の値とする（別に持たない）。絞り込みの結果（`FilterResult`）とファセットの件数は、ストアに入れず、`Dataset` と `FilterState` から計算して覚えておく（同じ入力なら計算し直さない）。属性の型ごとの部品: `category`、`string`、`boolean` はファセット、`number` は範囲、`date` は時間（フェーズ 2）。`checkFilterState` の問題は、該当するフィルタの横に示す。`views` と `app` は `io` を呼んでよい（ファイルの読み書きの画面のため）。`state` は `io` を呼ばない。自動保存は IndexedDB に、データ・フィルタ・設定が変わってから 1 秒後に保存する（§10）。プロジェクトの保存は JSON のファイルとして書き出し、読み込みはファイルの選択で行う | 状態を 1 か所に保つ原則（§1 の 4）をストアでも守るため。旧版の「表示と実際の絞り込みのずれ」（filter-audit #2、#3）を構造的に防ぐため |
| D-33 | 保存・読み込みの画面の細部（T1-21 のレビュー）: (1) データがあるときに別のプロジェクトを開くと、置き換える前に確認する（ファイルに保存していない作業は戻らないため）。(2) 起動時の自動保存の復元は、利用者が先にファイルを開いていれば適用しない。復元でも進行表示を出す。ファイルを開く処理は、解析の前までは取り消せる（解析は同期なので、その間は取り消せない）。(3) 読み込みの警告はデータと組にして持ち、一時的な知らせ（保存の失敗、消したことなど）で上書きされないようにする。(4) 自動保存の失敗は種類ごとに知らせる（容量の不足は「ファイルに保存してください」と促す）。消す操作の失敗は毎回知らせる。消した後も作業を続ければまた保存されることを文言で伝え、進行中の保存の完了を待ってから消す。(5) 同じアプリを別のタブでも開いていることを `BroadcastChannel` で検出し、「自動保存は最後に変更したタブのものだけが残る」と知らせる。(6) 復元しようとした自動保存がこのアプリより新しい版なら、自動保存を止めて上書きしない。(7) 知らせの中の利用者の値（題名、ID、path）は `<bdi>` で隔離する。(8) 読み込みの設定とプロジェクトの部品の型（`ImportSettings`、`ProjectParts`、`ProjectView`、`ProjectWarning`）は、state が io を import できないため、後のタスクで `src/core/project/` に移し、io はそれを再 export する。それまでは state 側の写しと io の型の一致をテストで確かめる。(9) 自動保存は、データが無い（`dataset` が null）ときは何も書かない（起動直後に前回の保存を空で上書きしないため）。将来「プロジェクトを閉じる」「新規作成」を足すときは、その操作で自動保存も消す（`clear`）。消さないと、閉じたはずのプロジェクトが次に開いたときに復元される。(10) 置き換えの確認のダイアログは、親が閉じた（「開く」を選んだ）ときに、`close` イベントから「やめる」の処理を呼ばない | 利用者の作業を黙って失わないため。共用の端末で「消した」と誤解させないため（NFR-02）。アラビア文字の題名の前後の記号の並びが崩れないようにするため（NFR-09） |

---

決定事項 **D-34**（2026-11-20）: T1-06 の警告、同名ノード、Excel ライブラリとエラー時のデータ保持は §11.1 に記録（R-03〜05）。

## 3. 技術スタック

| 領域 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript **6.0 系**（`~6.0.3`。`strict`、`noUncheckedIndexedAccess`） | 型で不具合を早く見つける。7 系（ネイティブ版）は JS から呼べるコンパイラ API がなく、typescript-eslint が対応していない（2026-11 時点で `<6.1.0`）ため、対応するまで 6.0 に留める（D-14） |
| ビルド | Vite | 静的ファイルを出力し、TypeScript を標準で扱え、速い |
| UI | React | D-02 |
| 状態管理 | Zustand | 小さく、型付けが簡単 |
| グラフの構造と算法 | graphology（＋ graphology-metrics、-communities-louvain、-layout-forceatlas2） | 有向・無向・混在と属性を扱え、型付きで、Worker でも動く |
| グラフ描画 | 自作のシーン層 ＋ SVG（必要なら Canvas を追加） | 矢印、bundling、SVG 出力を自由に制御するため（§8.1） |
| 地図 | MapLibre GL JS ＋ deck.gl | オープンソースで、時間アニメーション（TripsLayer）が得意 |
| 地図の SVG 出力 | d3-geo | WebGL の画面はそのまま SVG にできないため |
| Worker との通信 | Comlink | Worker の関数を普通の非同期関数として呼べる |
| 表データの読み込み | CSV/TSV は `src/io/table/text.ts` の引用規則の解析。Excel は SheetJS CE 0.20.3（Apache-2.0、公式 tgz）。文字コードは標準の `TextDecoder` | CSV/TSV はレコードを保持して警告を出す。Excel はシリアル日付と起点を取得できる公開 API が必要（D-34） |
| PDF | jsPDF ＋ svg2pdf.js、Noto Sans JP と Noto Naskh Arabic（サブセット） | SVG からベクター PDF を作る。日本語とアラビア文字のフォントを埋め込む |
| 文字の整形 | harfbuzzjs | PDF に書き出すとき、アラビア文字の連結形を正しく作るため（§11.2） |
| テスト | Vitest（単体）、Playwright（E2E） | Vite と相性がよい |
| 指標と暦の検証 | Python ＋ networkx、convertdate（正解値の生成のみ） | 計算ミスを防ぐ |
| 品質 | ESLint（typescript-eslint）、Prettier | — |
| パッケージ管理 | npm | Node.js に付属し、追加の導入が不要 |
| 配信 | GitHub Actions → GitHub Pages | NFR-01 |

ライブラリを追加するときは、ライセンスが BSD-3-Clause と両立することを確かめる（NFR-12）。

---

## 4. アーキテクチャ

### 4.1 層と依存の向き

```
  app ──→ views（React の画面）──→ state（Zustand）──→ core（純粋な TS）
            │                       │
            │                       └──→ workers/*.client.ts（Worker の起動）
            ├──→ render（シーン → SVG 文字列）──→ core、i18n
            └──→ map（MapLibre + deck.gl）──→ render、core
  workers（指標・レイアウト・bundling）──→ render/bundling、core
  io（読み込み・書き出し）──→ core（図の書き出しは render）。views と app から使う（D-32）
  i18n（表示文字列）──→ core。render、views、app、state から使う
```

- **`src/core/` は何にも依存しない。** DOM、React、ブラウザ API、`Date` を使わない。JSX も書かない（`.tsx` を置かない）。
- **`src/render/` は React に依存しない。** 画面からも書き出し処理からも呼べるようにする。JSX も書かない。`core` と `i18n`（書き出しのラベル用）だけに依存し、`state`、`views`、`app`、`map`、`io`、`workers` を import しない。
- **`src/state/` は画面に依存しない純粋なストア。** `core`、`workers/*.client.ts`、`i18n` の型と定数に依存してよい（D-26）。`*.worker.ts` を直接 import しない。DOM や `requestAnimationFrame` を使う処理（時間の再生の駆動など）は `app` か `views` に置き、state には更新の関数（`tick(dt)` など）だけを置く（§9.2）。views は Worker の client を直接呼ばず、state を通す。
- **`src/map/` は `core` と `render`（`arrows/`、`bundling/` の型）に依存してよい。** `state`、`io`、`workers` は import しない。ストアの値と更新の関数は views から props で受け取る（§9.2）。この規則の ESLint での検査は、地図の作業を始める前に足す（進行表の R-11）。
- **`src/io/` と `src/workers/` は画面に依存しない。** React、Zustand、`state`、`views`、`app` を import しない。`io/export` の図の部分は `render` を使う。`workers/bundling.worker.ts` は `render/bundling/` の算法を使う（§16.1 の分担による例外ではなく、上の図の「下向き」の依存として許す）。
- **`src/i18n/` は React と画面とブラウザに依存しない。** `render` から使われるため（D-15）。React、Zustand、地図のライブラリ、`state`、`views`、`app`、`render`、`map`、`io`、`workers` を import せず、`navigator` などのブラウザのグローバルと `Date` を使わず、JSX を書かない。`core` には依存してよい。言語の判定に要る値（`navigator.languages` など）は呼ぶ側が渡す。
- これらの規則は ESLint で機械的に検査する（パスを解決して判定する `import-x/no-restricted-paths`、パッケージ名の `no-restricted-imports`、ブラウザのグローバルの `no-restricted-globals`、JSX と動的 import の `no-restricted-syntax`）。検査が効いていることは `tests/lint/check-boundaries.mjs` で確かめる。
- さらに `core` は、DOM の型を持たない `tsconfig.core.json`（`lib: ["ES2022"]`）でも型検査する。ESLint の名前の一覧では漏れる DOM の型やグローバルを、型検査で止めるため。

### 4.2 ディレクトリ構成

```
src/
  core/                  純粋な TypeScript。単体テストの主対象
    model/               データ型（Dataset, GraphNode, GraphEdge, AttrValue, TimeSpan …）
    filter/              フィルタの定義と適用
    time/                日付の解析、暦の換算（西暦・ヒジュラ暦…）、幅のある年代の計算
    text/                検索と照合のための文字の正規化（アラビア文字、転写の補助記号）
    graph/               graphology グラフの構築、重みの集約、射影。Worker に渡す GraphSnapshot の作成（§7.3）
    metrics/             指標の要求・結果の型と、Worker の中でも呼べる純粋な計算関数（graph-algo の担当）
    layout/              レイアウトの純粋な算法（円形、層状、地理座標、初期配置。graph-algo の担当）
    encode/              見た目への割り当て（指標→大きさ、属性→色、スケール）
    util/                assertNever など共通の小道具
  io/
    import/              CSV、Excel、JSON（将来: GEXF、GraphML、旧 Palladio）
    export/              CSV、GraphML、GEXF、プロジェクト JSON、図（SVG/PDF/PNG）
    project/             プロジェクトファイルの型と版の移行
  workers/               metrics.worker.ts、layout.worker.ts、bundling.worker.ts と、それぞれを起動する *.client.ts（§7.3）
  render/
    scene/               描画方式に依存しない「シーン」の型と生成
    svg/                 SVG 描画（画面表示と書き出しの両方）
    arrows/              矢印・先細りエッジ・往復エッジの幾何計算
    bundling/            edge bundling の算法
  map/                   地図ビュー
  state/                 Zustand ストア
  views/                 React コンポーネントと、ストアを読むフック（D-26）
  app/                   起動処理、画面の配置、ブラウザとの橋渡し（D-26）
  i18n/                  日本語・英語の表示文字列と翻訳関数（React に依存しない。D-15）
tests/
  golden/                networkx で作った指標の正解値と、その生成スクリプト
  e2e/                   Playwright（ユースケースごと）
  fixtures/              テスト用の小さなデータ
public/samples/          サンプルデータ
```

### 4.3 データの流れ

画面に表示されるまでの処理を、次の関数の連鎖として組む。各段の結果をキャッシュし、変更があった段から先だけを計算し直す。

```
Dataset（原データ）
  → applyFilters(dataset, filterState)   … 通過したノード ID とエッジ ID の集合
  → buildGraph(filtered, graphOptions)   … graphology グラフ（向き、重みの集約、射影）
  → computeMetrics(graph)                … Worker で実行
  → encode(graph, metrics, encoding)     … 大きさ・色・太さ
  → layout(graph, layoutOptions, pins)   … Worker で実行
  → bundle(scene, bundlingOptions)       … Worker で実行（有効なときだけ）
  → buildScene(...)                      … 描画方式に依存しない図形のリスト
  → renderSvg(scene)
```

どの段で何が変わったら、どこから計算し直すか:

| 変わったもの | 計算し直す段 |
|---|---|
| フィルタ | applyFilters 以降すべて |
| 重みの集約方法、射影の設定 | buildGraph 以降 |
| 見た目の設定（色、スケール） | encode 以降（レイアウトはやり直さない） |
| ノードの固定位置 | layout 以降 |
| 有向エッジの表し方 | buildScene 以降 |

---

## 5. データモデル

要件 FR-DM-01〜08 を満たす型。実装時に `src/core/model/` で確定する。

```ts
/** 識別子。【TS】「ブランド型」にして、NodeId と EdgeId の取り違えをコンパイル時に防ぐ */
export type NodeId = string & { readonly __brand: 'NodeId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };
export type NodeTypeId = string & { readonly __brand: 'NodeTypeId' };

/** ユリウス通日（JDN）の整数。暦に依存しない日の通し番号（§5.1） */
export type DayNumber = number;

/** 暦。フェーズ 4 で 'julian' | 'solar-hijri' | 'rumi' を足す */
export type CalendarId = 'gregorian' | 'hijri';

/** ノード型（k-partite の「部」） */
export interface NodeType {
  id: NodeTypeId;
  label: string;
  color?: string;
  shape?: 'circle' | 'square' | 'triangle' | 'diamond';
}

export type Scalar = string | number | boolean;
export type MissingReason = 'unrecorded' | 'lost' | 'illegible' | 'not-applicable';
export type Certainty = 'certain' | 'probable' | 'possible';

/** 欠損。理由を必ず持つ（FR-DM-04） */
export interface Missing { kind: 'missing'; reason: MissingReason }

/** 幅のある日付。最も早い日と最も遅い日で表す（FR-DM-05） */
export interface FuzzyDate {
  readonly earliest: DayNumber;   // 安全な整数（Number.isSafeInteger）
  readonly latest: DayNumber;     // earliest <= latest
  readonly certainty: Certainty;
  readonly calendar: CalendarId;  // 元の暦（表示や書き出しで元の表記に戻すため）
  readonly label: string;         // 元の表記（例: "c.1650"、"15 Ramaḍān 1050"）
}

/** 属性の値。判別共用体にする（FR-DM-04、05、07） */
export type AttrValue =
  | { kind: 'value'; value: Scalar | readonly Scalar[]; certainty?: Certainty }  // 配列は複数値（FR-DM-07）
  | { kind: 'date'; value: FuzzyDate | readonly FuzzyDate[] }                   // 日付の属性（valueType: 'date'）
  | Missing;

/** 期間。始点と終点がそれぞれ幅を持てる。1 点の日付なら end を持たない。
 *  終わりが分からない期間（「1650 年から」）は end に Missing を入れる */
export interface TimeSpan { readonly kind: 'span'; readonly start: FuzzyDate; readonly end?: FuzzyDate | Missing }

/** 地点（十進数の度。緯度 -90〜90、経度 -180〜180） */
export interface GeoPoint { readonly kind: 'point'; readonly lat: number; readonly lon: number }

/** 属性の表。キーは利用者の列名。`attrs[key]` で直接引かず、getAttr / makeAttrs を使う（D-19） */
export type Attrs = Readonly<Record<string, AttrValue>>;

/** ノード。DOM の `Node` と名前がぶつからないよう GraphNode とする（D-19） */
export interface GraphNode {
  readonly id: NodeId;
  readonly type: NodeTypeId;
  readonly label: string;
  readonly attrs: Attrs;
  readonly geo?: GeoPoint | Missing;
  readonly time?: TimeSpan | Missing;
}

export interface GraphEdge {
  readonly id: EdgeId;    // 多重エッジを区別するため、エッジにも ID を持たせる（FR-DM-08）
  readonly source: NodeId;
  readonly target: NodeId;
  readonly directed: boolean;
  readonly relation?: string;
  readonly weight: number;  // 既定 1。有限で 0 以上
  readonly time?: TimeSpan | Missing;
  readonly attrs: Attrs;
}

export interface AttributeDef {
  key: string;
  label: string;
  appliesTo: 'node' | 'edge';
  nodeType?: NodeTypeId;  // 特定のノード型だけが持つ属性
  valueType: 'string' | 'number' | 'date' | 'boolean' | 'category';
  multi?: { separator: string };
}

export interface Dataset {
  readonly graphMode: 'directed' | 'undirected' | 'mixed';    // FR-DM-03
  readonly nodeTypes: readonly NodeType[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly schema: readonly AttributeDef[];
  readonly meta: { readonly title: string; readonly source?: string };
}
// 欠損の記号の対応表（FR-IN-07）は読み込みの設定なので、Dataset ではなく
// プロジェクトファイルの importSettings に置く（D-18、T1-08）。
```

- `graphMode` が `directed` なら全エッジの `directed` は true、`undirected` なら false。`mixed` のときだけエッジごとに異なる。
- 読み込み処理（`src/io/import/`）は、必ずこの `Dataset` を出力する。
- **`geo` と `time` の「無い」と「欠損」を区別する**（D-18）。項目そのものが無い（`undefined`）のは「このデータには地点や時期の列が無い」ことを表す。列はあるが値が空なら `Missing`（理由つき）を入れる。CLAUDE.md の「欠損を `undefined` で表さない」を守るため。
- **日付の属性**（`valueType: 'date'`）の値は `{ kind: 'date' }` で持つ。数値（JDN）に潰さないのは、幅、確からしさ、元の暦と表記を保つため（D-18）。
- **属性の「キーが無い」と「欠損」の区別**（D-19）: その属性がノードの型に当てはまらない（`AttributeDef.nodeType` が別の型）なら、キーを持たない（集計で数えない）。当てはまるのに値が無いなら `Missing` を入れる。当てはまる属性のキーが無いのは不変条件の違反（`checkDataset` が報告する）。
- **空の値は `Missing` で表す**: 空文字、空の配列、文字列の `"undefined"` や `"null"` を値として持たない（filter-audit #10）。空文字と空の配列は `checkDataset` が報告する。
- **`attrs` の引き方**（D-19）: キーは利用者の列名なので、`constructor` や `__proto__` もありうる。`attrs[key]` で直接引くと `Object.prototype` の項目が返るため、必ず `getAttr(attrs, key)`（`Object.hasOwn` で調べる）と `makeAttrs(entries)`（`Object.fromEntries` で作る）を使う。
- **ノード ID の作り方**（D-19）: 表に ID の列があっても、ID は型ごとの名前空間に入れる（k-partite の表では、人物と地名がそれぞれ 1, 2, 3… を使うことが多いため）。ID の列から作る ID と、型＋ラベルから作る ID は、先頭の印で区別する（`makeNodeIdFromTypeAndKey` と `makeNodeIdFromTypeAndLabel`）。元の ID とラベルは、ID から読み戻せる（書き出しで使う）。前後の空白の除去は読み込み（io）の担当。
- `Dataset` とその中身は不変（`readonly`）として扱う。変えるときは新しいオブジェクトを作る（§1 の 5、差分で更新しない）。
- `src/core/model/` には、型のほかに次を置く。
  - ID の作成関数（`toNodeId` など。ブランド型への変換をここだけで行う）
  - 型ガード（`isMissing` など）と、外から来た値（`unknown`）を検査して組み立て直す `parseDataset(x): { ok: true; value: Dataset } | { ok: false; path: string; reason: string }`（プロジェクトファイルの読み込みで使う。余分な項目と `__proto__` を落とし、壊れている箇所を返す）
  - 不変条件の検査 `checkDataset(ds)`: ID の重複（ノード、エッジ、ノード型、schema のキー）、存在しないノードを指すエッジ、`graphMode` とエッジの `directed` の食い違い、存在しない型、`earliest > latest`、期間の逆転、整数でない日、範囲外の座標、重みの不正、有限でない数値、空の値、schema にない属性、schema の型と合わない値、当てはまる属性のキーが無いこと。問題の一覧を返し、例外は投げない（§12）。**`checkDataset` が問題を返さない Dataset は、JSON に書き出して読み直しても `parseDataset` を通る**（自動保存から必ず戻れるようにするため）。
- **読み込みの設定**（列ごとの暦、文字コード、列名の対応、欠損の記号）は `Dataset` に入れず、プロジェクトファイルの `importSettings` に置く（T1-08、D-18）。`Dataset` は「何が読み込まれたか」だけを表す。

### 5.1 暦と日付（FR-DM-05、FR-TM-06〜09）

- **内部の表現**: 日付はすべて**ユリウス通日（JDN）**の整数で持つ。JDN はどの暦にも依存しない日の通し番号で、暦の換算の標準的な基準になっている。比較や範囲の計算は JDN どうしで行う。
- **換算**: 各暦について「暦の日付 → JDN」と「JDN → 暦の日付」の 2 つの関数を、`src/core/time/calendars/` に暦ごとに置く。算法は Reingold & Dershowitz, *Calendrical Calculations* に従う。
  - **グレゴリオ暦**: 1582 年より前にもさかのぼって適用する。
  - **ヒジュラ暦（太陰暦）**: 30 年周期の計算上の暦（紀元 ＝ ユリウス暦 622 年 7 月 16 日）。
    - 年や月だけの値は、その年・月の初日から末日までの幅にする。
    - 日付まで指定された値は、観測による差を見込んで、既定で前後 2 日の幅にする。
  - **フェーズ 4**: ユリウス暦、太陽ヒジュラ暦、ルーミー暦を同じ形で追加する。
- **【なぜ】JavaScript の `Date` を使わない理由**:
  - 時刻とタイムゾーンを含み、日単位の計算で 1 日ずれる原因になる。
  - 紀元前の扱いが分かりにくい。
  - `Intl.DateTimeFormat` のイスラム暦は、実行環境によって結果が違うことがある。
- **表示**（FR-TM-09）: JDN を、選んだ暦の表記に戻して表示する。併記では「1050 AH / 1640 CE」のように並べる。ヒジュラ暦の 1 年は西暦の 2 年にまたがるので、西暦の年を「1640–41」のように示す。
- **検証**: Python の convertdate で正解値を作り（`src/core/time/fixtures/`。D-29）、各暦の数千日分について往復の換算が一致することを確かめる。

### 5.2 文字の正規化（FR-FL-12）

- 検索と照合のために、比較用の文字列（照合キー）を作る関数を `src/core/text/` に置く。元の表記は変えない。
- 正規化の手順:
  1. Unicode の NFKC 正規化
  2. アラビア文字の揺れをそろえる
     - 母音記号とタトウィールを除く
     - ハムザ付きのアリフ（أ إ آ）を素のアリフ（ا）に
     - ター・マルブータ（ة）をハー（ه）に
     - アリフ・マクスーラ（ى）とペルシア文字のヤー（ی）をヤー（ي）に
     - ペルシア文字のカーフ（ک）をカーフ（ك）に
  3. 転写の補助記号を除く（ā→a、ḥ→h、ʿ と ʾ を除く、など）
  4. アラビア・インド数字とペルシア数字を算用数字に
  5. 小文字に
  6. 見えない文字（ゼロ幅の文字、双方向の制御文字）を除き、連続する空白を 1 つに
- どの手順を適用するかは、設定で選べるようにする（厳密な照合も選べる）。
- この照合キーは、検索、ファセットの値の照合、日付の月名の解析で共通に使う。
- 関数の形、除く文字の範囲、厳密な照合の意味は D-20 に定める。

---

## 6. フィルタ

### 6.1 フィルタの定義
フィルタは関数ではなく**データ**として持つ。保存（FR-PJ-01）、元に戻す（FR-FL-10）、URL での共有（FR-PJ-04）が簡単になる。

```ts
export type FilterDef =
  | { id: FilterId; kind: 'category'; target: Target; attr: string; include: CategoryKey[] }
  | { id: FilterId; kind: 'range';    target: Target; attr: string; min?: number; max?: number; missing: MissingPolicy }
  | { id: FilterId; kind: 'time';     target: Target; from: DayNumber; to: DayNumber; match: 'overlaps' | 'within'; missing: MissingPolicy }
  | { id: FilterId; kind: 'text';     target: Target; query: string; matching: 'loose' | 'strict' }  // D-21
  | { id: FilterId; kind: 'nodeType'; include: NodeTypeId[] };

export type Target = 'node' | 'edge';
export type MissingPolicy = 'include' | 'exclude';
/** ファセットの項目。値そのものか、理由つきの欠損（FR-FL-06） */
export type CategoryKey = { kind: 'value'; value: string } | { kind: 'missing'; reason: MissingReason };

export interface FilterState {
  filters: FilterDef[];
  edgeRule: 'both-ends' | 'either-end';   // FR-FL-04
  showIsolated: boolean;                  // FR-FL-05
}
```

### 6.2 適用の手順

```
1. 各ノードに、ノード用フィルタをすべて当てはめる → 通過ノード集合 N
2. 各エッジに、エッジ用フィルタをすべて当てはめる → 候補エッジ集合 E'
3. E' のうち、edgeRule を満たすもの（両端が N に含まれる、または片端が含まれる）→ 表示エッジ集合 E
4. showIsolated が false なら、N から E に一度も現れないノードを除く
5. 各フィルタについて、欠損で除外した件数を数える（FR-FL-06）
```

- **ファセットの件数**（FR-FL-07）: ある属性のファセットの件数は、「そのファセット自身を除く、同じ対象のフィルタ」を通った要素（手順 1、2 の段階）で数える。値を選んでも、同じファセットの他の値の件数が 0 にならない（旧版と同じ見せ方）。表示中の件数（FR-FL-09）とは別に示す（D-21 (6)）。
- **計算量**: ノード数 V、エッジ数 E、フィルタ数 F に対して O(F·(V+E))。想定規模では十分速い。
- 属性を持たない要素、複数値、空の `include`、片端の規則での端点の扱い、ファセットの件数の数え方は D-21 に定める。
- **適用中のフィルタの一覧**（FR-FL-08）は、`FilterState.filters` をそのまま並べる。一覧を別に持たない。

### 6.3 Undo と Redo
`FilterState` は変更不可（immutable）の値として扱い、変更のたびに新しい値を作る。履歴は、過去の値の配列として持つ（上限 100）。

---

## 7. グラフの構築、射影、指標

### 7.1 構築（FR-GR-01、02）
- 表示エッジ集合 E から graphology のグラフを作る。種類は `graphMode` に合わせる（`directed`、`undirected`、`mixed`）。
- 同じ 2 点間（有向なら同じ向き）のエッジを 1 本にまとめ、重みを「件数」または「属性の合計」で求める。まとめた元のエッジ ID の一覧を保持する（表や詳細表示から元データに戻れるように）。
- 自己ループは、設定に応じて含めるか除く。
- 重みの選び方、欠損の扱い、まとめたエッジのキー、`GraphSnapshot` は D-22 に定める。

### 7.2 射影（FR-GR-03〜05）
- 入力: グラフ、射影先の型 A、仲介する型 B、重み付けの方法。
- 手順: 型 B の各ノード b について、b に隣接する型 A のノードの組 (a1, a2) すべてに、重みを加える。
- 重み付け:
  - **共通の相手の数**: b ごとに 1 を加える。
  - **Newman 方式**: b の次数を k として、1/(k−1) を加える。多くのノードとつながる相手の寄与を小さくする（Newman 2001, "Scientific collaboration networks. II"）。
  - **Jaccard 係数**: |共通の相手| / |どちらかの相手|。
- 各エッジに、根拠となった b の一覧（`via`）を持たせる（FR-GR-04）。
- 有向の二部グラフは、無向として射影し、その旨を表示する。
- 計算量: 型 B の各ノードの次数を k_b として O(Σ k_b²)。

### 7.3 指標（FR-MT-01〜06）

| 指標 | 有向グラフ | 無向グラフ | 実装 |
|---|---|---|---|
| 次数 | 入・出・合計 | 合計 | graphology |
| 重み付き次数 | 入・出・合計 | 合計 | graphology |
| 媒介中心性 | 向きに沿った最短経路 | 通常 | graphology-metrics（Brandes 2001） |
| 近接中心性 | 入・出を区別 | 通常 | graphology-metrics |
| PageRank | 通常 | 通常 | graphology-metrics |
| 固有ベクトル中心性 | HITS（ハブ・権威）で代替 | 通常 | graphology-metrics |
| k-core、クラスタ係数 | 無向として計算し、その旨を表示 | 通常 | 自作または graphology |
| 相互性（全体） | 往復エッジの割合 | — | 自作 |
| コミュニティ | 無向として計算 | Louvain（Blondel ほか 2008） | graphology-communities-louvain |

- **実行**: Worker で行う。フィルタの変更から 200 ミリ秒待って計算を始める（連続操作で何度も計算しないため）。
- **古い結果の破棄**: state が、計算を頼むたびに版番号を 1 増やして手元に覚え、結果を受け取ったら（await の後で）最新の版かどうかを照合する。最新でなければ捨てる。版番号は Worker との間でやりとりしない（要求と結果の型に含めない）。計算中に新しい依頼が来たら、前の計算を中止する。
- **役割の分担**（D-17）:
  - `src/core/metrics/`: 要求と結果の型、純粋な計算関数。Vitest では Worker を使わず、これを直接テストする。
  - `src/workers/metrics.worker.ts`: Comlink で公開する。受け取った `GraphSnapshot` を組み立て直し、`core/metrics` の計算関数を呼ぶ。
  - `src/workers/metrics.client.ts`: `new Worker(new URL(...), { type: 'module' })` で起動し、Comlink で包む。公開する API は `run(req): Promise<Result>` と `cancel()`。`cancel()` は保留中の Promise を `AbortError` で reject してから Worker を terminate し、次の `run` のために作り直す（terminate すると Comlink の Promise は決して終わらないため）。
  - `src/state/`: 版番号を採番し、古い結果を捨てる。**中止は Worker を terminate して作り直す**（同期の計算は途中で止められないため）。
- **グラフの受け渡し**: graphology のグラフはクラスのインスタンスなので、Worker へそのまま送れない（structured clone できない）。`core/graph` が graphology の書き出し形式（`graph.export()`）を `GraphSnapshot` として作り、Worker の中で `Graph.from()` で組み立て直す。レイアウトも同じ。bundling の入力はグラフではなく、レイアウト後のエッジの座標（§4.3）。
- **T1-20 の指標パネル**: 絞り込み後の `buildGraph` を 200 ms 待って Worker に渡す。state の指標 controller が入力の版を管理し、入力変更・中止・再試行のたびに古い計算と待ち時間を破棄する。結果は保存対象のストアに置かず、購読できる controller の一時キャッシュとして保持する。入力が替わったら古い値はすぐ隠す。手動中止後は再計算ボタンで再開できる。割合の進捗は得られないので不定の progress を使う。
- ノード表はラベル・ID・各指標で並べ替え、50 行ずつ表示する。欠けた値や計算失敗は 0 と区別し、並び順にかかわらず末尾へ置く。同点は ID 順にして再現する。全体指標、計算の注意、短い日英の用語説明（列見出しの title と開閉できる説明一覧）も表示する。グラフ構築の設定は現時点では既定値（重み合計、自己ループ含む）で、T1-19 で viewStore を接続するとき同じ GraphOptions を controller へ渡す。CSV 書き出しは T1-15 の保存操作に接続済み。全ノード指標を出力し、計算中や古い結果は保存しない。
- **注意表示**（FR-MT-05）: ノード型が 2 種類以上あるとき、中心性の欄に注意を出す。
- **検証**: `tests/golden/` に、小さなグラフ（有向、無向、二部、非連結、自己ループあり）と networkx で求めた正解値を置き、相対誤差 1e-6 以内で一致することを確かめる。

---

## 8. 描画

### 8.1 シーン層
レイアウト後の図形を、描画方式に依存しない「シーン」として表す。

```ts
interface Scene {
  width: number; height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  labels: SceneLabel[];
  legend?: SceneLegend;
}
interface SceneNode { id: NodeId; x: number; y: number; r: number; shape: Shape; fill: string; stroke: string; dashed: boolean }
interface SceneEdge { id: string; path: PathCommand[]; width: number | TaperedWidth; color: string | Gradient; opacity: number; head?: ArrowHead; dashed: boolean }
```

- 画面表示と SVG 出力は、同じシーンから作る。そのため、画面と書き出した図が必ず一致する。
- `render` は SVG を **文字列** として作る（DOM を作らない）。**ラベルなどのテキストと属性値は、すべて render がエスケープする。色は形式（`#rrggbb` など）を検証してから使う。** 利用者のデータや、共有されたプロジェクトファイルの文字列が SVG に入るため。Node の Vitest で DOM なしにテストでき、書き出しではそのまま Blob にできる。画面では views がその文字列を使い、ズームやパンの `transform` と、選択などのイベントは views が付ける。
- PNG は、同じ SVG を Canvas に描いて作る。PDF は、svg2pdf.js で SVG を変換して作る。
- 大規模なグラフで SVG が遅い場合は、同じシーンを描く Canvas 版を追加する（NFR-05）。
- `dashed` は欠損の可視化に使う（FR-VG-12）。

### 8.2 見た目への割り当てとスケール（FR-VG-03、04、08）
- スケールの関数は、値 v を、最小値と最大値（ピクセル）の間に写す。
  - **線形**: 値に比例させる。
  - **平方根**（既定、D-08）: 値の平方根に比例させる。ノードの場合は半径に当てはめるので、**面積が値に比例する**。線の場合は、大きい値の線が太くなりすぎるのを抑える。
  - **対数**: log(1+v) に比例させる。桁の違う値が混ざるときに使う。
- 色の割り当ては、カテゴリには色覚の多様性に配慮した配色を、連続値には一方向に濃くなる配色を、既定とする（NFR-07）。
- 配色の置き場所と色、定義域の取り方、負の値と欠損の扱いは D-23 に定める。

### 8.3 有向エッジ（FR-VG-05〜07、09）
- **表し方**
  - **矢印**（既定、D-07）
  - **先細り**: 根元が太く先端が細い線。Holten & van Wijk（CHI 2009, "A user study on visualizing directed edges in graphs"）の実験で、方向を最も速く正確に読み取れた表現。
  - **色の濃淡**: 始点が薄く、終点が濃い。
- **往復エッジ**: A→B と B→A を、それぞれ進行方向の右側にふくらむ 2 次ベジェ曲線にする。ふくらみの量は、2 本の太さの和に比例させ、重ならないようにする。片方向だけのエッジは直線で描く。
- **矢じり**: 終点のノードの縁（円なら半径 r、他の形は外接円）で止める。曲線の場合は、曲線と円の交点を二分法で求める。矢じりの大きさは、線の太さに比例させ（下限あり）、線の端を矢じりの分だけ短くする。
- **R-09 の決定（T1-12）**: 往復判定は集約後グラフの有向エッジだけで行う。曲線の制御点のふくらみは max(24px, 中心間距離×0.2, 往復の線幅の和×2)。無向エッジは往復判定に入れない。自己ループと位置の重なる異なるノードは、外接円より外側の 2 本の Q 曲線で輪を描く（半径は max(24px, ノード外接半径×2, 線幅×3)）。ノード外接円と線幅を考慮し、曲線の最初と最後を二分法で切る。矢じりは max(6px, 線幅×3) の長さを基本に、利用可能な経路長の半分を上限とする。先細りは曲線を32分割して幅を始点から終点へ線形に減らす帯。濃淡は経路に沿う始点から終点への明→暗（SVGは始終点の線形gradient）で、無向エッジには適用しない。範囲は経路の制御点・線幅・矢じり・帯を含む。極端に近く、通常の経路を縁で切れない場合は輪へ切り替える。近接時は進行方向の法線へ輪を膨らませ、同一座標で向きが定まらない場合だけ ID の辞書順で上下を補う。混在する無向辺は直交軸の輪へ分ける。先細りの半幅は経路長の1/4・端点間距離の1/4・最小曲率半径の0.45倍を上限とし、短い強い曲線の帯の反転を避ける。短い矢じりでは幹の実描画幅も底辺幅まで縮める。水平・垂直線もSVGのuserSpaceOnUseで描画でき、座標にepsilonは加えない（SVG2 §14.2.2）。
- **選択時の強調**: ノードを選ぶと、入ってくるエッジと出ていくエッジを別の色で示す。色だけに頼らず、他のエッジを薄くし、凡例に「入」「出」を出す（NFR-07）。
- **無向エッジ**は、矢じりのない直線で描く（自己ループと位置の重なるノードだけは輪）。混在グラフでは両方の描き方が共存する。

### 8.4 Edge bundling（FR-VG-13、14）
- **算法**: Force-Directed Edge Bundling（Holten & van Wijk, EuroVis 2009, "Force-Directed Edge Bundling for Graph Visualization"）を基本にする。
  1. 各エッジを等間隔の点に分割する。
  2. 互いに似たエッジ（角度、長さ、位置、可視性の互換度が高いもの）の対応する点どうしを、ばねのように引き寄せる。
  3. 分割を細かくしながら、2 を繰り返す。
- **向きの扱い**: Divided Edge Bundling（Selassie, Heller & Heer, InfoVis 2011, "Divided Edge Bundling for Directional Network Data"）の考え方を取り入れる。逆向きのエッジどうしは互いに押し離し、別々の車線に束ねる。これで有向の描き分けと両立する。
- **束の太さ**（FR-VG-14）:
  1. bundling の後、近くにある同じ向きの区間を、同じ束の区間としてまとめる（区間の中点を格子に振り分け、距離 ε 以内のものをまとめる）。
  2. 区間ごとに、通るエッジの重みの合計 W を求める。
  3. 太さ = スケール関数(W)。既定は平方根（D-08）。
  4. 区間ごとの太さで、なめらかにつないだ帯として描く。
  - 2 つめの方式として、各エッジを「スケール関数(各エッジの重み)」の太さで半透明に重ね描きする簡易版も用意する。速いが、束の太さは正確に重みを表さない。
- **計算量**: 素朴に作ると、エッジ数の 2 乗に比例する。エッジの中点を格子に振り分け、近い格子のエッジ同士だけ互換度を計算する。エッジが 5,000 本を超えたら警告する。
- **実行**: Worker で行う。レイアウトが変わったら計算し直す。束ねる強さ、反復回数、ε を画面で調整できるようにする。
- **地図**: 同じ算法を、地図に投影した後の座標で使う（§9）。

### 8.5 レイアウト（FR-VG-01、02）
- **置き場所**: 純粋な算法は `src/core/layout/`、Worker は `src/workers/layout.worker.ts`（どちらも graph-algo。D-17 と同じ分担）。
- **力学モデル**: ForceAtlas2（Jacomy ほか 2014）。Worker で動かし、途中経過を画面に流す。途中経過は、コールバックを渡さずに、反復を区切って呼ぶ形（`step(n)` を呼ぶたびに座標を返す）で受け取る（Worker に関数を渡さない規則のため）。乱数の種を固定し、プロジェクトに保存する（NFR-08）。
- **円形**: 型ごとにまとめて円周に並べる。
- **層状**: 型ごとに縦の列に分け、列の中の順序は交差が減るように並べる（重心法）。
- **地理座標**: 緯度・経度をメルカトル図法で平面に写す。
- **手動での固定**: ドラッグしたノードを固定し、その位置をプロジェクトに保存する。

**T1-10 の実装**（2026-11-20）: `core/layout` の `createLayoutSession(job)` と Worker の `start(job)`、`step(n)` が、型・ID の固定順、Mulberry32 の seed、保存した初期位置から計算する。ForceAtlas2 は graphology-layout-forceatlas2 **0.10.1（MIT、版を固定）** の `iterate.js` を薄い型宣言で使い、行列の速度・収束値を Worker 内で保持する。通常の同期 API を step ごとに呼ぶと速度が初期化され、反復の分割の仕方で結果が変わるためである。参照: [Graphology の ForceAtlas2](https://graphology.github.io/standard-library/layout-forceatlas2.html)。

円形では型ごと・ID 順に並べ、固定点は動かさない。固定モードは全ノードの座標を必要とする。seed は 0〜2^32-1、入力座標の絶対値は 10^9 以下、step は 0〜10000 回。Barnes-Hut は 2000 ノード超で既定で有効。client の `run` は古い計算を中止し、`step` は初期化の成功後に呼ぶ。cancel/error/messageerror は保留中の Promise を reject し Worker を捨てる。

`LayoutResult` は種・方式・反復回数・全座標と固定フラグを含み、JSON で保存できる。ただし、**ProjectView と viewStore への保存の接続およびドラッグの UI は T1-19/保存統合で行う**。T1-10 は Worker と純粋な計算の API まで。保存した座標をそのまま表示するときは固定モードで再現し、力学モデルを続ける操作は明示的に開始する。

**T1-19 の画面・保存接続**（2026-11-21、設計版 3.3）: `GraphView` は実 Worker の開始後に ForceAtlas2 を 10 回ずつ 10 組反復する。保存座標が全可視ノードにあれば自動反復せず、そのまま描く。方式・seed の変更と「再配置する」は明示的な計算操作とする。重み集約・自己ループ設定と見た目の変更は既存座標を保ち、グラフと次数を再計算する。固定・解除とドラッグは進行中の計算を中止し、世代番号で古い応答を無効にする。取消・失敗・データ置換・アンマウント時に進行登録を片付ける。

`core/project` に共通型を置き、`view.graph` に方式・seed・全ノードの座標と固定フラグ・ラベル候補・向きの表現・viewport・`GraphOptions`・`EncodingSettings` を任意項目として保存する。状態層は IO 層に依存しない。ファイルと自動保存は同じスナップショットを使う。省略項目だけ既定補完し、null・不正値・重複ID・元データにない位置IDは拒否する（D-24）。フィルタで非表示になったノードの位置も保持する。`selectGraphOptions` は指標パネルが同じ集約条件を読むための窓口である。

画面の大きさは次数・入次数・出次数と数値属性、色は型・カテゴリ属性と同じ次数系指標、形は型または一定形から選ぶ。数値属性の複数値は合計し、カテゴリ色の基準は元データ全体とする。サイズ・線幅のスケールとpx範囲は既存の `parseEncodingSettings` で検証し、既定は平方根。未知の指標は欠損として扱う。入エッジは朱色 `#d55e00`、出エッジは青 `#0072b2`、自己ループ・無向関係・両端選択は紫 `#7b3294` で強調し、画面に凡例を出す。SVG書出しには選択ラベルの候補を渡すが、選択の輪郭・検索色・画面viewportは含めない。

### 8.6 ラベル（FR-VG-10）
- 表示する候補を、表示方法の設定に従って決める。`large`は大きい順の候補を上限件数まで選んでから衝突を除くため、表示数は上限未満になりうる。次点で埋める方式にはしない（小さいノードを補充すると「大きいノードのみ」の候補集合が変わるため）。
- 測定できない幅はUnicodeコードポイント数×文字サイズ×0.6の共通関数で見積もり、配置と図の範囲で同じ値を使う。これはグリフや書記素の正確な測定ではない。
- 空間格子の寸法は矩形幅・高さの中央値（下限/上限つき）で決め、覆う全区画を登録する。64区画を超える長文や安全な整数で表せない巨大座標の矩形は別索引へ置く。通常の小矩形は格子と別索引、巨大矩形は全採用矩形へ照合して、長文1件による全体の格子劣化や無限ループを避ける。
- 大きいノードのラベルから順に置き、すでに置いたラベルと重なるものは表示しない（貪欲法）。同じ大きさはグラフの入力順を保つ。矩形は実測幅と文字サイズの上1em・下0.3emを含み、各辺に2pxの隙間を設ける。空間格子に表示済み矩形を索引化し、近傍だけを照合する。重なりで隠したIDは Scene.hiddenLabels に返す（表示用の派生結果であり、保存しない）。座標を動かす操作・手動ラベル位置の保存は FR-VG-10 に含めず、ノード位置とフォント・表示設定が同じなら配置結果を再現する。表示する配列の順序は既存のグラフ順を保ち、優先順位の処理順と分ける。
- **右から左へ書く文字**（NFR-09）: ラベルの文字の向きを判定する。アラビア文字が主のラベルは、SVG の `direction="rtl"` を付け、ノードの左側に置く。文字の幅は、実際にブラウザで測って重なりを判定する（アラビア文字は連結で幅が変わるため）。`render` はブラウザに依存しないので、幅を測る関数（`measureText(text, font) => number`）を引数で受け取る。画面では views が Canvas で測る関数を渡す。

---

## 9. 地図と時間アニメーション

### 9.1 地図（FR-MP-01〜06）
- **背景地図**: MapLibre GL で描く。既定は OpenStreetMap のラスタータイル。利用者は XYZ 形式の URL を指定できる。ネットに頼らない背景として、Natural Earth の海岸線（低解像度）をアプリに同梱する。
- **束ねた経路**: bundling は重いので Worker で行う。map は投影した座標を props の関数で返し、state が bundling の client を呼び、結果の経路を map が props で受け取る（map は workers を import しない）。
- **重ね合わせ**: deck.gl で描く。ノードは ScatterplotLayer、エッジは ArcLayer（弧）または PathLayer（直線、束ねた経路）で描く。有向の表し方は、§8.3 と同じ幾何計算（`src/render/arrows/`）を地図の座標で使う。
- **範囲選択**（FR-MP-04）: 選んだ範囲を `FilterDef` に変換して、views から props で受け取った関数（`onAddFilter` など）に渡す。地図の中でデータを直接絞り込まない。
- **座標のないノード**（FR-MP-05）: 件数と一覧をパネルに出す。
- **帰属表示**（FR-MP-06）: 地図の右下に常に出す。

### 9.2 時間の制御（FR-TM-02、03）
時間の状態は、ストアの 1 か所で持ち、グラフ、地図、年表が同じものを参照する。

```ts
interface TimeState {
  cursor: DayNumber;                  // 現在時刻（DayNumber はユリウス通日の整数。§5.1）
  mode: 'cumulative' | 'window';      // 累積／移動窓
  windowDays: number;                 // 移動窓の幅
  playing: boolean;
  speed: number;                      // 1 秒あたり何日進むか
}
```

- 再生は `requestAnimationFrame` で進め、タブが非表示のときは止める。
- **再生の時計はアプリに 1 つだけ置く（ui の担当）。** state は `TimeState` と更新の関数（`tick(経過ミリ秒)`、`play`、`pause` など）だけを持つ。`requestAnimationFrame` とタブの表示状態（`document.visibilityState`）で `tick` を呼ぶ駆動は、`src/app/` の 1 つのフック（`usePlaybackClock` など）に置く（state を DOM に依存させないため）。グラフ、地図、年表は `TimeState` を受け取って描くだけで、自分の時計を持たない。
- `src/map/` は `state` を import しない。ストアの値と更新の関数は、views から props で受け取る（§4.1）。
- 幅のある年代のエッジは、「最も早い日」に現れ始め、「最も遅い日」に完全に現れる（不透明度を徐々に上げる）。幅があることが見た目でわかるようにする。

### 9.3 アニメーションの表現（FR-MP-03）
- エッジは、時刻に達すると現れる。移動窓では、窓から外れると薄れて消える。
- 粒子が送り手から受け手へ動く。TripsLayer を使う。
- ノードは、その時点までの累積の次数に応じて大きくなる。

### 9.4 地図の書き出し（FR-OUT-06）
- PNG: 地図の Canvas を、倍率を上げて描き直して保存する。
- SVG: d3-geo で、ノード、エッジ、簡易背景（海岸線）を描き直す。タイルの背景地図は SVG に含めない（その旨を表示する）。

---

## 10. 状態管理

ストアを役割ごとに分ける。

| ストア | 持つもの | プロジェクトに保存 |
|---|---|---|
| `dataStore` | `Dataset`、読み込み時の警告 | する |
| `filterStore` | `FilterState`、Undo/Redo の履歴 | する（履歴は除く） |
| `viewStore` | 見た目の設定、レイアウトの設定、固定位置、ビューの配置、`TimeState` | する（再生中かどうかは除く） |
| `uiStore` | 選択中・ホバー中のノード、開いているパネル、進行表示 | しない |

- 指標、レイアウト結果、シーンなどの計算結果は、ストアに入れずにキャッシュとして持つ（入力から導き出せるため）。
- 自動保存（FR-PJ-02）: `dataStore`、`filterStore`、`viewStore` が変わったら、1 秒待ってから IndexedDB に保存する。

---

## 11. 入出力と保存

### 11.1 読み込み
- T1-22 のサンプルは `public/samples/maghrib.relata.json`。承認済みの全219人物・204関係を `npm run sample:generate` で元の fixture から再生成する。型番号1〜4の意味や Year の生没年の区別は推測しない。D-28 に従い Year をヒジュラ暦の幅のある年として解析し、原文（年40を含む）を保持する。1クリック操作は空の画面に置き、取得・解析失敗は現在のデータを変更せず知らせ、取消または別プロジェクトの読み込み後は遅いサンプルを適用しない。英語の承認済み題名・説明と日本語表示時の和訳を添える。
- **D-34（T1-06、R-03〜05）**: 警告は `ImportWarning`（表、任意のレコード番号と列、code、severity、message）。コードの一覧は `src/io/table/dataset.ts` と `text.ts` を正とする。構造や型に error があれば `dataset: null` と元表の全行を返す。黙って行を捨てたり、型の合わない属性を Dataset に入れたりしない。修正は元表を使って再実行する。警告だけなら Dataset を返す。
- ID 列がない表は「型＋ラベル（NFC のみ）」で合流する。追加で合流した各行に `merged-label` の警告を出し（この件数が合流した追加行の数）、ID 列を勧める。先の行を保持する。ID 列があるのに値が空、または同じ型の ID が重複する場合は error。エッジの source/target は元の ID 列（ID 列がなければラベル）で照合する。複数型に一致する場合は sourceType/targetType の対応を指定するまで error にする。
- Excel は [公式配布元](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/) の SheetJS CE 0.20.3 を採用し、`openExcel` 内で動的 import する。read-excel-file 9.3.20 を調べたが、公開 Options は trim、parseNumber、dateFormat のみで、日付をシリアル値で取得する設定がないため採用しない。SheetJS は `cellDates: false`、`cellNF: true` で読み、日付書式のセルを core/time で換算する。1904 年起点を区別し、1900 年方式のシリアル 60（架空の日）、整数日でない時刻つきセル、エラーセル、計算結果のない数式は元の値と問題を残す。これらがある間は Dataset を生成しない。数式を実行・再計算しない。シート選択の画面は T1-17 で接続する。
- PR #15 レビュー補足（2026-11-21）: 空の参照型はノードと同じ `default` 型として照合する。属性・日付・座標は、IDやラベルの不備があっても検査して問題を収集する。Excel日付は1900方式の1以上（60を除く）、1904方式の0以上の整数に限る。重みは空欄だけを1に補い、欠損記号や非数値はエラーとする。エッジIDは列指定の有無で表全体の生成方式を切り替え、生成IDと明示IDを混在させない。
- T1-06 の解析層（2026-11-20）: 警告の行番号は、ヘッダを 1 とするレコード番号。引用内の改行は番号を増やさない。ファイル全体の文字コード警告では `row` を省略する（R-03 の行番号を確定）。CSV/TSV は引用内の区切り・改行と二重引用符を保持する。列数の違う行は残して警告し、壊れた引用はレコード番号つきの構文エラーにする。
- 列の推定は欠損を除く全セルを検査し、真偽・数値・日付・文字列の順に提案する。年だけの数値を日付にするか、カテゴリにするかは利用者が変更する。型変換に失敗したセルは原文と失敗の状態を返し、Dataset の生成側で警告にする。複数値の一部だけが欠損のときも、黙って削らずセル全体を修正対象にする。
- レビュー補足: `fieldOptions` で date/start/end の暦と欠損記号を列ごとに指定できる。`missingTokens` は表共通の既定で、属性列と座標列にも適用する。座標は両列が同じ理由の欠損なら GeoValue の Missing、片側だけの欠損または理由が違う場合は修正が必要な error とする。列数警告は同じレコードに重複して付けない。
- T1-17（2026-11-21）: ダイアログ内で1表/2表、ファイル/貼付、文字コード/Excelシート、列の用途・型・暦・複数値、欠損記号を設定し、警告一覧を確認してからDatasetを適用する。既存データがある場合は置換確認する。文字コード警告はプレビューを明示確認して進め、構造・型のエラーでは公開しない。CSV式保護の読戻しは利用者が明示したときだけ行う。遅延読取は版番号で破棄し、変換待機中は列設定を変更できず取消は可能とする。
- 手順: ファイル選択 → 形式と文字コードの判定 → 表の解析 → 列の対応づけ（ウィザード）→ `Dataset` の生成 → 警告の一覧の表示。
- 文字コードの判定: (1) BOM があればそれに従う。(2) ファイル**全体**を UTF-8 として厳密に（`TextDecoder` の `fatal: true` で）復号できれば UTF-8。(3) できなければ Shift_JIS（CP932）で同様に試す。(4) どれも通らなければ UTF-8 で読み、置換文字が出た旨を警告する。(5) Shift_JIS と判定したときは、半角カナの割合などから疑わしさを調べて警告し、試し読みを見せる（アラビア語の Windows-1256 のバイト列は、Shift_JIS の半角カナとして誤りなく復号できてしまうため）。フェーズ 1 では UTF-8 と Shift_JIS だけを扱い、後から広げられる形にする（D-27）。判定結果は画面に出し、利用者が変更できる。【なぜ】先頭の一部だけを見ると、切れ目が多バイト文字の途中に当たって誤判定する（T0-13 の io の指摘）。変換は標準の `TextDecoder` で行えるので、encoding-japanese は必要になるまで入れない。
- 警告（FR-IN-06）は `ImportWarning { row?: number; column?: string; code: WarningCode; message: string }` の配列として返す。

#### Palladio 式 1 表（T1-07、FR-IN-04）

`importSingleTable(table, mapping, graphMode, title)` は、始点・終点のラベル列、任意の ID 列、ノード型、属性列の対応を受け取る。両端の型は同じでもよい。ID 指定時は型＋ID、指定がない端点は型＋ラベル（NFC のみ）で識別し、同名異人を区別するには ID 列を使う旨を表全体の警告に出す。ノード型の ID は空を拒否し、前後の空白を整える。

残余列は始点・終点・エッジの属性へ明示的に割り当てる（同じ列の複数箇所への割り当ても可）。同じ型・属性キーの定義は型・複数値の指定を一致させる。Dataset の属性キーは appliesTo ごとに一意なので、異なるノード型に同じ属性キーを指定する対応は RangeError で拒否する（例: sourceCity と targetCity の別キーを指定する）。キーは勝手に書き換えない。同じノードの同じ属性の値（欠損理由を含む）やラベルが異なる場合は、レコード番号と列名を警告に出し、最初の値を保持する。後の行で初めて現れる別の属性は追加する。元表は全行保持し、型変換・ID 空欄・列数などの error がある場合は T1-06 と同じく Dataset を公開しない。

列変換は `convertCell` を再利用する。エッジの重み・向き・時期などは一時的な参照列を作って T1-06 の `importTables` に渡す。内部の仮 ID は結果で元の NodeId に戻し、元の ID 列・型・ラベルによる識別を変更しない。生成した参照列は API の元表に混ぜない。T1-17 がこの API をウィザードに接続する。

### 11.2 書き出し
- T1-15 / R-12: CSV は UTF-8 BOM と式保護をそれぞれ選択でき、どちらも既定で有効。文字列が式候補または先頭アポストロフィなら1個追加し、明示した読戻し設定だけで1個外す。通常のCSV読込は変更しない。実数値は式保護で文字列にしない。ヘッダも同じ保護とRFC4180引用を適用する。
- CSV は現在のフィルタ対象の全ノード・元エッジ（集約前）と全ノード指標・全体指標を4ファイルへ出す。ページング・表のソートで行を省略しない。IDはcanonical IDで参照を揃える。属性はschemaと対象レコードのown属性キーの和集合を出し、未宣言の値も残す。列は attr./missing./kind./certainty. 接頭辞を付けて特殊な属性名と予約列の衝突を防ぐ。欠損は空欄と理由列、属性なしはnot-applicableのkindで区別する。複数値・幅のある日付・期間はJSON文字列で原文・暦・確からしさ・境界を保ち、曖昧な区切りで結合しない。完全なモデル往復はプロジェクトJSONの役割で、CSVの再読込では型と列対応を利用者が指定する。失敗した指標は空欄とstatusへ出し、0にしない。古い結果がある間は指標CSVを無効にする。
- 図: §8.1（SVG、PNG、PDF）、§9.4（地図）
- CSV: ノード、エッジ、指標を別々のファイルにする。欠損は空欄にし、理由は別の列に書く。
- GraphML、GEXF: graphology の対応ライブラリを使う。
- PDF の日本語: Noto Sans JP を、図に使われている文字だけに絞って埋め込む。
- PDF のアラビア文字: jsPDF は、アラビア文字の連結（語頭形・語中形・語末形の選択）と、左右の向きが混ざる文の並べ替えを、自分では正しく行えない。そこで、アラビア文字を含むラベルは harfbuzzjs で整形し、字形の輪郭（パス）として PDF に描く。SVG と PNG はブラウザが整形するので、この処理は不要。
- 書き出した図で、アラビア文字が正しく表示されることを、E2E テストで画像として比べて確かめる。

PR #20 レビュー補足（2026-11-22）: 無効なID・ラベルの行でも属性などの独立したセルの問題を診断する。Datasetはerrorがあれば公開せず元表を保持するため、不正ノードを生成することにはならない。複数値は順序を持つ配列として保存し、順序違いも原文の差として警告する。最初の欠損も理由付きの記録であり、後の値で自動補完しない。別の属性キーが初めて出た場合の追加とは区別する。`convertCell`の設定検査は欠損判定より先に行う。表共通・エッジ共通・時点/期間列の欠損設定は空表でも検査し、一時ノードの復元は出力配列順でなくcanonical ID内の一時キーに従う。

### 11.3 プロジェクトファイル（FR-PJ-01、03）
```ts
interface ProjectFile {
  app: 'Relata';
  formatVersion: number;          // 1 から始める。互換性のない変更のときだけ上げる（D-24）
  savedAt: string;                // ISO 8601
  dataset: Dataset;
  importSettings: ImportSettings; // 欠損の記号、文字コード、列ごとの暦（D-18、D-24）
  view: { filter: FilterState };  // 見た目、配置、時間の設定は後のタスクで任意の項目として足す
}
```
- 版の移行: `migrations: Record<number, (old: unknown) => unknown>` に「版 n から n+1 への変換」を並べ、古いファイルを順に変換する。変換関数ごとにテストを書く。
- 書き出して読み込み直すと元に戻ること（往復の一致）をテストで確かめる。

---

## 12. エラーと警告の扱い
- **利用者のデータの問題**（読み込みの警告、解析できない日付など）: 処理を止めず、警告の一覧として示す。問題のある行も捨てない。
- **計算の失敗**（指標が収束しないなど）: その指標だけ「計算できませんでした」と表示し、理由を添える。他の指標は表示する。
- **想定外のエラー**: 画面上部に通知を出し、自動保存した状態から再開できるようにする。

---

## 13. 旧 Palladio の問題への対応

[filter-audit.md](filter-audit.md) の項目番号に対応する。各項目に回帰テストを書く。

T1-23 は MVP で利用できる #1〜10 と関連 issue の回帰を確認する。#11（地図の範囲選択、FR-MP-04）は要件のフェーズ 3・T3-06 で実装と回帰テストを行い、MVP の確認で実装済みとは扱わない。対応するテストと保留範囲は [回帰テスト対応表](regression-coverage.md) に記録する。

| # | 旧版の問題 | 対応 | 関連要件 |
|---|---|---|---|
| 1, 5 | 集計の差分更新がずれる | 絞り込み後の集合から毎回計算し直す（§1-5、§7.1） | FR-GR-01 |
| 2, 3 | 適用中フィルタの表示と実際の絞り込みがずれる | フィルタをデータとして 1 か所で持ち、一覧はそこから導き出す（§6.1、6.2） | FR-FL-08 |
| 4 | フィルタの待ち行列の処理が壊れている | 待ち行列を持たない。計算は版番号付きで行い、古い結果を捨てる（§7.3） | FR-MT-03 |
| 6 | ノードのフィルタがない | ノード用とエッジ用のフィルタを分ける（§6） | FR-FL-01 |
| 7 | ノードを名前だけで識別 | ID と型で識別する（§5） | FR-DM-01 |
| 8 | 向きを無視している | `graphMode` と `directed` を持ち、指標も向きに対応させる（§5、§7.3） | FR-DM-03、FR-MT-01 |
| 9 | エッジのキーが文字列の連結 | エッジにも ID を持たせる（§5） | FR-DM-08 |
| 10 | 欠損値の扱いが雑 | 理由つきの欠損と、フィルタごとの欠損の扱い（§5、§6） | FR-DM-04、FR-FL-06 |
| 11 | 地図から絞り込めない | 範囲選択を FilterDef に変換する（§9.1） | FR-MP-04 |

---

## 14. 静的ホスティングと CI

- リポジトリ: `https://github.com/qsarkbir/relata`。v0.1 の公開までは非公開（D-11）。
- 公開先の URL: `https://qsarkbir.github.io/relata/`。Vite の `base` を `/relata/` にする。
- **注意**: リポジトリを非公開にしても、GitHub Pages のサイト自体は、URL を知っていれば誰でも見られる。中身は空のアプリで利用者のデータも含まないので、フェーズ 0 から配信する（D-12）。
- GitHub Actions のワークフロー:
  - **プルリクエストと push**: `npm ci` → `lint` → `typecheck` → `test` → `build`
  - **`main` への push**: 上記に加えて、GitHub Pages に配信する。
  - E2E テストは、配信前に Chromium で実行する。

---

## 15. コーディング規約（要約）
詳細は [CLAUDE.md](../CLAUDE.md)。全エージェントがそれに従う。

- TypeScript の strict。`any` を使わない。判別共用体は `assertNever` で網羅を検査する。
- export するものには TSDoc を付ける。
- `// 【TS】` で TypeScript の機能を、`// 【なぜ】` で設計の理由を説明する。
- 算法には手順ごとのコメント、出典、計算量を書く。
- テスト名に要件 ID を入れる（例: `FR-FL-08: …`）。

---

# 第 II 部 開発計画

## 16. 開発体制

### 16.1 役割
サブエージェントの定義は `.claude/agents/` にある。メインのセッションが**統括役**として、タスクの分割、各エージェントへの指示、統合、文書（特に[進行表](progress.md)）の更新を担う。

| エージェント | 担当 | 書き込んでよい場所 |
|---|---|---|
| `core-model` | データモデル、フィルタ、時間、グラフ構築、射影、見た目への割り当て | `src/core/`（`metrics/` と `layout/` を除く） |
| `graph-algo` | 指標、レイアウト、edge bundling の算法、Worker | `src/workers/`、`src/core/metrics/`、`src/core/layout/`、`src/render/bundling/`、`tests/golden/` |
| `renderer` | シーン層、SVG 描画、有向エッジの幾何、図の書き出し | `src/render/`（`bundling/` を除く）、`src/io/export/` の図の部分 |
| `map-geo` | 地図ビュー、時間アニメーション、地図の書き出し | `src/map/` |
| `ui` | React の画面、状態管理、読み込みウィザード、多言語対応 | `src/views/`、`src/state/`、`src/app/`、`src/i18n/`、`index.html` |
| `io` | 各形式の読み込みと書き出し（図以外）、プロジェクトファイル、サンプルデータ | `src/io/`（図の書き出しを除く）、`public/samples/` |
| `qa-tester` | 要件 ID つきのテスト、E2E、回帰テスト、CI、共通の設定 | `tests/`（`tests/fixtures/<担当>/` を除く）、`.github/workflows/`、共通の設定ファイル（下記） |
| `reviewer` | 型、層の境界、コメント規約、旧版の不具合の再発を確認（書き込まない） | なし |

**テストの置き場所**: 実装担当は、自分の範囲のコードの単体テストを、同じフォルダの `*.test.ts` に書く（§16.2 の 2）。テスト用のデータは、TypeScript のデータなら自分の範囲の `fixtures/`（例: `src/core/model/fixtures/`。`src/` のテストからは `tests/` を import できないため）、ファイル（文字コードの見本など）なら `tests/fixtures/<担当の範囲>/`（例: `tests/fixtures/io/`）に置く。`fixtures/` はカバレッジの対象から外し、本番のコードから import しない。qa-tester は、要件 ID を名前に含むテスト、回帰テスト、E2E を `tests/`（`tests/unit/`、`tests/regression/`、`tests/e2e/`）に足し、実装担当の `*.test.ts` は書き換えない（並行作業で同じファイルを書かないため）。

**共通のファイルの扱い**:
- `package.json` と `package-lock.json`: 実装担当は、自分のタスクに要る依存を `npm install` で足してよい。 実行時の依存（`dependencies`）を足したときは、「このツールについて」の一覧 `src/views/libraries.ts` にも足してよい（ui の範囲だが、一致のテスト［D-25］を通すため例外とする）。足す前に統括役に名前と理由を伝え、ライセンス（NFR-12）と版を完了報告に書く（並行する worktree で lock ファイルがぶつかるのを避けるため）。scripts は変えない（qa-tester が統括役の指示で変える）。worktree で作業するときは、最初に `npm ci` を実行する。
- `tsconfig*.json`、`eslint.config.js`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`.prettierrc`、`.prettierignore`、`.nvmrc`、`.npmrc`、`.gitignore`: 統括役が qa-tester に頼んで変える。実装担当は、変更が要るときは統括役に報告する。
- `docs/`、`CLAUDE.md`、`.claude/`: 統括役だけが変える。

**使うモデル**（D-13）:

| 役割 | モデル | 設定のしかた |
|---|---|---|
| 統括役（メインのセッション） | Opus | 利用者が Claude Code で選ぶ |
| `reviewer` | Opus | エージェント定義の `model: opus` |
| 実装担当（`core-model`、`graph-algo`、`renderer`、`map-geo`、`ui`、`io`、`qa-tester`） | Sonnet | エージェント定義の `model: sonnet` |
| 軽い仕事（ファイルや用例の検索、一覧づくり、定型の確認、文書の書式直し） | Haiku | 統括役が汎用のエージェント（`Explore` など）を呼ぶときに Haiku を指定する |

判断に迷う設計上の問題や、Sonnet が 2 回続けて同じところでつまずいた問題は、統括役が引き取る。

### 16.2 1 つのタスクの進め方
1. **統括役**が、進行表のタスクを選び、受け入れ条件（関連する要件 ID とテスト）を決めて担当に渡す。
2. **担当エージェント**が実装し、自分の範囲の単体テストを書く。
3. **qa-tester** が、要件 ID を名前に含むテストを足し、全テストが通ることを確かめる。
4. **reviewer** が確認する。「必須」の指摘があれば、2 に戻る。
5. **統括役**が統合し、進行表を更新する。必要なら設計書も更新する。

### 16.3 並行作業の規則
- 書き込む場所が重ならないタスクは、並行して進めてよい。それぞれ別の git worktree で作業する。
- `src/core/model/` の型の変更は全員に影響するので、並行させない。各フェーズの最初に確定させる。
- 他のエージェントの担当範囲を変える必要が出たら、自分では直さず、統括役に報告する。
- 同じ作業フォルダで複数のエージェントが動くときは、`npm test` と `npm run lint` を実行しない（`npm test` に含まれる層の境界の検査が、`src/` に一時ファイルを書くため）。§16.4 の「範囲を絞った確認」を使い、全体の確認は統括役が最後に行う。

### 16.4 全エージェント共通の作業手順
**確認のコマンド**
- 単独で作業しているとき: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm test`。画面や配信に関わるときは `npm run build` と `npm run test:e2e` も。
- 他のエージェントと同じフォルダで作業しているとき（範囲を絞った確認）: `npx vitest run <自分の範囲>`、`npx eslint <自分の範囲>`、`npm run typecheck`、`npx prettier --check <自分の範囲>`。

**ESLint で特に引っかかりやすい規則**（`eslint.config.js`）
- 層の境界（§4.1）: import の向き、JSX と `.tsx` の禁止（core、render、i18n）、動的 `import()` の禁止（同）、ブラウザのグローバルと `Date` の禁止（core、i18n）。
- `eslint-disable` には `-- 理由` を必ず書く。使われていない disable はエラーになる。
- export する関数（アロー関数を含む）、クラス、interface、type には TSDoc が要る。`@param` と `@returns` も要る。
- `switch` は網羅が要る（`switch-exhaustiveness-check`）。わざと網羅しないテストでは、理由つきの disable を使う。
- 型から見て不要な条件（`no-unnecessary-condition`）、`??` を使える箇所の `||`（`prefer-nullish-coalescing`）もエラーになる。

**完了報告の共通の項目**（各エージェント定義の項目に加えて書く）
1. 対応した要件 ID
2. 作った・変えた・消したファイル
3. 確認の結果（コマンドごとの成否、テストの件数）
4. 追加した依存（版とライセンス）
5. 設計文書と食い違った点、追記すべき点、決まっていなかった点
6. 指示から外れた点とその理由

**してはいけないこと**
- コミット、push、ブランチの切り替え（統括役が行う）。
- 担当範囲の外のファイルの変更。必要なら統括役に報告する。

---

## 17. 開発環境

| 項目 | 内容 |
|---|---|
| 作業場所 | メインのマシンの `C:\Users\qsark\Documents\GitHub\2026_relata`（D-06） |
| リポジトリ | `https://github.com/qsarkbir/relata`（v0.1 まで非公開） |
| 必要なツール | Git、Node.js（LTS 版を推奨）、Python 3 ＋ networkx ＋ convertdate（正解値の生成のみ） |
| エディタ | 任意（VS Code を推奨。TypeScript の補完とエラー表示が使える） |
| Claude Code | 作業場所のフォルダで起動する。`CLAUDE.md` と `.claude/agents/` が自動で読み込まれる |
| 参照用の旧ソース | `upstream/`。リポジトリには含めない（`.gitignore`）。必要なときだけ参照する |

Node.js の版は `package.json` の `engines` と `.nvmrc` で固定し、CI と手元で同じ版を使う（現在は 24 系）。`.npmrc` の `engine-strict=true` で、版が合わないときは導入を止める。CI では `actions/setup-node` の `node-version-file: .nvmrc` を使う。

---

## 18. git の運用
- `main` は常に動く状態を保つ。CI が通らない変更は `main` に入れない。
- タスクごとにブランチを作る。名前は `t<フェーズ>-<番号>-<短い説明>`（例: `t1-05-filter-core`）。
- コミットのメッセージは日本語でよい。先頭にタスク ID を付ける（例: `T1-05: フィルタの適用を実装`）。
- コミットは、統括役または利用者が指示したときだけ行う。
- 並行作業は git worktree で分ける。

---

## 19. フェーズ計画

各フェーズのタスクの一覧と状態は[進行表](progress.md)で管理する。ここでは、目標と完了条件を定める。

| フェーズ | 目標 | 主な要件 | 完了条件 |
|---|---|---|---|
| 0 準備 | 開発の土台を作る | NFR-01、NFR-10、NFR-11 | 空のアプリが GitHub Pages で表示される。CI が通る。全エージェントが試運転を終えている |
| 1 MVP | 有向・無向のネットワークを読み込み、絞り込み、指標を見て、SVG で書き出せる | FR-IN-01〜09、FR-DM（フェーズ 1）、FR-FL（フェーズ 1。FR-FL-12 を含む）、FR-TM-06、FR-GR-01、02、FR-MT-01〜04、FR-VG-01、03〜11、FR-OUT-01、02、FR-PJ-01、02、FR-UI-01、03〜05 | 要件定義書 §9 の基準。UC-1 の E2E が通る。旧版の回帰テストが全項目通る。v0.1 として公開する |
| 2 研究機能 | k-partite と射影、欠損の可視化、時間による絞り込みと再生、表ビュー、PDF | フェーズ 2 の要件すべて | UC-2、UC-4、UC-5 の E2E が通る。v0.2 として公開する |
| 3 地図と bundling | 地図上の時間アニメーションと、edge bundling | フェーズ 3 の要件すべて | UC-3 の E2E が通る。v0.3 として公開する |
| 4 拡張 | 出典、同定、ユリウス暦・太陽ヒジュラ暦・ルーミー暦、各形式の取り込みなど | フェーズ 4 の要件 | 要件ごとに判断する |

- フェーズ 1 の最初のタスクは、データモデルの型（`src/core/model/`）の確定とする。他のタスクはこれに依存する。
- 各フェーズの開始時に、統括役が進行表のタスクを細かく分け、担当と依存関係を決める。

---

## 20. 完了の定義（タスク単位）

タスクは、次をすべて満たしたときに「完了」とする。

- [ ] 受け入れ条件（関連する要件 ID）を満たす。
- [ ] 要件 ID を名前に含むテストがあり、通る。
- [ ] `npm run typecheck`、`npm run lint`、`npm test` がすべて通る。
- [ ] コメント規約（TSDoc、`【TS】`、`【なぜ】`）を満たす。
- [ ] reviewer の「必須」の指摘がない。
- [ ] 設計と違うことをした場合は、設計書を更新した。
- [ ] 進行表を更新した。

---

## 21. リスク

| リスク | 影響 | 対策 |
|---|---|---|
| Edge bundling が重い（エッジ数の 2 乗に比例） | フェーズ 3 の遅れ | 格子による近傍探索、Worker での計算、上限での警告（§8.4） |
| 束の区間をまとめる処理（§8.4 の太さの計算）が難しい | 見た目の質 | 簡易版（半透明の重ね描き）を先に作り、まとめる方式は後から改良する |
| 地図（WebGL）をそのまま SVG にできない | 書き出しの制限 | d3-geo で描き直す。背景地図は簡易版にする（§9.4） |
| PDF の日本語 | 文字化け | フォントのサブセット化と埋め込み（§11.2） |
| PDF のアラビア文字 | 文字がつながらない、並びが逆になる | harfbuzzjs で整形し、輪郭として描く。画像比較のテストで確かめる（§11.2） |
| ヒジュラ暦の換算と、史料上の日付のずれ | 1〜2 日のずれ | 日付に幅を持たせる。換算の方式を画面と書き出しに明記する（§5.1） |
| OpenStreetMap のタイル利用規約 | 利用の制限 | 帰属表示、タイル URL の差し替え（§9.1） |
| SVG 描画が大規模グラフで遅い | 操作性 | シーン層があるので、Canvas 版を追加できる（§8.1） |
| 1 人での学習と開発の両立 | 進行の遅れ | 進行表で現在地と次の一歩を常に明示する。フェーズごとに公開し、区切りを作る |
