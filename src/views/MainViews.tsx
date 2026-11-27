import { useState } from 'react';
import type { MainView } from '../core/project';
import { workspaceStore } from '../state';
import { GraphView } from './GraphView';
import { MapView } from './MapView';
import { useData, useT, useWorkspaceView } from './hooks';
import { Tabs } from './ui/Tabs';
import { tabElementId, tabPanelElementId } from './ui/tabIds';
import './map.css';

const PREFIX = 'main-view';

/**
 * 中央の主な領域。「グラフ｜地図」の切り替え（`role="tablist"`）と、2 つのビュー（D-48）。
 *
 * 選んだビューは `view.workspace.mainView` に保存する。
 * 【なぜ】地図は**初めて開いたときに**描き始める。それまで地図の部品もタイルも取りに行かない（NFR-02）。
 * 一度開いたら、2 つとも描いたまま隠す（`hidden`）。切り替えても、グラフのレイアウトとズーム、地図の
 * 表示範囲と計算結果を失わない。地図のタブを開いた状態で保存したファイルは、開いた時点で地図を読み込む。
 *
 * @returns 切り替えとビュー。データが無ければ何も出さない（空の画面の案内は App が出す）
 */
export function MainViews() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const mainView = useWorkspaceView((s) => s.workspace.mainView);
  const [mapOpened, setMapOpened] = useState(false);
  // 【なぜ】描画の中での状態の更新は、「前の値から導く状態」の定石（useEffect で後から直すと 1 回余分に描く）。
  if (mainView === 'map' && dataset !== null && !mapOpened) setMapOpened(true);
  const select = (id: MainView): void => {
    workspaceStore.getState().patchWorkspace({ mainView: id });
  };
  return (
    <>
      {dataset !== null && (
        <Tabs
          label={t('main.views')}
          idPrefix={PREFIX}
          tabs={[
            { id: 'graph', label: t('main.view.graph') },
            { id: 'map', label: t('main.view.map') },
          ]}
          selected={mainView}
          onSelect={select}
        />
      )}
      <div
        id={tabPanelElementId(PREFIX, 'graph')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'graph')}
        className="main-view"
        hidden={mainView !== 'graph'}
      >
        <GraphView />
      </div>
      <div
        id={tabPanelElementId(PREFIX, 'map')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'map')}
        className="main-view"
        hidden={mainView !== 'map'}
      >
        {mapOpened && dataset !== null && <MapView active={mainView === 'map'} />}
      </div>
    </>
  );
}
