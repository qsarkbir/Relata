import { TEXT_DIRECTION, isLocale, pickLocale } from '../i18n';
import type { Locale } from '../i18n';

const STORAGE_KEY = 'relata.locale';

/**
 * 利用者が選んだ言語を読む。保存が使えない、値が不正なときは undefined。
 *
 * @returns 保存した言語、または undefined
 */
export function readSavedLocale(): Locale | undefined {
  // 【なぜ】プライベートモードや設定によっては localStorage に触れただけで例外になる。使えなくても動かす。
  try {
    // 【TS】`unknown` で受け、`isLocale`（型ガード）で Locale に絞り込む。保存された値は信用できないため。
    const v: unknown = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 言語の選択を保存する。失敗しても無視する。
 *
 * @param locale - 保存する言語
 */
export function saveLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 保存できなくても、この回の表示には影響しない。
  }
}

/**
 * 起動時の言語を決める（D-25）。利用者が選んだ値、無ければブラウザの言語。
 *
 * @returns 言語
 */
export function resolveInitialLocale(): Locale {
  return readSavedLocale() ?? pickLocale(navigator.languages);
}

/**
 * `<html lang dir>` を言語に合わせる。
 *
 * @param locale - 表示言語
 */
// 【なぜ】向きは i18n の `TEXT_DIRECTION` から引く。右から左の言語を足すときは、その表に足すだけでよい。
export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = TEXT_DIRECTION[locale];
}
