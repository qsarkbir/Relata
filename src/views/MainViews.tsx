import { useState } from 'react';
import { useStore } from 'zustand';
import { GraphView } from './GraphView';
import { MapView } from './MapView';
import { MapGate } from './MapGatePanel';
import { MAIN_VIEW_PANEL_PREFIX } from './MainViewTabs';
import { mapGateStore } from './mapGate';
import { useData, useWorkspaceView } from './hooks';
import { tabElementId, tabPanelElementId } from './ui/tabIds';
import './map.css';

/**
 * 中央の主な領域。「グラフ｜地図」の 2 つのビューの入れ物（D-48）。切り替えのタブは、各ビューの
 * ツールバーの先頭にある（`MainViewTabs`。phase3-plan §3.1）。選んだビューは `view.workspace.mainView` に保存する。
 *
 * 【なぜ】地図は**初めて開いたときに**描き始める。それまで地図の部品もタイルも取りに行かない（NFR-02）。
 * 一度開いたら、2 つとも描いたまま隠す（`hidden`）。切り替えても、グラフのレイアウトとズーム、地図の
 * 表示範囲と計算結果を失わない。地図のタブを開いた状態で保存したファイルは、開いた時点で地図を読み込む。
 * ただし、ファイルの背景が利用者のタイルのときは、開いた人が押すまで読まない（`MapGate`。D-51 補足）。
 *
 * @returns 2 つのビュー。データが無ければグラフだけ（空の画面の案内は App が出す）
 */
export function MainViews() {
  const dataset = useData((s) => s.dataset);
  const mainView = useWorkspaceView((s) => s.workspace.mainView);
  const hold = useStore(mapGateStore, (s) => s.hold);
  // 待ちは、読み込んだそのデータにだけ効く（別のデータに替われば無効）。
  const held = hold !== null && hold.dataset === dataset ? hold : null;
  const [mapOpened, setMapOpened] = useState(false);
  // 【なぜ】描画の中での状態の更新は、「前の値から導く状態」の定石（useEffect で後から直すと 1 回余分に描く）。
  if (mainView === 'map' && dataset !== null && held === null && !mapOpened) setMapOpened(true);
  return (
    <>
      <div
        id={tabPanelElementId(MAIN_VIEW_PANEL_PREFIX, 'graph')}
        role="tabpanel"
        aria-labelledby={tabElementId('main-view-graph', 'graph')}
        className="main-view"
        hidden={mainView !== 'graph'}
      >
        <GraphView />
      </div>
      <div
        id={tabPanelElementId(MAIN_VIEW_PANEL_PREFIX, 'map')}
        role="tabpanel"
        aria-labelledby={tabElementId(held === null ? 'main-view-map' : 'main-view-gate', 'map')}
        className="main-view"
        hidden={mainView !== 'map'}
      >
        {dataset !== null &&
          (held !== null ? (
            <MapGate host={held.host} />
          ) : (
            mapOpened && <MapView active={mainView === 'map'} />
          ))}
      </div>
    </>
  );
}
