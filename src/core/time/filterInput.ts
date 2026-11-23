/**
 * 時間フィルタの入力の解析（FR-FL-03、FR-TM-09）。
 *
 * 左のパネルの「時間」で、利用者が開始と終了を文字で入れる。読み方は日付の解析（`parseDate`）と
 * 同じなので、`1500`、`1500-03`、`1500-03-15`、`905 AH`、`905هـ`、`c.1500`、`44 BC` などを受ける。
 * 年だけならその年の初日から末日まで、年月ならその月の初日から末日までになる。
 *
 * 【なぜ】開始は「幅の最も早い日」、終了は「幅の最も遅い日」を採る。`1500` から `1510` なら
 * 1500-01-01 から 1510-12-31 で、利用者が直感する「1500 年から 1510 年まで」と一致する。
 */
import type { CalendarId, DayNumber } from '../model';
import { parseDate, type DateFailure, type DateFailureCode } from './parse';
import type { ParseDateOptions } from './parse';

/** 時間フィルタの入力の失敗の種類。日付の解析の失敗に、入力全体の失敗が加わる。 */
export type TimeFilterInputFailureCode =
  | DateFailureCode
  | 'both-empty' // 開始も終了も空
  | 'filter-reversed'; // 終了が開始より前

/** 時間フィルタの入力の失敗。`field` はどちらの入力か（全体の失敗では省略）。 */
export interface TimeFilterInputFailure {
  readonly code: TimeFilterInputFailureCode;
  /** 利用者に見せる説明（日本語。i18n 側は `code` から自前の文言を作ってよい） */
  readonly message: string;
  readonly field?: 'start' | 'end';
}

/**
 * 時間フィルタの入力の解析結果。
 *
 * `from`、`to` は、入力が空の側だけ `undefined`（開いた端。呼び出し側がデータの範囲などで埋める）。
 */
// 【TS】`ok` で分かれる判別共用体。`if (r.ok)` の中では from と to が使え、else では reason が使える。
export type TimeFilterInputResult =
  | {
      readonly ok: true;
      readonly from: DayNumber | undefined;
      readonly to: DayNumber | undefined;
    }
  | { readonly ok: false; readonly reason: TimeFilterInputFailure };

/**
 * 開始と終了の文字を、JDN の範囲にする。例外は投げない。
 *
 * @param startText - 開始の文字（空なら開始なし）
 * @param endText - 終了の文字（空なら終了なし）
 * @param calendar - 暦の印がない入力を読む暦（既定は西暦。`inputCalendarOf(display)` を渡す）
 * @param options - 「頃」の幅など（`parseDate` と同じ。`calendar` は無視される）
 * @returns 成功なら from と to。失敗なら理由
 *
 * @example
 * ```ts
 * parseTimeFilterInput('1500', '1510'); // { ok: true, from: 1500-01-01 の JDN, to: 1510-12-31 の JDN }
 * parseTimeFilterInput('905', '', 'hijri'); // 905 AH の初日から。to は undefined
 * parseTimeFilterInput('1500-13', ''); // { ok: false, reason: { code: 'invalid-month', field: 'start', … } }
 * ```
 */
export function parseTimeFilterInput(
  startText: string,
  endText: string,
  calendar: CalendarId = 'gregorian',
  options: Omit<ParseDateOptions, 'calendar'> = {},
): TimeFilterInputResult {
  const opts: ParseDateOptions = { ...options, calendar };
  const startEmpty = startText.trim() === '';
  const endEmpty = endText.trim() === '';
  if (startEmpty && endEmpty) {
    return {
      ok: false,
      reason: { code: 'both-empty', message: '開始か終了のどちらかを入力してください' },
    };
  }
  let from: DayNumber | undefined;
  let to: DayNumber | undefined;
  if (!startEmpty) {
    const r = parseDate(startText, opts);
    if (!r.ok) return { ok: false, reason: withField(r.reason, 'start') };
    from = r.value.earliest;
  }
  if (!endEmpty) {
    const r = parseDate(endText, opts);
    if (!r.ok) return { ok: false, reason: withField(r.reason, 'end') };
    to = r.value.latest;
  }
  if (from !== undefined && to !== undefined && to < from) {
    return {
      ok: false,
      reason: { code: 'filter-reversed', message: '終了が開始より前です', field: 'end' },
    };
  }
  return { ok: true, from, to };
}

function withField(reason: DateFailure, field: 'start' | 'end'): TimeFilterInputFailure {
  return { code: reason.code, message: reason.message, field };
}
