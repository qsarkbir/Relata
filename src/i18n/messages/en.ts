import type { MessageKey } from './ja';

/**
 * 英語の辞書。日本語の辞書と同じキーをすべて持つ。
 */
// 【TS】`satisfies` は「この型の条件を満たすか」を検査しつつ、値の型は推論のまま残す演算子。
//       `Record<MessageKey, string>` は「キーが MessageKey のすべてで、値が文字列」の型。
//       キーが足りなければ訳し漏れ、余分なら打ち間違いとして、どちらも型エラーになる。
// 【なぜ】型注釈（`: Record<...>`）ではなく `satisfies` を使うのは、検査だけを行い、型を広げないため。
export const en = {
  'app.title': 'Relata',
  'app.documentTitle': 'Relata',
  'app.underConstruction': 'Coming soon.',
} satisfies Record<MessageKey, string>;
