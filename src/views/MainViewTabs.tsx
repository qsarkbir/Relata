import type { MainView } from '../core/project';
import { workspaceStore } from '../state';
import { useT, useWorkspaceView } from './hooks';
import { Tabs } from './ui/Tabs';

/** パネル（`MainViews` の入れ物）の ID の接頭辞。 */
export const MAIN_VIEW_PANEL_PREFIX = 'main-view';

/** {@link MainViewTabs} の props。 */
interface Props {
  /** どのビューのツールバーに置くか。タブの要素の ID を場所ごとに分けるために使う。 */
  readonly host: 'graph' | 'map' | 'gate';
}

/**
 * 隠れたほうのビューのタブへ移れなかったときに、見えているタブへフォーカスを移す（最大 10 フレーム待つ）。
 *
 * 【なぜ】押したタブは、ビューの切り替えで隠れる（`hidden`）。フォーカスが隠れた要素に残ると、キーボードの
 * 利用者が操作の続きを失う。切り替え後のビューのツールバーにある同じタブへ移す。地図は初めて開くときに
 * 遅れて現れるので、少し待つ。
 *
 * @param id - 移したいタブのビュー
 * @param frames - 残りの試行回数
 */
function focusVisibleTab(id: MainView, frames = 10): void {
  const tab = Array.from(
    document.querySelectorAll<HTMLElement>(`[role="tab"][id^="main-view-"][id$="-tab-${id}"]`),
  ).find((el) => el.offsetParent !== null);
  if (tab !== undefined) tab.focus();
  else if (frames > 0)
    requestAnimationFrame(() => {
      focusVisibleTab(id, frames - 1);
    });
}

/**
 * 「グラフ｜地図」の切り替え（`role="tablist"`。D-48）。各ビューのツールバーの先頭に置く（phase3-plan §3.1）。
 *
 * 選んだビューは `view.workspace.mainView` に保存する。同じタブが、グラフと地図の両方のツールバーに出る
 * （見えているほうのビューのものだけが画面に出る）。
 *
 * @param props - 置く場所
 * @returns タブの並び
 */
export function MainViewTabs({ host }: Props) {
  const t = useT();
  const mainView = useWorkspaceView((s) => s.workspace.mainView);
  return (
    <Tabs
      label={t('main.views')}
      idPrefix={`main-view-${host}`}
      panelIdPrefix={MAIN_VIEW_PANEL_PREFIX}
      tabs={[
        { id: 'graph', label: t('main.view.graph') },
        { id: 'map', label: t('main.view.map') },
      ]}
      selected={mainView}
      onSelect={(id) => {
        workspaceStore.getState().patchWorkspace({ mainView: id });
        requestAnimationFrame(() => {
          focusVisibleTab(id);
        });
      }}
    />
  );
}
