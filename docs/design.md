# Relata 設計書（開発計画書を兼ねる）

| 項目 | 内容 |
|---|---|
| 文書番号 | RLT-DES |
| 版 | 1.6（2026-11-18） |
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

---

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
| 表データの読み込み | Papa Parse（CSV）、SheetJS（Excel）、encoding-japanese（Shift_JIS） | 定番 |
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
  views（React の画面）──→ state（Zustand）──→ core（純粋な TS）
        │                                         ↑
        ├──→ render（シーン → SVG/Canvas）───────────┤
        └──→ map（MapLibre + deck.gl）──────────────┤
  workers（指標・レイアウト・bundling）────────────────┤
  io（読み込み・書き出し）─────────────────────────────┘
```

- **`src/core/` は何にも依存しない。** DOM、React、ブラウザ API、`Date` を使わない。JSX も書かない（`.tsx` を置かない）。
- **`src/render/` は React に依存しない。** 画面からも書き出し処理からも呼べるようにする。JSX も書かない。`core` と `i18n`（書き出しのラベル用）だけに依存し、`state`、`views`、`app`、`map`、`io`、`workers` を import しない。
- **`src/io/` と `src/workers/` は画面に依存しない。** React、Zustand、`state`、`views`、`app` を import しない。`io/export` の図の部分は `render` を使う。`workers/bundling.worker.ts` は `render/bundling/` の算法を使う（§16.1 の分担による例外ではなく、上の図の「下向き」の依存として許す）。
- **`src/i18n/` は React と画面とブラウザに依存しない。** `render` から使われるため（D-15）。React、Zustand、地図のライブラリ、`state`、`views`、`app`、`render`、`map`、`io`、`workers` を import せず、`navigator` などのブラウザのグローバルと `Date` を使わず、JSX を書かない。`core` には依存してよい。言語の判定に要る値（`navigator.languages` など）は呼ぶ側が渡す。
- これらの規則は ESLint で機械的に検査する（パスを解決して判定する `import-x/no-restricted-paths`、パッケージ名の `no-restricted-imports`、ブラウザのグローバルの `no-restricted-globals`、JSX と動的 import の `no-restricted-syntax`）。検査が効いていることは `tests/lint/check-boundaries.mjs` で確かめる。
- さらに `core` は、DOM の型を持たない `tsconfig.core.json`（`lib: ["ES2022"]`）でも型検査する。ESLint の名前の一覧では漏れる DOM の型やグローバルを、型検査で止めるため。

### 4.2 ディレクトリ構成

```
src/
  core/                  純粋な TypeScript。単体テストの主対象
    model/               データ型（Dataset, Node, Edge, AttrValue, TimeSpan …）
    filter/              フィルタの定義と適用
    time/                日付の解析、暦の換算（西暦・ヒジュラ暦…）、幅のある年代の計算
    text/                検索と照合のための文字の正規化（アラビア文字、転写の補助記号）
    graph/               graphology グラフの構築、重みの集約、射影
    metrics/             指標の結果の型と、Worker の中でも呼べる純粋な計算関数。Worker を起動して呼び出す窓口は state 側に置く（core は Worker を扱えないため）
    encode/              見た目への割り当て（指標→大きさ、属性→色、スケール）
    util/                assertNever など共通の小道具
  io/
    import/              CSV、Excel、JSON（将来: GEXF、GraphML、旧 Palladio）
    export/              CSV、GraphML、GEXF、プロジェクト JSON、図（SVG/PDF/PNG）
    project/             プロジェクトファイルの型と版の移行
  workers/               metrics.worker.ts、layout.worker.ts、bundling.worker.ts
  render/
    scene/               描画方式に依存しない「シーン」の型と生成
    svg/                 SVG 描画（画面表示と書き出しの両方）
    arrows/              矢印・先細りエッジ・往復エッジの幾何計算
    bundling/            edge bundling の算法
  map/                   地図ビュー
  state/                 Zustand ストア
  views/                 React コンポーネント
  app/                   起動処理、画面の配置
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

/** ユリウス通日（JDN）。暦に依存しない日の通し番号（§5.1） */
export type DayNumber = number;

/** ノード型（k-partite の「部」） */
export interface NodeType {
  id: NodeTypeId;
  label: string;
  color?: string;
  shape?: 'circle' | 'square' | 'triangle' | 'diamond';
}

/** 属性の値。欠損を理由つきで持つため、判別共用体にする（FR-DM-04） */
export type AttrValue =
  | { kind: 'value'; value: Scalar | Scalar[]; certainty?: Certainty }   // Scalar[] は複数値（FR-DM-07）
  | { kind: 'missing'; reason: MissingReason };

export type Scalar = string | number | boolean;
export type MissingReason = 'unrecorded' | 'lost' | 'illegible' | 'not-applicable';
export type Certainty = 'certain' | 'probable' | 'possible';

/** 幅のある日付。最も早い日と最も遅い日で表す（FR-DM-05） */
export interface FuzzyDate {
  earliest: DayNumber;
  latest: DayNumber;
  certainty: Certainty;
  label: string;          // 元の表記（例: "c.1650"）
}

/** 期間。始点と終点がそれぞれ幅を持てる。1 点の日付なら start だけ */
export interface TimeSpan {
  start: FuzzyDate;
  end?: FuzzyDate;
}

export interface Node {
  id: NodeId;
  type: NodeTypeId;
  label: string;
  attrs: Record<string, AttrValue>;
  geo?: { lat: number; lon: number };
  time?: TimeSpan;
}

export interface Edge {
  id: EdgeId;             // 多重エッジを区別するため、エッジにも ID を持たせる（FR-DM-08）
  source: NodeId;
  target: NodeId;
  directed: boolean;
  relation?: string;
  weight: number;         // 既定 1
  time?: TimeSpan;
  attrs: Record<string, AttrValue>;
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
  graphMode: 'directed' | 'undirected' | 'mixed';    // FR-DM-03
  nodeTypes: NodeType[];
  nodes: Node[];
  edges: Edge[];
  schema: AttributeDef[];
  missingCodes: { symbol: string; reason: MissingReason }[];   // FR-IN-07
  meta: { title: string; source?: string };
}
```

- `graphMode` が `directed` なら全エッジの `directed` は true、`undirected` なら false。`mixed` のときだけエッジごとに異なる。
- 読み込み処理（`src/io/import/`）は、必ずこの `Dataset` を出力する。
- `FuzzyDate` には、元の表記（`label`）と元の暦（`calendar: 'gregorian' | 'hijri' | …`）も持たせ、表示や書き出しで元の表記に戻れるようにする。

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
- **検証**: Python の convertdate で正解値を作り（`tests/golden/calendars/`）、各暦の数千日分について往復の換算が一致することを確かめる。

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
- どの手順を適用するかは、設定で選べるようにする（厳密な照合も選べる）。
- この照合キーは、検索、ファセットの値の照合、日付の月名の解析で共通に使う。

---

## 6. フィルタ

### 6.1 フィルタの定義
フィルタは関数ではなく**データ**として持つ。保存（FR-PJ-01）、元に戻す（FR-FL-10）、URL での共有（FR-PJ-04）が簡単になる。

```ts
export type FilterDef =
  | { id: FilterId; kind: 'category'; target: Target; attr: string; include: CategoryKey[] }
  | { id: FilterId; kind: 'range';    target: Target; attr: string; min?: number; max?: number; missing: MissingPolicy }
  | { id: FilterId; kind: 'time';     target: Target; from: DayNumber; to: DayNumber; match: 'overlaps' | 'within'; missing: MissingPolicy }
  | { id: FilterId; kind: 'text';     target: Target; query: string }
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

- **ファセットの件数**（FR-FL-07）: ある属性のファセットの件数は、「そのファセット自身を除くすべてのフィルタ」を当てはめた集合で数える。値を選んでも、同じファセットの他の値の件数が 0 にならない（旧版と同じ見せ方）。
- **計算量**: ノード数 V、エッジ数 E、フィルタ数 F に対して O(F·(V+E))。想定規模では十分速い。
- **適用中のフィルタの一覧**（FR-FL-08）は、`FilterState.filters` をそのまま並べる。一覧を別に持たない。

### 6.3 Undo と Redo
`FilterState` は変更不可（immutable）の値として扱い、変更のたびに新しい値を作る。履歴は、過去の値の配列として持つ（上限 100）。

---

## 7. グラフの構築、射影、指標

### 7.1 構築（FR-GR-01、02）
- 表示エッジ集合 E から graphology のグラフを作る。種類は `graphMode` に合わせる（`directed`、`undirected`、`mixed`）。
- 同じ 2 点間（有向なら同じ向き）のエッジを 1 本にまとめ、重みを「件数」または「属性の合計」で求める。まとめた元のエッジ ID の一覧を保持する（表や詳細表示から元データに戻れるように）。
- 自己ループは、設定に応じて含めるか除く。

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
- **古い結果の破棄**: 計算を頼むたびに版番号を 1 増やし、結果に版番号を付けて返す。最新の版でない結果は捨てる。計算中に新しい依頼が来たら、前の計算を中止する。
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
- PNG は、同じ SVG を Canvas に描いて作る。PDF は、svg2pdf.js で SVG を変換して作る。
- 大規模なグラフで SVG が遅い場合は、同じシーンを描く Canvas 版を追加する（NFR-05）。
- `dashed` は欠損の可視化に使う（FR-VG-12）。

### 8.2 見た目への割り当てとスケール（FR-VG-03、04、08）
- スケールの関数は、値 v を、最小値と最大値（ピクセル）の間に写す。
  - **線形**: 値に比例させる。
  - **平方根**（既定、D-08）: 値の平方根に比例させる。ノードの場合は半径に当てはめるので、**面積が値に比例する**。線の場合は、大きい値の線が太くなりすぎるのを抑える。
  - **対数**: log(1+v) に比例させる。桁の違う値が混ざるときに使う。
- 色の割り当ては、カテゴリには色覚の多様性に配慮した配色を、連続値には一方向に濃くなる配色を、既定とする（NFR-07）。

### 8.3 有向エッジ（FR-VG-05〜07、09）
- **表し方**
  - **矢印**（既定、D-07）
  - **先細り**: 根元が太く先端が細い線。Holten & van Wijk（CHI 2009, "A user study on visualizing directed edges in graphs"）の実験で、方向を最も速く正確に読み取れた表現。
  - **色の濃淡**: 始点が薄く、終点が濃い。
- **往復エッジ**: A→B と B→A を、それぞれ進行方向の右側にふくらむ 2 次ベジェ曲線にする。ふくらみの量は、2 本の太さの和に比例させ、重ならないようにする。片方向だけのエッジは直線で描く。
- **矢じり**: 終点のノードの縁（円なら半径 r、他の形は外接円）で止める。曲線の場合は、曲線と円の交点を二分法で求める。矢じりの大きさは、線の太さに比例させ（下限あり）、線の端を矢じりの分だけ短くする。
- **選択時の強調**: ノードを選ぶと、入ってくるエッジと出ていくエッジを別の色で示す。色だけに頼らず、他のエッジを薄くし、凡例に「入」「出」を出す（NFR-07）。
- **無向エッジ**は、矢じりのない直線で描く。混在グラフでは両方の描き方が共存する。

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
- **力学モデル**: ForceAtlas2（Jacomy ほか 2014）。Worker で動かし、途中経過を画面に流す。乱数の種を固定し、プロジェクトに保存する（NFR-08）。
- **円形**: 型ごとにまとめて円周に並べる。
- **層状**: 型ごとに縦の列に分け、列の中の順序は交差が減るように並べる（重心法）。
- **地理座標**: 緯度・経度をメルカトル図法で平面に写す。
- **手動での固定**: ドラッグしたノードを固定し、その位置をプロジェクトに保存する。

### 8.6 ラベル（FR-VG-10）
- 表示する候補を、表示方法の設定に従って決める。
- 大きいノードのラベルから順に置き、すでに置いたラベルと重なるものは表示しない（貪欲法）。
- **右から左へ書く文字**（NFR-09）: ラベルの文字の向きを判定する。アラビア文字が主のラベルは、SVG の `direction="rtl"` を付け、ノードの左側に置く。文字の幅は、実際にブラウザで測って重なりを判定する（アラビア文字は連結で幅が変わるため）。

---

## 9. 地図と時間アニメーション

### 9.1 地図（FR-MP-01〜06）
- **背景地図**: MapLibre GL で描く。既定は OpenStreetMap のラスタータイル。利用者は XYZ 形式の URL を指定できる。ネットに頼らない背景として、Natural Earth の海岸線（低解像度）をアプリに同梱する。
- **重ね合わせ**: deck.gl で描く。ノードは ScatterplotLayer、エッジは ArcLayer（弧）または PathLayer（直線、束ねた経路）で描く。有向の表し方は、§8.3 と同じ幾何計算（`src/render/arrows/`）を地図の座標で使う。
- **範囲選択**（FR-MP-04）: 選んだ範囲を `FilterDef` に変換して、ストアに渡す。地図の中でデータを直接絞り込まない。
- **座標のないノード**（FR-MP-05）: 件数と一覧をパネルに出す。
- **帰属表示**（FR-MP-06）: 地図の右下に常に出す。

### 9.2 時間の制御（FR-TM-02、03）
時間の状態は、ストアの 1 か所で持ち、グラフ、地図、年表が同じものを参照する。

```ts
interface TimeState {
  cursor: DayNumber;                  // 現在時刻
  mode: 'cumulative' | 'window';      // 累積／移動窓
  windowDays: number;                 // 移動窓の幅
  playing: boolean;
  speed: number;                      // 1 秒あたり何日進むか
}
```

- 再生は `requestAnimationFrame` で進め、タブが非表示のときは止める。
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
- 手順: ファイル選択 → 形式と文字コードの判定 → 表の解析 → 列の対応づけ（ウィザード）→ `Dataset` の生成 → 警告の一覧の表示。
- Shift_JIS の判定: 先頭の一部を UTF-8 として解釈し、不正なバイト列があれば Shift_JIS とみなす。利用者が手動で変更できる。
- 警告（FR-IN-06）は `ImportWarning { row: number; column?: string; code: WarningCode; message: string }` の配列として返す。

### 11.2 書き出し
- 図: §8.1（SVG、PNG、PDF）、§9.4（地図）
- CSV: ノード、エッジ、指標を別々のファイルにする。欠損は空欄にし、理由は別の列に書く。
- GraphML、GEXF: graphology の対応ライブラリを使う。
- PDF の日本語: Noto Sans JP を、図に使われている文字だけに絞って埋め込む。
- PDF のアラビア文字: jsPDF は、アラビア文字の連結（語頭形・語中形・語末形の選択）と、左右の向きが混ざる文の並べ替えを、自分では正しく行えない。そこで、アラビア文字を含むラベルは harfbuzzjs で整形し、字形の輪郭（パス）として PDF に描く。SVG と PNG はブラウザが整形するので、この処理は不要。
- 書き出した図で、アラビア文字が正しく表示されることを、E2E テストで画像として比べて確かめる。

### 11.3 プロジェクトファイル（FR-PJ-01、03）
```ts
interface ProjectFile {
  app: 'Relata';
  formatVersion: number;          // 1 から始める
  savedAt: string;                // ISO 8601
  dataset: Dataset;
  view: { filter: FilterState; view: ViewState };
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
| `core-model` | データモデル、フィルタ、時間、グラフ構築、射影、見た目への割り当て | `src/core/`（`metrics/` を除く） |
| `graph-algo` | 指標、レイアウト、edge bundling の算法、Worker | `src/workers/`、`src/core/metrics/`、`src/render/bundling/`、`tests/golden/` |
| `renderer` | シーン層、SVG 描画、有向エッジの幾何、図の書き出し | `src/render/`（`bundling/` を除く）、`src/io/export/` の図の部分 |
| `map-geo` | 地図ビュー、時間アニメーション、地図の書き出し | `src/map/` |
| `ui` | React の画面、状態管理、読み込みウィザード、多言語対応 | `src/views/`、`src/state/`、`src/app/`、`src/i18n/` |
| `io` | 各形式の読み込みと書き出し（図以外）、プロジェクトファイル | `src/io/`（図の書き出しを除く） |
| `qa-tester` | 単体テスト、E2E、回帰テスト、CI | `tests/`、各所の `*.test.ts`、`.github/workflows/` |
| `reviewer` | 型、層の境界、コメント規約、旧版の不具合の再発を確認（書き込まない） | なし |

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
