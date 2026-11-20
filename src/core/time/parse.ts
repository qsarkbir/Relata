/**
 * 日付の解析（FR-DM-05、FR-TM-06、FR-IN-05、要件 §6.4、設計書 §5.1、D-29）。
 *
 * 文字列を、幅のある日付 `FuzzyDate` に変える。例外は投げず、結果の `ok` で成功と失敗を区別する。
 * 暦の換算は `calendars/` の関数だけで行い、JavaScript の `Date` は使わない。
 *
 * 手順（入力の長さを n、月名の綴りの数を P として、1 回の解析は O(P·n)。P は定数なので実質 O(n)）:
 * 1. 照合キー（D-20）で、数字（アラビア・インド数字、ペルシア数字）、大文字小文字、
 *    アラビア文字の揺れ、転写の補助記号をそろえる。
 * 2. ヒジュラ暦の月名を、私用領域の文字で挟んだ印に置き換える（月名の中のハイフンを範囲と
 *    取り違えないため。O(P·n)）。
 * 3. 併記・範囲の記号（括弧、`/`、`-`、`–`、`—`、`〜`、`～`）で分ける。
 * 4. 1 つずつ、「頃」「?」「紀元前」「AH」などの印を外し、年・年月・年月日に読む。
 * 5. 暦を決めて JDN の幅にする。併記と範囲は、印の有無から決める（D-29 の補足）。
 *
 * 【歴史の事情】史料の年代は、ヒジュラ暦と西暦の併記、「頃」、紀元前、年だけ・月だけなど、
 * 幅と確からしさを持つ。1 つの数値に潰さず、幅のまま JDN で持つ（D-18）。
 */
import type { CalendarId, Certainty, DayNumber, FuzzyDate, TimeSpan } from '../model';
import { CERTAINTIES } from '../model';
import { matchKey } from '../text';
import { assertNever } from '../util';
import type { CalendarSystem } from './calendars';
import { getCalendar, isValidDate, monthRange, shiftYears, yearRange } from './calendars';
import { MONTH_CLOSE, MONTH_OPEN, replaceHijriMonthNames } from './months';

/** 「頃」の既定の幅（前後の年数）。要件 §6.4。 */
export const DEFAULT_CIRCA_YEARS = 5;
/** ヒジュラ暦の日付の既定の幅（前後の日数）。要件 §6.4。 */
export const DEFAULT_HIJRI_DAY_MARGIN = 2;

/** 解析の選択肢。 */
export interface ParseDateOptions {
  /** 列の暦。印の無い日付をどの暦で読むか。既定は 'gregorian'（FR-IN-05）。 */
  readonly calendar?: CalendarId;
  /** 「頃」の幅（前後の年数）。既定 5。0〜1000 の整数。範囲外なら既定値。 */
  readonly circaYears?: number;
  /** ヒジュラ暦の「年月日」に持たせる幅（前後の日数）。既定 2。観測による暦のずれを見込む。0〜366 の整数。範囲外なら既定値。 */
  readonly hijriDayMargin?: number;
}

/** 解析が失敗した理由の種類。 */
export type DateFailureCode =
  | 'empty' // 空の入力
  | 'unrecognized' // どの書式にも当てはまらない
  | 'invalid-year' // 年が 0 以下、または大きすぎる
  | 'invalid-month' // 月が 1〜12 の外
  | 'invalid-day' // その月に存在しない日
  | 'bc-with-hijri' // 紀元前の印とヒジュラ暦が同時にある
  | 'calendar-conflict' // 月名や印が示す暦が食い違う（ヒジュラ暦の月名に CE など）
  | 'too-many-ranges' // 範囲の記号が 2 つ以上ある
  | 'ambiguous-slash' // `/` の片側が 1〜2 桁、もう片側が 3 桁以上（月/年か範囲か決められない）
  | 'open-range-unsupported' // 「〜1650」のような開いた範囲（今は未対応）
  | 'range-reversed'; // 範囲の左が右より後

/** 解析が失敗した理由。 */
export interface DateFailure {
  readonly code: DateFailureCode;
  /** 利用者に見せる説明（日本語） */
  readonly message: string;
  /** parseTimeSpan だけが付ける。どちらの入力が失敗したか。 */
  readonly field?: 'start' | 'end';
}

/** 警告の種類。 */
export type DateWarningCode =
  | 'parallel-mismatch' // 併記のヒジュラ暦と西暦が重ならない
  | 'parallel-inferred' // 片側だけの印から併記と推測した（確認してほしい）
  | 'span-reversed'; // 期間の終点が始点より前（parseTimeSpan）

/** 警告。値は返すが、利用者に確認してほしい点。 */
export interface DateWarning {
  readonly code: DateWarningCode;
  readonly message: string;
}

/** 解析の成功。 */
export interface DateParseSuccess {
  readonly ok: true;
  readonly value: FuzzyDate;
  readonly warnings: readonly DateWarning[];
}

/** 解析の失敗。 */
export interface DateParseFailure {
  readonly ok: false;
  readonly reason: DateFailure;
  readonly warnings: readonly DateWarning[];
}

/** 解析の結果。 */
// 【TS】`ok` で型が決まる判別共用体。`if (r.ok)` の中では r.value が使え、else では r.reason が使える。
export type DateParseResult = DateParseSuccess | DateParseFailure;

/** parseTimeSpan の成功。 */
export interface TimeSpanParseSuccess {
  readonly ok: true;
  readonly value: TimeSpan;
  readonly warnings: readonly DateWarning[];
}

/** parseTimeSpan の結果。 */
export type TimeSpanParseResult = TimeSpanParseSuccess | DateParseFailure;

// ---------------------------------------------------------------------------
// 内部の型と定数
// ---------------------------------------------------------------------------

type Precision = 'year' | 'month' | 'day';

/** 1 つの日付の「読み」。暦はまだ決めていない。 */
interface Scan {
  readonly precision: Precision;
  readonly year: number;
  /** 年の桁数（`/` の曖昧さの判定に使う） */
  readonly yearDigits: number;
  readonly month: number;
  readonly day: number;
  readonly circa: boolean;
  readonly possible: boolean;
  /** 印（AH、CE、BC など）または月名が示す暦。無ければ undefined。 */
  readonly calendarMark: CalendarId | undefined;
  readonly era: 'bc' | 'ce' | undefined;
}

type ScanResult = { readonly ok: true; readonly scan: Scan } | DateParseFailure;

/** 暦を決めて JDN の幅にした日付。 */
interface Resolved {
  readonly earliest: DayNumber;
  readonly latest: DayNumber;
  readonly certainty: Certainty;
  readonly calendar: CalendarId;
}

type ResolveResult = { readonly ok: true; readonly resolved: Resolved } | DateParseFailure;

/** 併記の括弧の印（私用領域の文字。利用者の入力と衝突しない）。 */
const PAREN = '';
/** 日本語の年月日（1650年3月15日）を内部の `1650<JOIN>3<JOIN>15` にするときの区切り。 */
const JOIN = '';
/** 常に範囲の記号（em ダッシュ、`〜`、`～`）。 */
const EM = '—';
/** 略記つきの範囲の記号（en ダッシュ。`1640–41`）。 */
const EN = '–';

/** 年の桁数の上限。JDN が安全な整数に収まり、暦の算法が正確に動く範囲。 */
const MAX_YEAR_DIGITS = 6;
/** 「頃」の幅の上限（年）と、ヒジュラ暦の日の幅の上限（日）。誤った設定で巨大な幅ができるのを防ぐ。 */
const MAX_CIRCA_YEARS = 1000;
const MAX_HIJRI_DAY_MARGIN = 366;

/**
 * 失敗の結果を作る。
 *
 * @param code - 失敗の種類
 * @param message - 利用者向けの説明
 * @returns 失敗の結果
 */
function fail(code: DateFailureCode, message: string): DateParseFailure {
  return { ok: false, reason: { code, message }, warnings: [] };
}

/**
 * 暦を入れ替える（ヒジュラ暦 ⇔ グレゴリオ暦）。併記の推測に使う。
 *
 * @param c - 暦
 * @returns もう一方の暦
 */
function otherCalendar(c: CalendarId): CalendarId {
  return c === 'hijri' ? 'gregorian' : 'hijri';
}

// ---------------------------------------------------------------------------
// 1〜2. 入力の正規化
// ---------------------------------------------------------------------------

/**
 * 解析の前に、文字をそろえる。
 *
 * 【なぜ】`〜`（U+301C）と `～`（U+FF5E）を、照合キーの前に em ダッシュに置き換える。NFKC が
 * U+FF5E を ASCII の `~`（「頃」の印）に変えてしまい、範囲の記号と区別できなくなるため。
 * 先頭の `〜` と `～` は呼び出し側で先に失敗にしてある（開いた範囲は未対応）。
 *
 * @param label - 利用者が書いた文字列（前後の空白は除いてある）
 * @returns 照合キーにして、記号をそろえた文字列
 */
function normalizeInput(label: string): string {
  // 【なぜ】解析は、私用領域の文字（U+E000〜U+F8FF）を内部の印（月名、括弧の併記など）に使う。
  //       利用者の入力にもともとあると印と取り違えるので、最初に空白に替える。日付の書き方に
  //       私用領域の文字が要ることはない。
  const text = label.replace(/[\uE000-\uF8FF]/gu, ' ');
  // 【なぜ】末尾が括弧のときだけ併記の括弧とみなす（計算量を抑え、途中の括弧は他の書式に任せる）。
  const paren = /[)）]$/u.test(text)
    ? text.replace(/\s*[(（]([^()（）]*)[)）]$/u, ` ${PAREN} $1`)
    : text;
  const key = matchKey(paren.replace(/[〜～]/gu, EM));
  return (
    key
      .replace(/[‐-‒−﹣]/gu, '-')
      .replace(/―/gu, EM)
      .replace(/؟/gu, '?')
      .replace(/،/gu, ',')
      // 年の前の「سنة」（「年」。照合キーで سنه になる）は読み飛ばす。
      .replace(/(?<![؀-ۿ])سنه(?![؀-ۿ])/gu, ' ')
      // 日本語の「1650年3月15日」「1650年3月」。ハイフンにすると、年が 3 桁未満のとき範囲と
      // 取り違えるので、専用の区切りにする。
      .replace(/(\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu, `$1${JOIN}$2${JOIN}$3`)
      .replace(/(\d+)\s*年\s*(\d{1,2})\s*月/gu, `$1${JOIN}$2`)
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// 3. 併記・範囲での分割
// ---------------------------------------------------------------------------

/** 分け方の結果。 */
type SplitResult = { readonly ok: true; readonly parts: readonly string[] } | DateParseFailure;

/**
 * 範囲の記号（`-`、`–`、`—`）で分ける。分けないときは 1 要素の配列。
 *
 * 区切りの規則（D-29）:
 * - em ダッシュ（`—`、`〜`、`～`）と en ダッシュ（`–`）は常に範囲。en ダッシュの右が 1〜2 桁なら、
 *   左の上位の桁を補う略記（`1640–41` ＝ 1640〜1641）。
 * - `-` は、左の年が 3 桁以上で、直後が 1〜2 桁の数字（`1640-12`、`1640-12-31`）なら日付の区切り。
 *   それ以外（右が 3 桁以上、空白を挟む、印が付く、左が 1〜2 桁の `8-10 AH` など）なら範囲。
 *
 * @param s - 月名を印にした、正規化済みの文字列
 * @returns 分けた文字列（1 つか 2 つ）。範囲の記号が多すぎれば失敗
 */
function splitDash(s: string): SplitResult {
  const cuts: { index: number; char: string }[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? '';
    if (ch === EN || ch === EM) {
      cuts.push({ index: i, char: ch });
    } else if (ch === '-') {
      // 日付の区切りは、左が「年（3 桁以上）」か「年-月」で終わり、右が 1〜2 桁の数字のとき。
      // 右の数字のあとに月名が続くとき（`1050-15 Ramadan`）は日ではない。
      const leftIsYear = /\d{3,}(?:-\d{1,2})?$/u.test(s.slice(0, i));
      const rightIsPart = new RegExp(`^\\d{1,2}(?!\\d)(?!\\s*${MONTH_OPEN})`, 'u').test(
        s.slice(i + 1),
      );
      // 【なぜ】年-月-日 の直後に、さらに「-」と 1〜2 桁の数字が続く（`1640-12-3-5`）のは、日付の
      //       区切りが多すぎる書き間違い。範囲と読むと「1640-12-03 から 5 年まで」の逆転した範囲になり、
      //       紀元前の書き方を勧める見当違いの説明が出るので、読めない書式として失敗にする（D-29 補足 (13)）。
      if (rightIsPart && /\d{3,}-\d{1,2}-\d{1,2}$/u.test(s.slice(0, i))) {
        return fail(
          'unrecognized',
          '年-月-日 の後に、さらに「-」と数字が続いています（範囲は「—」か「–」で区切ってください）',
        );
      }
      if (!(leftIsYear && rightIsPart)) cuts.push({ index: i, char: ch });
    }
  }
  const cut = cuts[0];
  if (cut === undefined) return { ok: true, parts: [s] };
  if (cuts.length > 1) return fail('too-many-ranges', '範囲の記号が 2 つ以上あります');
  const left = s.slice(0, cut.index).trim();
  let right = s.slice(cut.index + 1).trim();
  if (cut.char === EN) {
    // 略記: 右が 1〜2 桁の数字なら、左の年の上位の桁を補う。
    const r = /^(\d{1,2})(?!\d)(?!\s*)/u.exec(right);
    const l = /(\d+)(?!.*\d)/u.exec(left);
    if (r?.[1] !== undefined && l?.[1] !== undefined && l[1].length >= 3) {
      right = l[1].slice(0, l[1].length - r[1].length) + r[1] + right.slice(r[1].length);
    }
  }
  return { ok: true, parts: [left, right] };
}

// ---------------------------------------------------------------------------
// 4. 1 つの日付の読み
// ---------------------------------------------------------------------------

/**
 * 前後の印（頃、?、紀元前、AH など）を外して、年・年月・年月日に読む。
 *
 * @param part - 範囲で分けた 1 つの日付（正規化済み）
 * @returns 読み、または失敗
 */
function scanSingle(part: string): ScanResult {
  let s = part.trim();
  if (s === '') {
    return fail(
      'unrecognized',
      '範囲や併記の片方が空です（「〜1650」のような開いた範囲は未対応です）',
    );
  }
  let circa = false;
  let possible = false;
  let era: 'bc' | 'ce' | undefined;
  let hijriMark = false;

  // 末尾の「頃」と「?」（「1050 AH 頃」「1650?」）
  for (;;) {
    if (s.endsWith('頃')) circa = true;
    else if (s.endsWith('?')) possible = true;
    else break;
    s = s.slice(0, -1).trim();
  }

  // 先頭の「頃」（c.、ca.、circa、~）。「ce」の c と取り違えないよう、後ろが空白・数字・印のときだけ。
  const circaPrefix = new RegExp(`^(?:circa|ca|c)\\.?(?=[\\s\\d${MONTH_OPEN}]|$)|^~`, 'u').exec(s);
  if (circaPrefix) {
    circa = true;
    s = s.slice(circaPrefix[0].length).trim();
  }

  // 先頭の紀元前・紀元後・ヒジュラ暦の印
  const lead =
    /^(?:(紀元前|前|bce|bc|b\.c\.)|(紀元後|西暦|ce|ad|a\.d\.|c\.e\.)|(ah|a\.h\.|h|ه)(?=\s*\d))\s*/u.exec(
      s,
    );
  if (lead) {
    if (lead[1] !== undefined) era = 'bc';
    else if (lead[2] !== undefined) era = 'ce';
    else hijriMark = true;
    s = s.slice(lead[0].length).trim();
  }

  // 末尾の「年」と、紀元前・紀元後・ヒジュラ暦の印（H.、ه.ق も）
  s = s.replace(/(\d)\s*年$/u, '$1');
  // 【なぜ】印の後ろの終止符は、0 個か 1 個だけ受け付ける（`A.H.`、`a.h`、`AH.`、`CE.`、`B.C.` は同じ）。
  //       印ごとに終止符の扱いが違うと、`A.H.` は読めて `CE.` は読めない、のような食い違いが出るため。
  //       2 個以上（`H..`）は書き間違いとして失敗。印の前の数字（`(\d)`）は残すので、年の桁は欠けない。
  const tail =
    /(\d)\s*(?:(bce|bc|b\.c\.e|b\.c)|(ce|ad|a\.d|c\.e)|(ah|a\.h|h|ه(?:\.?ق)?))\.?$/u.exec(s);
  if (tail) {
    if (era !== undefined || hijriMark) {
      return fail('unrecognized', '紀元や暦の印が重なっています');
    }
    if (tail[2] !== undefined) era = 'bc';
    else if (tail[3] !== undefined) era = 'ce';
    else hijriMark = true;
    s = s.slice(0, s.length - tail[0].length + 1).trim();
  }

  // 本体: 年、年-月、年-月-日、月名 年、日 月名 年、月名 日 年
  const M = `${MONTH_OPEN}(\\d+)${MONTH_CLOSE}`;
  const sep = `[-${JOIN}]`;
  let yearStr = '';
  let month = 1;
  let day = 1;
  let precision: Precision = 'year';
  let monthName = false;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)$/u.exec(s))) {
    yearStr = m[1] ?? '';
  } else if ((m = new RegExp(`^(\\d+)${sep}(\\d{1,2})$`, 'u').exec(s))) {
    yearStr = m[1] ?? '';
    month = Number(m[2]);
    precision = 'month';
  } else if ((m = new RegExp(`^(\\d+)${sep}(\\d{1,2})${sep}(\\d{1,2})$`, 'u').exec(s))) {
    yearStr = m[1] ?? '';
    month = Number(m[2]);
    day = Number(m[3]);
    precision = 'day';
  } else if ((m = new RegExp(`^${M}\\s*,?\\s*(\\d+)$`, 'u').exec(s))) {
    month = Number(m[1]);
    yearStr = m[2] ?? '';
    precision = 'month';
    monthName = true;
  } else if (
    (m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${M}\\s*,?\\s*(\\d+)$`, 'u').exec(s))
  ) {
    day = Number(m[1]);
    month = Number(m[2]);
    yearStr = m[3] ?? '';
    precision = 'day';
    monthName = true;
  } else if ((m = new RegExp(`^${M}\\s+(\\d{1,2})\\s*,?\\s*(\\d+)$`, 'u').exec(s))) {
    month = Number(m[1]);
    day = Number(m[2]);
    yearStr = m[3] ?? '';
    precision = 'day';
    monthName = true;
  }
  if (yearStr === '') {
    return fail('unrecognized', `日付として読めません: 「${part.trim()}」`);
  }
  if (yearStr.length > MAX_YEAR_DIGITS) {
    return fail('invalid-year', `年が大きすぎます: ${yearStr}`);
  }

  // 暦の印の食い違い
  let calendarMark: CalendarId | undefined;
  if (hijriMark || monthName) calendarMark = 'hijri';
  if (era !== undefined) {
    if (calendarMark === 'hijri') {
      return era === 'bc'
        ? fail('bc-with-hijri', 'ヒジュラ暦に紀元前の印は付けられません')
        : fail('calendar-conflict', 'ヒジュラ暦の印と西暦の印が同じ日付にあります');
    }
    calendarMark = 'gregorian';
  }
  return {
    ok: true,
    scan: {
      precision,
      year: Number(yearStr),
      yearDigits: yearStr.length,
      month,
      day,
      circa,
      possible,
      calendarMark,
      era,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. 暦を決めて JDN の幅にする
// ---------------------------------------------------------------------------

/**
 * 1 つの読みを、暦を決めて JDN の幅にする。
 *
 * 「頃」は前後 n 年。年と月の精度では、ずらした年で範囲を作り直す
 * （n 年前の年初〜n 年後の年末。閏年や月の長さの違いで末日が欠けないように）。
 * 日の精度だけは、同じ月日をずらす。結果は紀元前や、ヒジュラ暦の紀元（1 年）より前に及んでもよい
 * （表示側で扱う）。
 *
 * @param scan - 読み
 * @param calendarId - 使う暦
 * @param bc - 紀元前か
 * @param circaYears - 「頃」の幅（年）
 * @param hijriDayMargin - ヒジュラ暦の日の幅（日）
 * @returns JDN の幅、または失敗
 */
function resolveSingle(
  scan: Scan,
  calendarId: CalendarId,
  bc: boolean,
  circaYears: number,
  hijriDayMargin: number,
): ResolveResult {
  const cal: CalendarSystem = getCalendar(calendarId);
  if (bc && calendarId === 'hijri') {
    return fail('bc-with-hijri', 'ヒジュラ暦に紀元前の印は付けられません');
  }
  if (scan.year < 1) {
    // 【歴史の事情】歴史学の年号に 0 年は無い（紀元前 1 年の次が紀元 1 年）。内部の 0 年
    // （天文学的な数え方）と取り違えないよう、入力の 0 年は受け付けない。
    return fail(
      'invalid-year',
      '年は 1 以上で書きます（紀元前は「BC44」「前44」のように印を付けます）',
    );
  }
  // 【歴史の事情】内部では天文学的な年（紀元前 1 年 ＝ 0 年）。紀元前 n 年 ＝ 1 - n 年。
  const year = bc ? 1 - scan.year : scan.year;
  if (scan.precision !== 'year' && (scan.month < 1 || scan.month > cal.monthsPerYear)) {
    return fail(
      'invalid-month',
      `月は 1〜${String(cal.monthsPerYear)} で書きます: ${String(scan.month)}`,
    );
  }
  if (scan.precision === 'day' && !isValidDate(cal, year, scan.month, scan.day)) {
    return fail('invalid-day', `その月に ${String(scan.day)} 日はありません`);
  }

  // 【なぜ】「頃」を JDN の日数（n × 365 日）ではなく、暦の年数でずらす。ヒジュラ暦の 1 年は
  // 約 354 日で、西暦の日数でずらすと「5 年」の意味がずれるため。
  const n = scan.circa ? circaYears : 0;
  let earliest: DayNumber;
  let latest: DayNumber;
  switch (scan.precision) {
    case 'year':
      earliest = yearRange(cal, year - n).earliest;
      latest = yearRange(cal, year + n).latest;
      break;
    case 'month':
      earliest = monthRange(cal, year - n, scan.month).earliest;
      latest = monthRange(cal, year + n, scan.month).latest;
      break;
    case 'day': {
      const jdn = cal.toJdn(year, scan.month, scan.day);
      earliest = shiftYears(cal, jdn, -n);
      latest = shiftYears(cal, jdn, n);
      // ヒジュラ暦の年月日は、観測による暦のずれを見込んで前後に幅を持たせる（設計書 §5.1）。
      if (calendarId === 'hijri') {
        earliest -= hijriDayMargin;
        latest += hijriDayMargin;
      }
      break;
    }
    default:
      return assertNever(scan.precision, 'Precision');
  }
  const certainty: Certainty = scan.possible ? 'possible' : scan.circa ? 'probable' : 'certain';
  return { ok: true, resolved: { earliest, latest, certainty, calendar: calendarId } };
}

/**
 * 確からしさの弱い方を返す（CERTAINTIES の後ろにあるほど弱い）。
 *
 * @param a - 確からしさ
 * @param b - 確からしさ
 * @returns 弱い方
 */
function weaker(a: Certainty, b: Certainty): Certainty {
  return CERTAINTIES.indexOf(a) >= CERTAINTIES.indexOf(b) ? a : b;
}

/**
 * 選択肢の数値を、使える値にそろえる（負、整数でない値、上限超えは既定に戻す）。例外は投げない。
 *
 * 【なぜ】小数（2.5 年）を切り捨てて通すと、指定と違う幅で黙って計算される。年や日の幅は整数で
 * 指定するものなので、整数でなければ指定が無いのと同じに扱う（D-29 補足 (8)）。
 *
 * @param v - 利用者の指定（省略可）
 * @param max - 上限
 * @param fallback - 既定値
 * @returns 0 以上 max 以下の整数
 */
function boundedInt(v: number | undefined, max: number, fallback: number): number {
  return v !== undefined && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback;
}

/**
 * 片側（1 つか範囲の 2 つの読み）に印が示す暦を調べる。
 *
 * @param scans - 片側の読み
 * @returns 暦（印が無ければ undefined）、または印が食い違う失敗
 */
function sideMark(
  scans: readonly Scan[],
): { readonly ok: true; readonly mark: CalendarId | undefined } | DateParseFailure {
  const marks = scans.map((s) => s.calendarMark);
  // 【TS】配列の分割代入。`noUncheckedIndexedAccess` のため、a と b は undefined の可能性がある型になる。
  const [a, b] = marks;
  if (a !== undefined && b !== undefined && a !== b) {
    return fail('calendar-conflict', '範囲の両端で暦の印が食い違っています');
  }
  return { ok: true, mark: a ?? b };
}

/**
 * 片側（1 つか、範囲の 2 つ）を、同じ暦で JDN の幅にする。範囲では紀元前の印を共有する。
 *
 * @param scans - 片側の読み
 * @param calendarId - 使う暦
 * @param circaYears - 「頃」の幅（年）
 * @param margin - ヒジュラ暦の日の幅（日）
 * @returns JDN の幅、または失敗
 */
function resolveSide(
  scans: readonly Scan[],
  calendarId: CalendarId,
  circaYears: number,
  margin: number,
): ResolveResult {
  const anyBc = scans.some((s) => s.era === 'bc');
  const list: Resolved[] = [];
  for (const s of scans) {
    // 範囲の片方にだけ「BC」があれば、もう片方も紀元前（`44/40 BC`）。
    const bc = s.era === 'bc' || (s.era === undefined && anyBc && calendarId === 'gregorian');
    const r = resolveSingle(s, calendarId, bc, circaYears, margin);
    if (!r.ok) return r;
    list.push(r.resolved);
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (first === undefined || last === undefined) return fail('unrecognized', '日付が空です');
  if (first.earliest > last.latest) {
    return fail(
      'range-reversed',
      '範囲の始まりが終わりより後です（紀元前は「BC44-BC40」のように両方に印を付けます）',
    );
  }
  let certainty = first.certainty;
  for (const r of list) certainty = weaker(certainty, r.certainty);
  return {
    ok: true,
    resolved: { earliest: first.earliest, latest: last.latest, certainty, calendar: calendarId },
  };
}

/**
 * 2 つの幅が重なるか（tolerance 日までの隙間は重なりとみなす）。
 *
 * @param a - 幅
 * @param b - 幅
 * @param tolerance - 許す隙間（日）
 * @returns 重なれば true
 */
function overlaps(a: Resolved, b: Resolved, tolerance: number): boolean {
  return a.earliest - tolerance <= b.latest && b.earliest - tolerance <= a.latest;
}

// ---------------------------------------------------------------------------
// 公開の関数
// ---------------------------------------------------------------------------

/**
 * 日付の文字列を、幅のある日付に解析する（要件 §6.4 の書式すべて）。
 *
 * 例外は投げない。失敗は `ok: false` と理由で返す。`label` には入力（前後の空白を除く）を、
 * `calendar` には元の暦を入れる。範囲では左の暦、併記ではヒジュラ暦になる。
 *
 * 暦の決め方: 印（AH、H、هـ、ه.ق、ヒジュラ暦の月名）があればヒジュラ暦、CE・AD・BC などがあれば
 * グレゴリオ暦、なければ列の暦（`options.calendar`、既定はグレゴリオ暦）。
 *
 * 併記と範囲（D-29 の補足）:
 * - 括弧（`1050 AH (1640 CE)`）は常に併記。
 * - `/` や `-` で、両側に違う暦の印があれば併記（`1050 AH / 1640 CE`）。
 * - 片側だけに印があるとき、印の無い側を「相手と違う暦」で読んで相手と重なれば（前後 1 年まで）
 *   併記とみなし、警告 `parallel-inferred` を付ける（`1050 AH / 1640`）。重ならなければ、
 *   印を共有する同じ暦の範囲（`1050/1060 AH`、`44/40 BC`）。
 * - 併記はヒジュラ暦の値を採り、確からしさは両側の弱い方。西暦と重ならなければ警告する。
 *
 * 「頃」の幅は、紀元前やヒジュラ暦の紀元（1 年）より前に及んでもよい（表示側で扱う）。
 * 「〜1650」のような開いた範囲、「17th century」「1650s」「1650年代」は失敗にする。
 *
 * @param text - 日付の文字列（アラビア・インド数字やペルシア数字も可）
 * @param options - 列の暦、「頃」の幅、ヒジュラ暦の日の幅
 * @returns 成功なら FuzzyDate と警告。失敗なら理由
 *
 * @example
 * ```ts
 * parseDate('1050 AH'); // 1640-04-23〜1641-04-11 に当たる JDN の幅
 * parseDate('15 Ramaḍān 1050'); // 1640-12-29 の前後 2 日
 * parseDate('c.1650'); // 1645-01-01〜1655-12-31、certainty は 'probable'
 * parseDate('1640-12'); // 1640 年 12 月（範囲ではない）
 * parseDate('1640-1660'); // 1640 年から 1660 年の範囲
 * parseDate('前44'); // 紀元前 44 年（内部では -43 年）
 * ```
 */
export function parseDate(text: string, options: ParseDateOptions = {}): DateParseResult {
  const label = text.trim();
  if (label === '') return fail('empty', '日付が空です');
  if (/^[〜～]/u.test(label)) {
    return fail('open-range-unsupported', '「〜1650」のような開いた範囲は今は未対応です');
  }
  const circaYears = boundedInt(options.circaYears, MAX_CIRCA_YEARS, DEFAULT_CIRCA_YEARS);
  const margin = boundedInt(options.hijriDayMargin, MAX_HIJRI_DAY_MARGIN, DEFAULT_HIJRI_DAY_MARGIN);
  const column: CalendarId = options.calendar ?? 'gregorian';

  const normalized = replaceHijriMonthNames(normalizeInput(label));

  // 併記・範囲の分け方: 括弧、スラッシュ、（なければ）ダッシュ。
  let kind: 'single' | 'dash' | 'slash' | 'paren';
  let groupTexts: string[][];
  const parenParts = normalized.split(PAREN);
  const slashParts = normalized.split('/');
  if (parenParts.length > 2) return fail('too-many-ranges', '括弧の併記が 2 つ以上あります');
  if (parenParts.length === 2 || slashParts.length >= 2) {
    const sides = parenParts.length === 2 ? parenParts : slashParts;
    if (sides.length > 2) return fail('too-many-ranges', '範囲の記号（/）が 2 つ以上あります');
    kind = parenParts.length === 2 ? 'paren' : 'slash';
    groupTexts = [];
    for (const side of sides) {
      const sp = splitDash(side.trim());
      if (!sp.ok) return sp;
      groupTexts.push([...sp.parts]);
    }
  } else {
    const sp = splitDash(normalized);
    if (!sp.ok) return sp;
    kind = sp.parts.length === 1 ? 'single' : 'dash';
    groupTexts = sp.parts.map((p) => [p]);
  }

  const groups: Scan[][] = [];
  for (const g of groupTexts) {
    const scans: Scan[] = [];
    for (const p of g) {
      const r = scanSingle(p);
      if (!r.ok) return r;
      scans.push(r.scan);
    }
    groups.push(scans);
  }
  const [sideA, sideB] = groups;
  if (sideA === undefined) return fail('unrecognized', '日付として読めません');

  // 1 つ（または範囲 1 つ）だけ
  if (sideB === undefined) {
    const mk = sideMark(sideA);
    if (!mk.ok) return mk;
    const r = resolveSide(sideA, mk.mark ?? column, circaYears, margin);
    return r.ok ? success(r.resolved, label, []) : r;
  }

  // 2 つの側（併記か範囲）
  const mkA = sideMark(sideA);
  if (!mkA.ok) return mkA;
  const mkB = sideMark(sideB);
  if (!mkB.ok) return mkB;
  const a = mkA.mark;
  const b = mkB.mark;
  const singleA = sideA.length === 1 ? sideA[0] : undefined;
  const singleB = sideB.length === 1 ? sideB[0] : undefined;
  if (
    kind === 'slash' &&
    !(a !== undefined && b !== undefined && a !== b) &&
    singleA?.precision === 'year' &&
    singleB?.precision === 'year' &&
    singleA.yearDigits <= 2 !== singleB.yearDigits <= 2
  ) {
    return fail(
      'ambiguous-slash',
      `「${label}」は、月と年なのか範囲なのか決められません（範囲なら両側を同じ桁数で、日付なら「1650-03」のように書きます）`,
    );
  }

  // 併記の暦の決め方
  let parallelCalendars: { a: CalendarId; b: CalendarId; inferred: boolean } | undefined;
  if (kind === 'paren') {
    const calA = a ?? (b !== undefined ? otherCalendar(b) : column);
    const calB = b ?? otherCalendar(calA);
    if (calA === calB) {
      return fail('calendar-conflict', '併記の両側が同じ暦です（括弧の中は別の暦で書きます）');
    }
    parallelCalendars = { a: calA, b: calB, inferred: false };
  } else if (a !== undefined && b !== undefined) {
    if (a !== b) parallelCalendars = { a, b, inferred: false };
  } else if (a !== undefined || b !== undefined) {
    // 片側だけに印がある。印の無い側を相手と違う暦で読んで、重なれば併記とみなす。
    const calA = a ?? otherCalendar(b ?? column);
    const calB = b ?? otherCalendar(a ?? column);
    const ra = resolveSide(sideA, calA, circaYears, margin);
    const rb = resolveSide(sideB, calB, circaYears, margin);
    if (ra.ok && rb.ok && overlaps(ra.resolved, rb.resolved, 366)) {
      parallelCalendars = { a: calA, b: calB, inferred: true };
    }
  }

  if (parallelCalendars !== undefined) {
    return parallel(sideA, sideB, parallelCalendars, label, circaYears, margin);
  }

  // 範囲。どちらかが範囲のときは、併記でなければ 3 つ以上の端点になるので失敗。
  if (sideA.length > 1 || sideB.length > 1) {
    return fail('too-many-ranges', '範囲の記号が 2 つ以上あります');
  }
  const r = resolveSide([...sideA, ...sideB], a ?? b ?? column, circaYears, margin);
  return r.ok ? success(r.resolved, label, []) : r;
}

/**
 * 併記の処理。ヒジュラ暦の値を採り、確からしさは両側の弱い方。
 *
 * @param sideA - 左側の読み
 * @param sideB - 右側の読み
 * @param cals - 両側の暦と、片側の印から推測したか
 * @param cals.a - 左側の暦
 * @param cals.b - 右側の暦
 * @param cals.inferred - 推測なら true（警告 parallel-inferred）
 * @param label - 元の表記
 * @param circaYears - 「頃」の幅（年）
 * @param margin - ヒジュラ暦の日の幅（日）
 * @returns 解析の結果
 */
function parallel(
  sideA: readonly Scan[],
  sideB: readonly Scan[],
  cals: { readonly a: CalendarId; readonly b: CalendarId; readonly inferred: boolean },
  label: string,
  circaYears: number,
  margin: number,
): DateParseResult {
  const ra = resolveSide(sideA, cals.a, circaYears, margin);
  if (!ra.ok) return ra;
  const rb = resolveSide(sideB, cals.b, circaYears, margin);
  if (!rb.ok) return rb;
  const hijri = ra.resolved.calendar === 'hijri' ? ra.resolved : rb.resolved;
  const other = ra.resolved.calendar === 'hijri' ? rb.resolved : ra.resolved;
  const warnings: DateWarning[] = [];
  if (cals.inferred) {
    warnings.push({
      code: 'parallel-inferred',
      message: `「${label}」は、片側の印から併記と読みました。ヒジュラ暦の値を採りました（範囲なら両側に印を付けてください）`,
    });
  } else if (!overlaps(hijri, other, 0)) {
    warnings.push({
      code: 'parallel-mismatch',
      message: `併記のヒジュラ暦と西暦が重なりません（「${label}」）。ヒジュラ暦の値を採りました`,
    });
  }
  return success(
    { ...hijri, certainty: weaker(hijri.certainty, other.certainty) },
    label,
    warnings,
  );
}

/**
 * 成功の結果を作る。
 *
 * @param r - JDN の幅
 * @param label - 元の表記
 * @param warnings - 警告
 * @returns 成功の結果
 */
function success(r: Resolved, label: string, warnings: readonly DateWarning[]): DateParseSuccess {
  const value: FuzzyDate = {
    earliest: r.earliest,
    latest: r.latest,
    certainty: r.certainty,
    calendar: r.calendar,
    label,
  };
  return { ok: true, value, warnings };
}

/**
 * 始点と終点の 2 つの文字列から、期間（`TimeSpan`）を作る（要件 §6.4「共通」、D-19）。
 *
 * - `endText` が `undefined`（終点の列が無い）: 終点なしの 1 点（または 1 つの幅）。
 * - `endText` が空の文字列（列はあるが値が空）: 終点が `Missing`（終わりが分からない）。
 * - 始点と終点は、それぞれが §6.4 の書式を取れる（「c.1650」から「c.1660」まで）。
 * - 終点の最後の日が始点の最初の日より前なら、`span-reversed` の警告を付ける（値は作る）。
 *
 * 始点が空ならエラー（`empty`）。始点が空の行を「時期の欠損」にするかは、呼び出し側（読み込み）が決める。
 *
 * @param startText - 始点の文字列
 * @param endText - 終点の文字列。列が無ければ省略
 * @param options - parseDate と同じ選択肢
 * @returns 成功なら TimeSpan と警告。失敗なら理由（`field` で始点か終点かを示す）
 */
export function parseTimeSpan(
  startText: string,
  endText?: string,
  options: ParseDateOptions = {},
): TimeSpanParseResult {
  const start = parseDate(startText, options);
  if (!start.ok) return { ...start, reason: { ...start.reason, field: 'start' } };
  if (endText === undefined) {
    return { ok: true, value: { kind: 'span', start: start.value }, warnings: start.warnings };
  }
  if (endText.trim() === '') {
    return {
      ok: true,
      value: { kind: 'span', start: start.value, end: { kind: 'missing', reason: 'unrecorded' } },
      warnings: start.warnings,
    };
  }
  const end = parseDate(endText, options);
  if (!end.ok) return { ...end, reason: { ...end.reason, field: 'end' } };
  const warnings: DateWarning[] = [...start.warnings, ...end.warnings];
  if (end.value.latest < start.value.earliest) {
    warnings.push({
      code: 'span-reversed',
      message: `終点（${end.value.label}）が始点（${start.value.label}）より前です`,
    });
  }
  return { ok: true, value: { kind: 'span', start: start.value, end: end.value }, warnings };
}
