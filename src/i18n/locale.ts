/**
 * 対応する言語の一覧。
 *
 * 言語を増やすときは、ここに足す。`Locale` 型は一覧から導き出すので、型を別に直す必要はない。
 */
// 【TS】`as const` を付けると、配列が `string[]` ではなく `readonly ['ja', 'en']`（読み取り専用の
//       タプルで、要素は文字列リテラル型）になる。値の一覧と型を 1 か所から作れる。
export const LOCALES = ['ja', 'en'] as const;

/**
 * 表示言語。`'ja'`（日本語）か `'en'`（英語）。
 */
// 【TS】`(typeof LOCALES)[number]` は「配列の要素の型の和集合」。ここでは `'ja' | 'en'` になる。
export type Locale = (typeof LOCALES)[number];

/**
 * 既定の言語。日本語の辞書を正とし、言語を決める材料が何も無いときに使う（設計書 D-15）。
 */
export const DEFAULT_LOCALE: Locale = 'ja';

/**
 * 未対応の言語のときに使う言語（設計書 D-16）。
 *
 * ブラウザの言語の一覧が空でなく、どれも ja にも en にも当たらないときの値。
 */
// 【なぜ】既定の言語（ja）とは分ける。主な利用者は西アジア史の研究者で、ブラウザの言語が
//       ar、fa、tr、de などの人も多い。そうした人には、日本語より英語のほうが読める見込みが高い。
export const FALLBACK_LOCALE: Locale = 'en';

/**
 * 外から来た値が `Locale` かどうかを調べる。
 *
 * 保存したプロジェクトファイルや設定など、型が保証されない値を検査するために使う。
 *
 * @param value - 検査する値
 * @returns `Locale` なら true
 * @example
 * isLocale('en'); // true
 * isLocale('fr'); // false
 */
// 【TS】外から来る値は `unknown`（何でもありうる型）で受け、型ガードで絞り込む。
//       `value is Locale` と書くと、true を返した分岐で value が Locale として扱われる。
export function isLocale(value: unknown): value is Locale {
  // 【なぜ】`as` で型を偽らず、一覧に含まれるかを実行時に確かめる。
  //       `some` と `===` を使うのは、`includes` だと引数が `Locale` に限られて unknown を渡せないため。
  return typeof value === 'string' && LOCALES.some((l) => l === value);
}

/**
 * ブラウザの言語の一覧から、対応する言語を選ぶ。
 *
 * 先頭から順に見て、最初に対応する言語に当たったものを返す。
 * 言語タグは大文字小文字を区別せず、地域の部分（`en-US` の `US`）は無視する。
 *
 * @param preferred - 優先順の言語タグ。呼ぶ側が `navigator.languages` を渡す
 * @returns 選ばれた言語。一覧が空なら `DEFAULT_LOCALE`、空でないのにどれにも当たらなければ `FALLBACK_LOCALE`
 * @example
 * pickLocale(['en-US', 'ja']); // 'en'
 * pickLocale(['ar', 'fa']); // 'en'（FALLBACK_LOCALE）
 * pickLocale([]); // 'ja'（DEFAULT_LOCALE）
 */
// 【なぜ】`navigator` をここで読まず、引数で受ける。i18n を DOM に依存させないため（render や
//       テストからも使える）。
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    // 言語タグは `-` の前が主言語（BCP 47）。`en-GB` → `en`。
    const primary = tag.toLowerCase().split('-')[0];
    const found = LOCALES.find((l) => l === primary);
    if (found !== undefined) return found;
  }
  // 【なぜ】空の配列は「材料が無い」のでDEFAULT_LOCALE、材料はあるが未対応なら FALLBACK_LOCALE（D-16）。
  return preferred.length === 0 ? DEFAULT_LOCALE : FALLBACK_LOCALE;
}
