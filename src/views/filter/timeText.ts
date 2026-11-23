import { HIJRI_MONTH_LABELS } from '../../core/time';
import type { CalendarRendering, DateParts } from '../../core/time';
import type { MessageKey } from '../../i18n';
import type { Translate } from './labels';

// 【TS】`as const` は配列をタプル（長さと中身が固定された並び）として扱わせる。
//       添字 0 が 1 月。キーを MessageKey として並べておけば、辞書に無い月名は型エラーになる。
const GREGORIAN_MONTH_KEYS = [
  'time.gMonth.1',
  'time.gMonth.2',
  'time.gMonth.3',
  'time.gMonth.4',
  'time.gMonth.5',
  'time.gMonth.6',
  'time.gMonth.7',
  'time.gMonth.8',
  'time.gMonth.9',
  'time.gMonth.10',
  'time.gMonth.11',
  'time.gMonth.12',
] as const satisfies readonly MessageKey[];

/**
 * 日付の部品（暦 1 つ分）を、現在の言語の文字にする（FR-TM-09、D-45）。
 *
 * 西暦は「1500年3月15日」「15 Mar 1500」、ヒジュラ暦は「15 Ramaḍān 905 AH」の形。
 * 月名は、ヒジュラ暦なら IJMES 式の転写（`HIJRI_MONTH_LABELS`）、西暦なら辞書から取る。
 *
 * 【歴史の事情】ヒジュラ暦の年は西暦と数え方が違うので、必ず「AH」を付けて取り違えを防ぐ。
 * 0 年以前は、西暦は「紀元前（BCE）」、ヒジュラ暦は「BH」（ヒジュラ以前）と書く。
 *
 * @param t - 現在の言語の翻訳
 * @param p - 日付の部品（`core/time` の `jdnToParts` などの結果）
 * @returns 表記
 */
export function datePartsText(t: Translate, p: DateParts): string {
  const hijri = p.calendar === 'hijri';
  const n = String(p.year);
  const year = t(
    hijri
      ? p.era === 'common'
        ? 'time.h.year.ce'
        : 'time.h.year.bce'
      : p.era === 'common'
        ? 'time.g.year.ce'
        : 'time.g.year.bce',
    { n },
  );
  if (p.month === undefined) return year;
  const monthName = hijri
    ? (HIJRI_MONTH_LABELS[p.month - 1] ?? String(p.month))
    : t(GREGORIAN_MONTH_KEYS[p.month - 1] ?? 'time.gMonth.1');
  if (p.day === undefined) {
    return t(hijri ? 'time.h.month' : 'time.g.month', { year, monthName });
  }
  return t(hijri ? 'time.h.day' : 'time.g.day', { year, monthName, day: String(p.day) });
}

/**
 * 1 つの暦で表した日付または範囲を、文字にする。
 *
 * @param t - 現在の言語の翻訳
 * @param r - 暦 1 つ分の表示（`describeDayRange` の要素）
 * @returns 表記。範囲なら「始点〜終点」
 */
export function renderingText(t: Translate, r: CalendarRendering): string {
  const from = datePartsText(t, r.from);
  if (r.to === undefined) return from;
  return t('time.range', { from, to: datePartsText(t, r.to) });
}

/**
 * 選んだ暦での日付または範囲を、文字にする。
 *
 * 西暦とヒジュラ暦の両方のときは「1500年〜1510年（905 AH〜916 AH）」のように併記する。
 *
 * @param t - 現在の言語の翻訳
 * @param renderings - `describeDayRange` や `describeTimeFilter` の `range`
 * @returns 表記
 */
export function renderingsText(t: Translate, renderings: readonly CalendarRendering[]): string {
  const [first, second] = renderings;
  if (first === undefined) return '';
  const a = renderingText(t, first);
  if (second === undefined) return a;
  return t('time.both', { gregorian: a, hijri: renderingText(t, second) });
}
