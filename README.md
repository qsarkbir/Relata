# Relata

[日本語](#日本語) | [English](#english)

---

## 日本語

**Relata**（ラテン語で「関係づけられたもの」）は、歴史研究のためのネットワーク可視化ツールです。表データ（CSV、Excel など）を読み込み、絞り込み、ネットワーク指標を計算し、グラフ・地図・年表・表で見られるようにします。サーバーを持たない静的なブラウザアプリで、**読み込んだデータはブラウザの外に送りません**。

> **開発中です（v0.2）。** フェーズ 2（研究機能）までを公開しています。地図と edge bundling はフェーズ 3 で加えます。公開サイトへの反映状況と未完了事項は [進行表](docs/progress.md) と [v0.2 の公開前チェック](docs/release-v0.2.md) を確認してください。

### できること

1. 「表データを読み込む」からCSV/TSV/Excel（xlsx）を選ぶか、CSV/TSVを貼り付けます。差出人・受取人が並ぶ1表と、ノード表・エッジ表の2表に対応します。
2. プレビューで文字コードとシートを確かめ、列の用途・型・暦・複数値の区切り・欠損記号を設定します。警告を確認してから読み込みを確定します。
3. ファセット・数値範囲・検索で絞り込み、グラフと指標を確認します。グラフではレイアウト、サイズ・色・形、向きの表現を選び、検索・拡大・移動・ドラッグ固定ができます。
4. 「書き出し」から、図を SVG・PNG（1・2・4 倍）・PDF で、ネットワークを GraphML・GEXF で、データと指標を CSV で書き出せます。図には凡例と出典表記を入れるかを選べます。PDF は日本語とアラビア文字を正しく出すため文字を輪郭として描くので、PDF の中の文字は検索できません。CSV式保護を有効にして書き出した値は、読み込み時にも保護解除を明示すると元へ戻せます。
5. 「保存」で配置・フィルタ・表示設定を含むRelataプロジェクトを保存します。「プロジェクトを開く」で再開できます。自動保存は同じブラウザ内に残ります。

フェーズ 2（v0.2）で加わった主な機能:

- **k-partite グラフと射影**: 人物と組織のような二部・多部のデータを、人物どうしのネットワークに射影し、つながりの根拠（共通の組織）をたどれます。
- **欠損の可視化**: 属性ごと・時期ごとの欠損率の一覧と、欠損をもつノード・エッジの破線の表示。
- **時間**: 年表（幅のある年代を保った棒グラフ）、年表やパネルでの時間フィルタ、時間の再生（累積・移動窓。再生は表示だけを変え、件数は変えません）。表示する暦を西暦・ヒジュラ暦・併記から選べます。
- **表ビュー**: 下の段にノードとエッジの表。グラフ上の範囲選択と連動します。
- **配置**: 力学モデルに加えて、層状（型ごとの列）と地理座標の配置。
- **確からしさ**: 「確実／おそらく／可能性あり」をノードとエッジに持たせ、絞り込みと書き出しに使えます。

最初は空画面のサンプルから試せます。配置と指標の計算中は進行表示から取り消せます。公開先は [GitHub Pages](https://qsarkbir.github.io/Relata/) です。

地図、edge bundling、旧Palladioファイルの直接読み込みは後続フェーズの対象です。性能測定の条件とブラウザごとの確認状況は、公開前チェックに記録しています。

> **Safari について:** 実機の Safari（Mac、iPhone、iPad）での動作は、まだ確かめていません。v0.1 では Chrome、Edge、Firefox と WebKit（Safari と同じ描画エンジン）での自動テストが通っています。v0.2 の自動テストは Chromium で行いました。

### Palladio との関係

Relata は、Stanford 大学 Humanities + Design の [Palladio](https://github.com/humanitiesplusdesign/palladio)（BSD-3-Clause）の機能を引き継ぎ、TypeScript で作り直したものです。Palladio の開発者の皆さんに感謝します。Palladio から引き継ぐ主な点と、新たに加える主な点は次のとおりです。

- 引き継ぐ: 表データの読み込み、ファセットと時間による絞り込み、グラフ・地図・表の連動表示、プロジェクトの保存
- 加える: ノードを ID で識別するデータモデル（同名異人の区別）、有向グラフ、k-partite グラフと射影、欠損の可視化、ヒジュラ暦と幅のある年代、アラビア文字の表示と表記の揺れを無視した検索、edge bundling、SVG・PNG・PDF の書き出し（日本語とアラビア文字）

### 主な利用者

西アジア史をはじめとする歴史研究者、デジタル・ヒューマニティーズの研究者、授業で使う教員と学生を想定しています。

### 文書

| 文書                                         | 内容                                   |
| -------------------------------------------- | -------------------------------------- |
| [docs/requirements.md](docs/requirements.md) | 要件定義書（何をするか）               |
| [docs/design.md](docs/design.md)             | 設計書・開発計画書（どう作るか）       |
| [docs/progress.md](docs/progress.md)         | 進行表（今どこにいて、次に何をするか） |
| [CLAUDE.md](CLAUDE.md)                       | コーディング規約                       |

### 開発

Node.js 24 系（[.nvmrc](.nvmrc)）が必要です。

```bash
npm ci          # 依存パッケージを入れる
npm run dev     # 開発サーバーを起動する（http://localhost:5173/Relata/ で開く。末尾の /Relata/ が必要）
npm run build   # dist/ に静的ファイルを出力する
npm run typecheck
npm run lint
npm test         # 単体テスト（Vitest）
npm run test:e2e  # E2E テスト（Playwright）
```

### ライセンス

[BSD 3-Clause License](LICENSE)。Palladio に由来する部分には、Stanford University の著作権表示が適用されます。

---

## English

**Relata** (Latin for "things related") is a network visualization tool for historical research. It loads tabular data (CSV, Excel, etc.), lets you filter it, computes network metrics, and shows the result as graphs, maps, timelines, and tables. It is a static, serverless browser app: **your data never leaves your browser**.

> **Under development (v0.2).** Phase 2 (research features) is published. Maps and edge bundling come in Phase 3. See [progress](docs/progress.md) and the [v0.2 release checklist](docs/release-v0.2.md) (in Japanese) for deployment status and remaining checks.

### What you can do

1. Choose **Import tables** to open CSV/TSV/Excel (xlsx), or paste CSV/TSV. Use one relationship table with sender/recipient columns, or separate node and edge tables.
2. Check the encoding and worksheet preview, map columns, and set types, calendars, multiple-value separators and missing tokens. Review warnings before applying the import.
3. Filter by facets, numeric ranges or text. Inspect the graph and metrics, choose layout and appearance, search, zoom, pan, and drag nodes to pin them.
4. Use **Export** to save figures as SVG, PNG (1×, 2×, 4×) or PDF, networks as GraphML or GEXF, and data and metrics as CSV. You can choose whether figures include a legend and a credit line. PDF draws text as outlines so that Japanese and Arabic come out correctly, which means text in the PDF cannot be searched. To restore values protected against spreadsheet formulas, explicitly select formula-protection removal during import.
5. Save a Relata project to preserve positions, filters and display settings, and reopen it with **Open project**. Autosave stays in the same browser.

Main additions in Phase 2 (v0.2):

- **k-partite graphs and projection**: project bipartite or multipartite data, such as people and organizations, onto a network of people, and trace the evidence for each tie (the shared organizations).
- **Missing data**: missing-value rates by attribute and by period, and dashed outlines for nodes and edges with missing values.
- **Time**: a timeline that keeps uncertain date ranges, time filters from the timeline or the panel, and playback (cumulative or moving window; playback changes only the display, not the counts). Show dates in the Gregorian or Hijri calendar, or both.
- **Table view**: node and edge tables in the bottom panel, linked to range selection on the graph.
- **Layouts**: layered (one column per type) and geographic layouts, in addition to the force-directed layout.
- **Certainty**: mark nodes and edges as certain, probable or possible, and use this in filters and exports.

Try the sample on the empty screen. Layout and metric jobs can be cancelled from the progress panel. The deployment URL is [GitHub Pages](https://qsarkbir.github.io/Relata/).

Maps, edge bundling and direct import of legacy Palladio projects belong to later phases. The release checklist records performance measurement conditions and verification status for each browser.

> **About Safari:** Relata has not yet been tested in Safari on a real device (Mac, iPhone, iPad). For v0.1, automated tests passed in Chrome, Edge, Firefox and WebKit, the engine Safari uses. The v0.2 automated tests ran in Chromium.

### Relationship to Palladio

Relata carries over the features of [Palladio](https://github.com/humanitiesplusdesign/palladio) by Humanities + Design, Stanford University (BSD-3-Clause), rebuilt in TypeScript. We are grateful to the Palladio developers.

- Carried over: loading tabular data, facet and time filters, linked graph/map/table views, saving projects
- Added: an ID-based data model (distinguishing people with the same name), directed graphs, k-partite graphs and projection, visualization of missing data, Hijri dates and uncertain date ranges, right-to-left Arabic script display and variant-insensitive search, edge bundling, SVG and PDF export

### Development

Requires Node.js 24 (see [.nvmrc](.nvmrc)).

```bash
npm ci
npm run dev
npm run build
npm run typecheck
npm run lint
```

The design documents and code comments are written in Japanese.

### License

[BSD 3-Clause License](LICENSE). The Stanford University copyright notice applies to the portions derived from Palladio.
