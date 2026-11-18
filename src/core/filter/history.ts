/**
 * フィルタ操作の Undo / Redo（FR-FL-10、設計書 §6.3）。
 *
 * 履歴は「過去の値の配列」「現在の値」「やり直しの値の配列」を持つ不変の値。
 * 操作のたびに新しい履歴を返し、元の履歴は書き換えない。
 */
import type { FilterState } from './types';

/** 元に戻せる回数の上限。 */
export const HISTORY_LIMIT = 100;

/** フィルタ状態の履歴。 */
export interface FilterHistory {
  /** 過去の状態。古い順（末尾が直前）。 */
  readonly past: readonly FilterState[];
  readonly present: FilterState;
  /** やり直せる状態。直近に戻した順（先頭が次に進む状態）。 */
  readonly future: readonly FilterState[];
}

/**
 * 履歴を作る。
 *
 * @param initial - 最初の状態
 * @returns 過去もやり直しも空の履歴
 */
export function createHistory(initial: FilterState): FilterHistory {
  return { past: [], present: initial, future: [] };
}

/**
 * 新しい状態を履歴に積む。やり直しの履歴は捨てる。
 *
 * 現在と同じ値（参照が同じ）なら、何も変えずに履歴をそのまま返す
 * （変化の無い操作で、元に戻す手順を増やさないため）。
 * 過去が上限 {@link HISTORY_LIMIT} を超えたら、いちばん古いものを捨てる。
 *
 * @param history - 元の履歴
 * @param next - 新しい状態
 * @returns 新しい履歴
 */
export function pushHistory(history: FilterHistory, next: FilterState): FilterHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

/**
 * 元に戻せるか。
 *
 * @param history - 履歴
 * @returns 過去があれば true
 */
export function canUndo(history: FilterHistory): boolean {
  return history.past.length > 0;
}

/**
 * やり直せるか。
 *
 * @param history - 履歴
 * @returns やり直しの状態があれば true
 */
export function canRedo(history: FilterHistory): boolean {
  return history.future.length > 0;
}

/**
 * 1 つ前の状態に戻す。
 *
 * @param history - 元の履歴
 * @returns 戻した履歴。戻せなければ元の履歴をそのまま返す
 */
export function undoHistory(history: FilterHistory): FilterHistory {
  // 【TS】`.at(-1)` は末尾の要素（負の数は後ろから数える）。空なら undefined なので、型は
  //       `FilterState | undefined`。下の検査で undefined を除くと、以降は FilterState になる。
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

/**
 * 戻した操作をやり直す。
 *
 * @param history - 元の履歴
 * @returns 進めた履歴。やり直せなければ元の履歴をそのまま返す
 */
export function redoHistory(history: FilterHistory): FilterHistory {
  // 【TS】残りの分割代入。`next` は先頭の 1 つ、`rest` は残りの配列（元の配列は変えない）。
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
