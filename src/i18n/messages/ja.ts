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
  'app.underConstruction': '準備中です。',
} as const;

/**
 * 翻訳キーの型。日本語の辞書のキーから導き出す。
 */
// 【TS】`typeof ja` は値 `ja` の型。`keyof` はそのキーの和集合を作る。
//       辞書にキーを足すと、この型も自動で広がる。
export type MessageKey = keyof typeof ja;
