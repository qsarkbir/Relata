import { jdnToGregorian } from '../../core/time';
import type { Translate } from './labels';

/**
 * 時間フィルタのJDN両端を、グレゴリオ暦の日付で説明する（FR-FL-08）。
 *
 * 【なぜ】内部値は暦に依存しないJDNを維持し、一覧と解除ボタンの説明だけを変える。
 * JS Dateを使わないので紀元前やタイムゾーンの差も扱える。
 * @param t - 現在の言語の翻訳
 * @param from - 始点のJDN
 * @param to - 終点のJDN
 * @returns 紀元前も明記した期間の説明
 */
export function timeText(t: Translate, from: number, to: number): string {
  const dayText = (day: number): string => {
    const date = jdnToGregorian(day);
    return t(date.year > 0 ? 'filter.date.ce' : 'filter.date.bce', {
      year: String(date.year > 0 ? date.year : 1 - date.year),
      month: String(date.month).padStart(2, '0'),
      day: String(date.day).padStart(2, '0'),
    });
  };
  return t('filter.summary.time', { from: dayText(from), to: dayText(to) });
}
