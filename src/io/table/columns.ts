import type { AttrValue, CalendarId, FuzzyDate, Scalar, ValueType } from '../../core/model';
import { parseDate } from '../../core/time';
import { compileMissingTokens, EDGE_JUNK, matchMissingToken } from '../project/missing';
import type { CompiledMissingTokens } from '../project/missing';
import type { ColumnRef, MissingToken } from '../project/types';

const TRAILING_JUNK_RE = new RegExp(`[${EDGE_JUNK}]+$`, 'u');
const TRAILING_MARKS_RE = /[?\uFF1F\u061F]+$/u;

/** 列の型と、複数値・暦の利用者による指定。 */
export interface ColumnOptions {
  readonly type: ValueType;
  readonly calendar?: CalendarId;
  readonly separator?: string;
  readonly missingTokens?: readonly MissingToken[];
  /**
   * 値の末尾の `?`（1 個以上）を外し、値に `certainty: 'possible'` を付ける（D-37、FR-DM-06）。既定は無効。
   * 日付の型には効かない（日付の解析が `?` を自分で扱うため）。
   * 【なぜ】原文が変わる（`Basra?` → `Basra`）ので、列ごとの選択にする。複数値のセルでは、
   * どれかの要素に `?` があれば値全体を `possible` にする（確からしさは 1 つの AttrValue に 1 つだけ持てるため）。
   */
  readonly possibleSuffix?: boolean;
}

/** セルの変換結果。失敗時も原文を残し、利用者が修正できるようにする。 */
export interface CellResult {
  readonly value: AttrValue;
  readonly warnings: readonly string[];
  readonly ok: boolean;
}

function numberValue(text: string): number | undefined {
  const trimmed = text.trim();
  // 空文字、16 進数、Infinity などを意図せず数値にしない。
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * セルを指定した列の型で読み、欠損の理由と日付の幅を保つ。
 * @param text - セルの原文
 * @param options - 利用者が指定した列の設定
 * @returns 値と警告。型に合わない場合は原文と ok=false
 */
export function convertCell(text: string, options: ColumnOptions): CellResult {
  return createCellConverter(options)(text);
}

/**
 * 列の設定を一度検査し、欠損記号の照合表を再利用する変換関数を作る。
 * @param options - 同じ列の全セルに使う設定
 * @returns セルの原文を値と警告へ変換する関数
 */
export function createCellConverter(options: ColumnOptions): (text: string) => CellResult {
  const tokens = compileMissingTokens(options.missingTokens ?? []);
  if (tokens.problems.length > 0) throw new RangeError('欠損の記号に空欄または重複があります。');
  if (options.separator === '') throw new RangeError('複数値の区切りは空にできません。');
  return (text) => convertWithTokens(text, options, tokens);
}

function convertWithTokens(
  text: string,
  options: ColumnOptions,
  tokens: CompiledMissingTokens,
): CellResult {
  const reason = matchMissingToken(text, tokens);
  if (reason !== undefined) return { ok: true, value: { kind: 'missing', reason }, warnings: [] };
  const pieces = options.separator === undefined ? [text] : text.split(options.separator);
  const scalars: Scalar[] = [];
  const dates: FuzzyDate[] = [];
  const warnings: string[] = [];
  let possible = false;
  const invalid = (): CellResult => ({
    ok: false,
    value: { kind: 'value', value: text },
    warnings: ['指定した列の型に変換できません。原文を保持しました。'],
  });
  for (let piece of pieces) {
    // 【なぜ】欠損の照合は、`?` を外す前の原文で行う（「?」だけの記号を欠損として登録できるように）。
    // 複数値の途中の欠損を削ると、史料の情報を失う。セル全体を修正対象として残す。
    if (matchMissingToken(piece, tokens) !== undefined) return invalid();
    if (options.possibleSuffix === true && options.type !== 'date') {
      // 【なぜ】末尾の見えない書式文字（RLM など。アラビア文字の表に紛れやすい）を先に除いてから、
      // `?`、全角の `？`、アラビア語の疑問符 `؟` を判定する。
      const tail = piece.replace(TRAILING_JUNK_RE, '');
      const marks = TRAILING_MARKS_RE.exec(tail);
      if (marks !== null) {
        const stripped = tail.slice(0, tail.length - marks[0].length).replace(TRAILING_JUNK_RE, '');
        // 【なぜ】`?` だけの要素（外すと空になる）は、外さず原文のまま読む。空の値を作らないため。
        if (stripped !== '') {
          // 外した値が欠損の記号（「unknown?」「〔欠〕?」）なら、値にせず、その記号の欠損として扱う。
          const strippedReason = matchMissingToken(stripped, tokens);
          if (strippedReason !== undefined)
            return options.separator === undefined
              ? { ok: true, value: { kind: 'missing', reason: strippedReason }, warnings: [] }
              : invalid();
          piece = stripped;
          possible = true;
        }
      }
    }
    switch (options.type) {
      case 'string':
      case 'category':
        scalars.push(piece);
        break;
      case 'number': {
        const value = numberValue(piece);
        if (value === undefined) return invalid();
        scalars.push(value);
        break;
      }
      case 'boolean': {
        const value = piece.trim().toLowerCase();
        if (value !== 'true' && value !== 'false') return invalid();
        scalars.push(value === 'true');
        break;
      }
      case 'date': {
        const result = parseDate(
          piece,
          options.calendar === undefined ? {} : { calendar: options.calendar },
        );
        if (!result.ok) return invalid();
        dates.push(result.value);
        warnings.push(...result.warnings.map((w) => w.message));
        break;
      }
    }
  }
  // 【TS】配列の先頭は undefined の可能性がある。空の入力も上で検査し、ここでも分岐する。
  if (options.type === 'date') {
    const first = dates[0];
    if (first === undefined) return invalid();
    return {
      ok: true,
      value: { kind: 'date', value: options.separator === undefined ? first : dates },
      warnings,
    };
  }
  const first = scalars[0];
  if (first === undefined) return invalid();
  return {
    ok: true,
    value: {
      kind: 'value',
      value: options.separator === undefined ? first : scalars,
      ...(possible && { certainty: 'possible' as const }),
    },
    warnings,
  };
}

/**
 * 欠損を除く全セルに合う型を提案する。年だけの数値は数値を優先し、日付への変更は利用者が行う。
 * @param cells - 列のセル全体
 * @param missingTokens - 欠損を表す記号
 * @returns 提案する列の型。カテゴリは意味の判断が必要なので利用者が指定する
 */
export function inferColumnType(
  cells: readonly string[],
  missingTokens: readonly MissingToken[] = [],
): ValueType {
  const tokens = compileMissingTokens(missingTokens);
  if (tokens.problems.length > 0) throw new RangeError('欠損の記号に空欄または重複があります。');
  const values = cells.filter((c) => matchMissingToken(c, tokens) === undefined);
  if (values.length === 0) return 'string';
  for (const type of ['boolean', 'number', 'date'] as const) {
    if (values.every((c) => convertWithTokens(c, { type }, tokens).ok)) return type;
  }
  return 'string';
}

/**
 * 「末尾の `?` を可能性ありと読む」列の、保存用の指定（`ColumnRef`）を作る（D-37、FR-DM-06）。
 *
 * 【なぜ】保存する形（`ImportSettings.possibleSuffixColumns`）の作り方を、読み戻す `isPossibleSuffixColumn` と
 * 同じこのファイルに置く。両方向が同じ規則（列の key、2 表のときだけ `table`）を使うので、食い違わない。
 * 【注意】列は key（`columnCalendars` と同じ規則）で指す。利用者が key を書き換えた列と、
 * 列名が変わったファイルは、再現の対象外（key が合わなければ無効として読む）。
 *
 * @param column - 列名（列の key）
 * @param table - 2 表のときの、どちらの表の列か。1 表なら省略
 * @returns 保存用の指定
 */
export function toColumnRef(column: string, table?: 'node' | 'edge'): ColumnRef {
  return { column, ...(table !== undefined && { table }) };
}

/**
 * 保存した読み込みの設定（`possibleSuffixColumns`）から、ある列で「末尾の `?` を可能性ありと読む」が
 * 有効かを調べる（D-37、FR-DM-06）。`toColumnRef` で作った指定の逆引き。
 *
 * 列は key で照合する。key を書き換えた列と、列名が変わったファイルは再現の対象外（無効になる）。
 *
 * @param refs - `ImportSettings.possibleSuffixColumns`（無ければ undefined。既定は無効）
 * @param column - 列名（列の key）
 * @param table - 2 表のときの、どちらの表の列か
 * @returns 有効なら true
 */
export function isPossibleSuffixColumn(
  refs: readonly ColumnRef[] | undefined,
  column: string,
  table?: 'node' | 'edge',
): boolean {
  const wanted = toColumnRef(column, table);
  return (refs ?? []).some((ref) => ref.column === wanted.column && ref.table === wanted.table);
}
