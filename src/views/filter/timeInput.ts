/**
 * 時間フィルタの文字入力と FilterDef の間の変換（FR-FL-03、FR-TM-09）。
 *
 * 日付の読み取りと暦の換算は `core/time` の関数に任せる。ここは「空の端を開いたままにする」
 * 「適用中の値を欄に戻す」という、入力欄のための取り回しだけを行う。
 */
import type { TimeSource } from '../../core/filter';
import type { CalendarId } from '../../core/model';
import { jdnToParts, parseTimeFilterInput } from '../../core/time';
import type { TimeFilterInputFailureCode } from '../../core/time';

/** 入力を読むときの選択肢。 */
// 【なぜ】ヒジュラ暦の「年月日」は、既定では前後 2 日の幅を持つ（観測による暦のずれを見込む）。
//   それはデータの日付の読み取りの話で、絞り込みの範囲の端は利用者が書いた日そのものにしたい。
const INPUT_OPTIONS = { hijriDayMargin: 0 } as const;

/** 入力を適用できなかった理由。`field` はどちらの欄か。 */
export interface TimeInputError {
  readonly code: TimeFilterInputFailureCode;
  readonly field?: 'start' | 'end';
}

/** 入力の判定の結果。 */
// 【TS】`kind` で分かれる判別共用体。`apply` のときだけ from と to を持つ。
export type TimeInputOutcome =
  | { readonly kind: 'apply'; readonly from?: number; readonly to?: number }
  | { readonly kind: 'clear' }
  | { readonly kind: 'error'; readonly error: TimeInputError };

/**
 * 開始と終了の文字を、フィルタの範囲（JDN の両端）にする。
 *
 * - 両方が空: 適用中の条件があれば解除（`clear`）、無ければエラー。
 * - 片方が空: その端は開いたまま（結果に含めない）。データの範囲で埋めない。
 *   出どころを替えても、前の出どころの範囲が残らないようにするため。
 *
 * @param start - 開始の文字
 * @param end - 終了の文字
 * @param calendar - 印のない入力を読む暦
 * @param hasActive - 適用中の時間フィルタがあるか
 * @returns 適用する範囲、解除、またはエラー
 */
export function resolveTimeInput(
  start: string,
  end: string,
  calendar: CalendarId,
  hasActive: boolean,
): TimeInputOutcome {
  const r = parseTimeFilterInput(start, end, calendar, INPUT_OPTIONS);
  if (!r.ok) {
    if (r.reason.code === 'both-empty' && hasActive) return { kind: 'clear' };
    return {
      kind: 'error',
      error: {
        code: r.reason.code,
        ...(r.reason.field === undefined ? {} : { field: r.reason.field }),
      },
    };
  }
  return {
    kind: 'apply',
    ...(r.from === undefined ? {} : { from: r.from }),
    ...(r.to === undefined ? {} : { to: r.to }),
  };
}

/**
 * 適用中の端（JDN）を、入力欄に入れる文字にする。
 *
 * 年の初日（終了なら末日）なら「1500」、月の初日・末日なら「1500-03」のように短く書き、
 * 読み戻して同じ JDN になる最も短い形を選ぶ。合わなければ暦の印つきの形、それも合わなければ年月日。
 *
 * 【なぜ】読み戻して確かめる（`parseTimeFilterInput` を通す）。月の長さやヒジュラ暦の月の長さを
 * ここで計算し直さず、解析と同じ規則に任せる。
 *
 * @param jdn - 端の JDN
 * @param calendar - 表す暦
 * @param side - 開始か終了か
 * @returns 欄の文字
 */
export function formatTimeInput(jdn: number, calendar: CalendarId, side: 'start' | 'end'): string {
  const p = jdnToParts(jdn, calendar, 'day');
  const mm = String(p.month ?? 1).padStart(2, '0');
  const dd = String(p.day ?? 1).padStart(2, '0');
  const y = String(p.year);
  // 【歴史の事情】0 年以前の印は暦で違う。西暦は BC（紀元前）、ヒジュラ暦は BH（ヒジュラ以前。ヒジュラ暦を
  //   1 年より前へ延ばした外挿）。取り違えると約 622 年ずれる。月日つきの紀元前は、月・日を 0 付き 2 桁で書く。
  const suffix = p.era === 'before' ? (calendar === 'hijri' ? ' BH' : ' BC') : '';
  const candidates = [`${y}${suffix}`, `${y}-${mm}${suffix}`, `${y}-${mm}-${dd}${suffix}`];
  // 暦の印つき（読み戻しの最後の手段）。印のない入力の暦と食い違っても、印が優先される。
  const mark = calendar === 'hijri' ? ' AH' : ' CE';
  if (p.era === 'common') candidates.push(`${y}-${mm}-${dd}${mark}`);
  for (const text of candidates) {
    const back =
      side === 'start'
        ? parseTimeFilterInput(text, '', calendar, INPUT_OPTIONS)
        : parseTimeFilterInput('', text, calendar, INPUT_OPTIONS);
    if (back.ok && (side === 'start' ? back.from : back.to) === jdn) return text;
  }
  return candidates[2] ?? y;
}

/**
 * 日付の出どころを、選択欄の値の文字にする。
 *
 * @param source - 出どころ
 * @returns `span` または `attr:<属性のキー>`
 */
export function sourceToValue(source: TimeSource): string {
  return source.kind === 'span' ? 'span' : `attr:${source.attr}`;
}

/**
 * 選択欄の値を、出どころに戻す。
 *
 * @param value - `sourceToValue` の結果
 * @returns 出どころ
 */
export function valueToSource(value: string): TimeSource {
  return value.startsWith('attr:') ? { kind: 'attr', attr: value.slice(5) } : { kind: 'span' };
}
