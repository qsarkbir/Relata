import { createStore } from 'zustand/vanilla';
import { DEFAULT_CALENDAR_DISPLAY } from '../core/time';
import type { CalendarDisplay } from '../core/time';

/**
 * 全ビューに共通の表示設定（R-24、D-45）。プロジェクトの `view.display` に保存する。
 *
 * 内部の日付（JDN）は変えない。表示だけを変える軽い設定なので、変えたらすぐ反映する。
 */
export interface DisplayState {
  /** 表示する暦。適用中のフィルタの説明、時間の欄、選択中のカードなどが読む。 */
  readonly calendar: CalendarDisplay;
  /**
   * 表示する暦を変える。
   *
   * @param calendar - 新しい暦の選択
   */
  readonly setCalendar: (calendar: CalendarDisplay) => void;
}

/**
 * 表示設定のストアを作る。
 *
 * @param initial - 最初の暦（既定は西暦）
 * @returns Zustand のストア
 */
export function createDisplayStore(initial: CalendarDisplay = DEFAULT_CALENDAR_DISPLAY) {
  return createStore<DisplayState>()((set) => ({
    calendar: initial,
    setCalendar: (calendar) => {
      set((s) => (s.calendar === calendar ? s : { calendar }));
    },
  }));
}

/** アプリ全体の表示設定。 */
export const displayStore = createDisplayStore();
