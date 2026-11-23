import { createStore } from 'zustand/vanilla';

/** 構築のパネルの開閉。保存しない一時的な UI の状態（設計書 §10）。 */
export interface BuildPanelState {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

/**
 * 構築のパネルの開閉のストア。
 *
 * 【なぜ】図の上の注意（ProjectionIssues）は、パネルが開いている間は出さない。開閉を持つ BuildControl と
 * 図の GraphView が離れているので、共有の置き場が要る。フィルタ・選択・viewport には関わらない。
 */
export const buildPanelStore = createStore<BuildPanelState>()((set) => ({
  open: false,
  setOpen: (open) => {
    set({ open });
  },
}));
