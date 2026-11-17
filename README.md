# Relata

[日本語](#日本語) | [English](#english)

---

## 日本語

**Relata**（ラテン語で「関係づけられたもの」）は、歴史研究のためのネットワーク可視化ツールです。表データ（CSV、Excel など）を読み込み、絞り込み、ネットワーク指標を計算し、グラフ・地図・年表・表で見られるようにします。サーバーを持たない静的なブラウザアプリで、**読み込んだデータはブラウザの外に送りません**。

> **開発中です。** 現在はフェーズ 0（開発の土台づくり）の段階で、まだ使える機能はありません。進み具合は [docs/progress.md](docs/progress.md) を見てください。

### Palladio との関係

Relata は、Stanford 大学 Humanities + Design の [Palladio](https://github.com/humanitiesplusdesign/palladio)（BSD-3-Clause）の機能を引き継ぎ、TypeScript で作り直したものです。Palladio の開発者の皆さんに感謝します。Palladio から引き継ぐ主な点と、新たに加える主な点は次のとおりです。

- 引き継ぐ: 表データの読み込み、ファセットと時間による絞り込み、グラフ・地図・表の連動表示、プロジェクトの保存
- 加える: ノードを ID で識別するデータモデル（同名異人の区別）、有向グラフ、k-partite グラフと射影、欠損の可視化、ヒジュラ暦と幅のある年代、アラビア文字の表示と表記の揺れを無視した検索、edge bundling、SVG・PDF の書き出し

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
npm run dev     # 開発サーバーを起動する
npm run build   # dist/ に静的ファイルを出力する
npm run typecheck
npm run lint
```

### ライセンス

[BSD 3-Clause License](LICENSE)。Palladio に由来する部分には、Stanford University の著作権表示が適用されます。

---

## English

**Relata** (Latin for "things related") is a network visualization tool for historical research. It loads tabular data (CSV, Excel, etc.), lets you filter it, computes network metrics, and shows the result as graphs, maps, timelines, and tables. It is a static, serverless browser app: **your data never leaves your browser**.

> **Under development.** The project is in Phase 0 (development groundwork) and has no usable features yet. See [docs/progress.md](docs/progress.md) (in Japanese) for status.

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
