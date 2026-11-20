import type { AttrValue, CalendarId, FuzzyDate, Scalar, ValueType } from '../../core/model';
import { parseDate } from '../../core/time';
import { compileMissingTokens, matchMissingToken } from '../project/missing';
import type { MissingToken } from '../project/types';

/** 列の型と、複数値・暦の利用者による指定。 */
export interface ColumnOptions {
  readonly type: ValueType;
  readonly calendar?: CalendarId;
  readonly separator?: string;
  readonly missingTokens?: readonly MissingToken[];
}

/** セルの変換結果。失敗時も原文を残し、利用者が修正できるようにする。 */
export interface CellResult {
  readonly value: AttrValue;
  readonly warnings: readonly string[];
  readonly ok: boolean;
}

function numberValue(text: string): number | undefined {
  // 空文字、16 進数、Infinity などを意図せず数値にしない。
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * セルを指定した列の型で読み、欠損の理由と日付の幅を保つ。
 * @param text - セルの原文
 * @param options - 利用者が指定した列の設定
 * @returns 値と警告。型に合わない場合は原文と ok=false
 */
export function convertCell(text: string, options: ColumnOptions): CellResult {
  const tokens = compileMissingTokens(options.missingTokens ?? []);
  if (tokens.problems.length > 0) throw new RangeError('欠損の記号に空欄または重複があります。');
  if (options.separator === '') throw new RangeError('複数値の区切りは空にできません。');
  const reason = matchMissingToken(text, tokens);
  if (reason !== undefined) return { ok: true, value: { kind: 'missing', reason }, warnings: [] };
  const pieces = options.separator === undefined ? [text] : text.split(options.separator);
  const scalars: Scalar[] = [];
  const dates: FuzzyDate[] = [];
  const warnings: string[] = [];
  const invalid = (): CellResult => ({
    ok: false,
    value: { kind: 'value', value: text },
    warnings: ['指定した列の型に変換できません。原文を保持しました。'],
  });
  for (const piece of pieces) {
    // 【なぜ】複数値の途中の欠損を削ると、史料の情報を失う。セル全体を修正対象として残す。
    if (matchMissingToken(piece, tokens) !== undefined) return invalid();
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
    value: { kind: 'value', value: options.separator === undefined ? first : scalars },
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
    if (values.every((c) => convertCell(c, { type }).ok)) return type;
  }
  return 'string';
}
