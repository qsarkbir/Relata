import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { DEFAULT_TIMELINE } from '../core/project';
import type { TimelineSettings } from '../core/project';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';

/**
 * 年表の、保存する設定のストア（R-23、D-35、D-42）。
 *
 * 日付の出どころと区切りの幅だけを持つ。ドラッグ中の範囲、カーソルの位置などの一時的な状態は
 * 年表の部品の中に置き、ここには入れない。年表の集計の結果もここには入れない（毎回、絞り込み後の
 * 集合から数え直す）。T2-04（欠損の時期別）も、このストアの設定を読んで同じ区切りで数える。
 */
export interface TimelineViewState {
  readonly timeline: TimelineSettings;
  /**
   * 年表の設定を一部だけ変える。
   *
   * @param change - 変える項目
   */
  readonly patchTimeline: (change: Partial<TimelineSettings>) => void;
  /**
   * 設定を置き換える。省略すると既定に戻る（保存ファイルに項目が無いとき、既定で補うため）。
   *
   * @param next - 新しい設定
   */
  readonly reset: (next?: TimelineSettings) => void;
}

/**
 * 設定が既定と同じ内容かを調べる。
 *
 * 【なぜ】データの置き換えなどで作り直した設定は、参照が違っても中身は既定と同じことがある。
 * 保存するか（既定のままなら書かない。D-24）を、参照ではなく内容で決めるために使う。
 *
 * @param t - 設定
 * @returns 既定と同じなら true
 */
export function isDefaultTimeline(t: TimelineSettings): boolean {
  return (
    t === DEFAULT_TIMELINE ||
    (t.target === DEFAULT_TIMELINE.target &&
      t.width === DEFAULT_TIMELINE.width &&
      t.node === null &&
      t.edge === null)
  );
}

/**
 * 年表の設定のストアを作る。テストごとに新しいストアを作れるよう、関数にしてある。
 *
 * @returns 新しいストア
 */
export function createTimelineStore() {
  return createStore<TimelineViewState>()((set, get) => ({
    timeline: DEFAULT_TIMELINE,
    patchTimeline: (change) => {
      set({ timeline: { ...get().timeline, ...change } });
    },
    reset: (next) => {
      set({ timeline: next ?? DEFAULT_TIMELINE });
    },
  }));
}

/**
 * データの置き換えで、前のデータの属性名を指す「日付の出どころ」を選び直しに戻す
 * （対象と区切りの幅は利用者の好みなので保つ）。
 *
 * @param timeline - 年表の設定のストア
 * @param data - データのストア
 * @returns 購読解除
 */
export function bindTimelineToData(
  timeline: StoreApi<TimelineViewState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((s, prev) => {
    // 【なぜ】出どころの属性名は前のデータのもの。プロジェクトを開くときは applySnapshot が置き直す。
    if (s.dataset !== prev.dataset) {
      const t = timeline.getState().timeline;
      if (t.node !== null || t.edge !== null)
        timeline.getState().reset({ ...t, node: null, edge: null });
    }
  });
}

/** アプリ全体の、年表の設定。 */
export const timelineStore = createTimelineStore();
bindTimelineToData(timelineStore, dataStore);
