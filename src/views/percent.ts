/** 割合の書式（言語ごとに 1 つだけ作って使い回す。`Intl.NumberFormat` は作るのに時間がかかるため）。 */
const percentFormats = new Map<string, Intl.NumberFormat>();

/**
 * 割合（0〜1）を、言語に合わせた百分率の文字列にする（小数 1 桁まで）。
 *
 * @param locale - 表示の言語
 * @param rate - 割合
 * @returns 例: 「26.7%」
 */
export function formatPercent(locale: string, rate: number): string {
  let f = percentFormats.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    percentFormats.set(locale, f);
  }
  return f.format(rate);
}
