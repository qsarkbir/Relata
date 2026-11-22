import { createStore } from 'zustand/vanilla';
import type { Locale, MessageKey, MessageParams } from '../i18n';
import { DEFAULT_LOCALE } from '../i18n';

/**
 * 開いているダイアログの種類。
 *
 * - `about`: このツールについて
 * - `csvExport`: CSV の書き出し
 * - `metricsNotes`: 指標の計算上の注意
 */
export type DialogId = 'about' | 'csvExport' | 'metricsNotes';

/**
 * 処理の名前。翻訳キーと差し込みの値で持つ。
 *
 * 【なぜ】翻訳済みの文字列を持つと、言語を切り替えても進行表示が前の言語のまま残る。
 * キーで持てば、画面が表示するときの言語で翻訳できる。
 */
export interface TaskLabel {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/** 進行中の処理 1 件（FR-UI-03）。 */
// 【TS】interface の `readonly` は「代入できない」印。状態は新しいオブジェクトで置き換える（不変）ので、書き換えの誤りを型で防ぐ。
export interface Task {
  /** `startTask` が採番した ID。 */
  readonly id: number;
  /** 画面に出す名前（翻訳キー）。 */
  readonly label: TaskLabel;
  /** 進み具合（0〜1）。分からないときは undefined で、画面は「不定」の表示にする。 */
  readonly fraction: number | undefined;
  /** 取り消す関数。無い処理は取り消しボタンを出さない。 */
  // 【TS】`(() => void) | undefined` は「引数なしで何も返さない関数、または undefined」。括弧が無いと、関数の戻り値の型の一部と読まれる。
  readonly cancel: (() => void) | undefined;
}

/** uiStore の状態と操作。 */
export interface UiState {
  /** 表示言語。 */
  readonly locale: Locale;
  /** 進行中の処理の一覧（開始順）。 */
  readonly tasks: readonly Task[];
  /** 開いているダイアログ。無ければ null。 */
  readonly openDialog: DialogId | null;
  /** 言語を変える。`localStorage` への保存と `<html lang>` の更新は app 側が `subscribe` で行う。 */
  readonly setLocale: (locale: Locale) => void;
  /**
   * 進行中の処理を登録する。
   *
   * @param label - 画面に出す名前（翻訳キーと差し込みの値）
   * @param cancel - 取り消す関数（任意）
   * @returns 処理の ID
   */
  readonly startTask: (label: TaskLabel, cancel?: () => void) => number;
  /**
   * 進み具合を更新する。未知の ID は無視し、`set` も呼ばない（終わった後に遅れて届く更新があるため。無駄な再描画も避ける）。
   *
   * @param id - `startTask` が返した ID
   * @param fraction - 0〜1 の進み具合。範囲外は丸める。省略または有限でない値（NaN など）は「不定」にする
   */
  readonly updateTask: (id: number, fraction?: number) => void;
  /**
   * 処理を一覧から外す。未知の ID は無視する。
   *
   * @param id - `startTask` が返した ID
   */
  readonly endTask: (id: number) => void;
  /**
   * 処理を取り消す。cancel を呼び、一覧から外す。cancel が無い処理は何もしない。
   *
   * @param id - `startTask` が返した ID
   */
  readonly cancelTask: (id: number) => void;
  /**
   * ダイアログを開く、または閉じる。
   *
   * @param dialog - 開くダイアログ。閉じるときは null
   */
  readonly setOpenDialog: (dialog: DialogId | null) => void;
}

/**
 * uiStore を作る。テストごとに新しいストアを作れるよう、関数にしてある。
 *
 * @param initialLocale - 最初の言語。呼ぶ側（app）が localStorage と navigator から決めて渡す
 * @returns Zustand のストア
 */
// 【なぜ】`zustand/vanilla` を使い、React に依存しない（設計書 §4.1）。React 側は app で `useStore` から読む。
// 【なぜ】一時的な UI 状態だけを持つ。プロジェクトに保存しない（設計書 §10）。
export function createUiStore(initialLocale: Locale = DEFAULT_LOCALE) {
  // 【なぜ】ID はストアごとの連番。Date や乱数に頼らず、テストで予測できる。
  let nextId = 1;
  // 【TS】`createStore<UiState>()(…)` と呼び出しが 2 回続くのは、型引数だけを手で指定し、残りの型は推論に任せるための書き方（カリー化）。
  return createStore<UiState>()((set, get) => ({
    locale: initialLocale,
    tasks: [],
    openDialog: null,
    setLocale: (locale) => {
      set({ locale });
    },
    startTask: (label, cancel) => {
      const id = nextId++;
      set((s) => ({ tasks: [...s.tasks, { id, label, fraction: undefined, cancel }] }));
      return id;
    },
    updateTask: (id, fraction) => {
      // 【なぜ】NaN や Infinity は進み具合として意味が無い。`<progress>` に渡すと例外や表示崩れになるので、不定にする。
      const f =
        fraction === undefined || !Number.isFinite(fraction)
          ? undefined
          : Math.min(1, Math.max(0, fraction));
      if (!get().tasks.some((t) => t.id === id)) return;
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, fraction: f } : t)) }));
    },
    endTask: (id) => {
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    },
    cancelTask: (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (task?.cancel === undefined) return;
      // 【なぜ】先に一覧から外す。cancel が例外を投げても、画面に取り消せない処理が残らない。
      get().endTask(id);
      task.cancel();
    },
    setOpenDialog: (dialog) => {
      set({ openDialog: dialog });
    },
  }));
}

/** アプリ全体で使う uiStore。最初の言語は app の起動時に `setLocale` で入れる。 */
export const uiStore = createUiStore();
