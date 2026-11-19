/**
 * 言語ごとの `Intl` の書式と照合の、使い回し（NFR-04）。
 */
import type { Locale } from '../i18n';

// 【TS】`Map<Locale, Intl.NumberFormat>` は、キーと値の型を決めた辞書。
//       Locale は 'ja' | 'en' などの共用体なので、入る言語は型で限られる。
const numberFormats = new Map<Locale, Intl.NumberFormat>();
const collators = new Map<Locale, Intl.Collator>();

/**
 * 数の書式（`Intl.NumberFormat`）を、言語ごとに 1 つだけ作って返す。
 *
 * 【なぜ】`Intl.NumberFormat` と `Intl.Collator` は作るのに時間がかかる。描画のたびに作ると、
 * ファセットを多く開いてチェックを切り替えるときに、その分だけ遅くなる。
 * 言語は数種類しかないので、モジュールの中に覚えておいても大きくならない。
 *
 * @param locale - 表示の言語
 * @returns 数の書式
 */
export function getNumberFormat(locale: Locale): Intl.NumberFormat {
  let f = numberFormats.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale);
    numberFormats.set(locale, f);
  }
  return f;
}

/**
 * 文字列の照合順（`Intl.Collator`）を、言語ごとに 1 つだけ作って返す。
 *
 * @param locale - 表示の言語
 * @returns 照合順
 */
export function getCollator(locale: Locale): Intl.Collator {
  let c = collators.get(locale);
  if (c === undefined) {
    c = new Intl.Collator(locale);
    collators.set(locale, c);
  }
  return c;
}
