import { dataStore, filterStore, uiStore, graphViewStore, workspaceStore } from '../state';
import { projectNoticeStore } from '../views/projectNotice';
import type { ProjectNotice } from '../views/projectNotice';
import { createAutosave } from './autosave';
import type { AutosaveProblem } from './autosave';
import { createIdbStorage } from './idbStorage';
import { watchOtherTabs } from './tabWatch';

const PROBLEM_NOTICE: Readonly<Record<AutosaveProblem, ProjectNotice>> = {
  unavailable: { kind: 'autosave-unavailable' },
  quota: { kind: 'autosave-quota' },
  serialize: { kind: 'autosave-serialize' },
  stopped: { kind: 'autosave-stopped' },
};

/**
 * アプリ全体の自動保存（FR-PJ-02）。本物のストアと IndexedDB につなぐ。
 *
 * 【なぜ】`indexedDB` が未定義の環境でも例外にせず、保存先の失敗として扱う（`typeof` で調べる）。
 */
export const autosave = createAutosave({
  targets: {
    graph: graphViewStore,
    workspace: workspaceStore,
    data: dataStore,
    filter: filterStore,
    notice: projectNoticeStore,
  },
  storage: createIdbStorage(typeof indexedDB === 'undefined' ? undefined : indexedDB),
  now: () => new Date().toISOString(),
  onProblem: (p) => {
    projectNoticeStore.getState().show(PROBLEM_NOTICE[p]);
  },
  ui: uiStore,
});

/**
 * 保存してある自動保存を消す。消せたときだけ「消した」を知らせ、失敗したら毎回、別の知らせを出す。
 */
export async function clearAutosave(): Promise<void> {
  const ok = await autosave.clear();
  projectNoticeStore.getState().show({ kind: ok ? 'autosave-cleared' : 'autosave-clear-failed' });
}

/**
 * 別のタブの検出を始める。知らせは最初の 1 回だけ出す。
 *
 * @returns 止める関数
 */
export function startTabWatch(): () => void {
  let told = false;
  return watchOtherTabs(
    (name) => (typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name)),
    () => {
      if (told) return;
      told = true;
      projectNoticeStore.getState().show({ kind: 'other-tab' });
    },
  );
}
