/**
 * 日本語の辞書。これを正とし、英語の辞書は同じキーをすべて持たなければならない（設計書 D-15）。
 */
// 【なぜ】キーは入れ子にせず、`'app.title'` のようなドット区切りの平らな文字列にする。
//       キー全体が 1 つの文字列リテラル型になり、`keyof` だけで `MessageKey` を導き出せる。
//       入れ子だと、パスを連結した型を作る複雑な型が要る。検索（grep）でキーを探しやすい利点もある。
// 【TS】`as const` で、値が `string` ではなく文字列リテラル型になり、オブジェクトも読み取り専用になる。
export const ja = {
  'app.title': 'Relata',
  'app.documentTitle': 'Relata',
  'app.tagline': '歴史研究のためのネットワーク可視化ツール',
  'app.empty.title': 'データがまだ読み込まれていません',
  'app.empty.body':
    '表データ（CSV、Excel など）を読み込むと、ここにグラフや指標が表示されます。読み込みの機能は準備中です。',
  'app.region.filters': '絞り込み',
  'app.region.main': '主な表示',
  'app.region.metrics': '指標',
  'app.region.filters.placeholder': '絞り込みのパネルはここに置きます。',
  'app.region.metrics.placeholder': '指標はここに表示します。',
  'locale.label': '言語',
  'about.open': 'このツールについて',
  'about.title': 'このツールについて',
  'about.close': '閉じる',
  'about.origin':
    'Relata は、Stanford 大学 Humanities + Design の Palladio（BSD-3-Clause）の機能を引き継ぎ、TypeScript で作り直したものです。',
  'about.license':
    'Relata のライセンス: BSD-3-Clause。Palladio に由来する部分には、Stanford University の著作権表示が適用されます。',
  'about.privacy': '読み込んだデータはブラウザの外に送りません。',
  'about.libraries': '使用ライブラリ',
  'about.libraries.name': '名前',
  'about.libraries.license': 'ライセンス',
  'about.palladioLink': 'Palladio のリポジトリ（GitHub）',
  'about.copyright': '著作権表示',
  'about.licenseFull': 'ライセンス全文（BSD 3-Clause）',
  'tasks.started': '「{label}」を開始しました',
  'tasks.finished': '「{label}」が終わりました',
  'tasks.region': '進行中の処理',
  'tasks.cancel': '取り消し',
  'tasks.cancelLabel': '「{label}」を取り消す',
  'tasks.unknownProgress': '処理中',
} as const;

/**
 * 翻訳キーの型。日本語の辞書のキーから導き出す。
 */
// 【TS】`typeof ja` は値 `ja` の型。`keyof` はそのキーの和集合を作る。
//       辞書にキーを足すと、この型も自動で広がる。
export type MessageKey = keyof typeof ja;
