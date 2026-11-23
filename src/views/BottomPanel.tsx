import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { WORKSPACE_HEIGHT_MAX, WORKSPACE_HEIGHT_MIN } from '../core/project';
import type { WorkspaceTab } from '../core/project';
import { workspaceStore } from '../state';
import { useT, useWorkspaceView } from './hooks';
import { MissingView } from './MissingView';
import { TableView } from './TableView';
import { Icon } from './ui/icons';
import { Tabs } from './ui/Tabs';
import { tabElementId, tabPanelElementId } from './ui/tabIds';
import './workspace.css';

/** タブとパネルを結ぶ ID の接頭辞。 */
const PREFIX = 'workspace';
/** 矢印キー 1 回で変える高さ（CSS ピクセル）と、PageUp / PageDown の幅。 */
const STEP = 24;
const BIG_STEP = 96;

/**
 * 下の段（フェーズ 2 の方針 §3.1）。図の下に置く、開閉と高さの変更ができるタブの領域。
 *
 * 今あるタブは「表」と「欠損」。年表は、そのタスクでタブを足す（空のタブを置かない）。
 * 開閉、開いているタブ、高さは workspaceStore に持ち、プロジェクトに保存する（D-44）。
 *
 * 【なぜ】閉じても中身は描いたまま隠す（`hidden`）。外すと、表の並べ替えやページを失うため
 * （`SidePanel` と同じ考え方）。開閉は、フィルタ、選択、viewport に触れない。
 * @returns 下の段の要素
 */
export function BottomPanel() {
  const t = useT();
  const { tab, open, height } = useWorkspaceView((s) => s.workspace);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const patch = (change: { open?: boolean; height?: number; tab?: WorkspaceTab }) => {
    workspaceStore.getState().patchWorkspace(change);
  };
  // 【TS】`as const` で ID を `string` ではなく文字列リテラル型 `'table'` に保つ（`Tabs` の型引数 Id になる）。
  const tabs = [
    { id: 'table' as const, label: t('workspace.tab.table') },
    { id: 'missing' as const, label: t('workspace.tab.missing') },
  ];
  const toggleLabel = t(open ? 'workspace.close' : 'workspace.open');
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 上へ動かすと段が高くなる（段の上の縁を動かす分割バーのため）。
    const change =
      e.key === 'ArrowUp'
        ? height + STEP
        : e.key === 'ArrowDown'
          ? height - STEP
          : e.key === 'PageUp'
            ? height + BIG_STEP
            : e.key === 'PageDown'
              ? height - BIG_STEP
              : e.key === 'Home'
                ? WORKSPACE_HEIGHT_MIN
                : e.key === 'End'
                  ? WORKSPACE_HEIGHT_MAX
                  : undefined;
    if (change === undefined) return;
    e.preventDefault();
    patch({ height: change });
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // 【なぜ】既定の動作（ドラッグ中の文字の選択、画像のドラッグ）を止める。止めないと、つかんだまま
    //   動かすと下の表の文字が選択されてしまう。
    e.preventDefault();
    drag.current = { y: e.clientY, height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start !== null) patch({ height: start.height + (start.y - e.clientY) });
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <section className="bottom-panel" aria-label={t('workspace.region')} data-open={open}>
      {open && (
        // 【なぜ】WAI-ARIA の「ウィンドウ分割バー」。フォーカスでき、矢印キーで動かせる。
        //   ドラッグでもキーでも同じ patchWorkspace を通すので、保存と範囲の制限が 1 か所に集まる。
        <div
          className="bottom-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-controls={tabPanelElementId(PREFIX, tab)}
          aria-label={t('workspace.resize')}
          aria-valuenow={height}
          aria-valuemin={WORKSPACE_HEIGHT_MIN}
          aria-valuemax={WORKSPACE_HEIGHT_MAX}
          title={t('workspace.resize.hint')}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
      <div className="bottom-bar">
        <Tabs
          label={t('workspace.tabs')}
          idPrefix={PREFIX}
          tabs={tabs}
          selected={tab}
          onSelect={(id) => {
            // 閉じているときにタブを押したら、開く（押したのに何も起きないように見せない）。
            patch({ tab: id, open: true });
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={open}
          aria-controls={tabPanelElementId(PREFIX, tab)}
          onClick={() => {
            patch({ open: !open });
          }}
        >
          <Icon name={open ? 'chevronDown' : 'chevronUp'} />
        </button>
      </div>
      {/* 閉じても描いたまま隠す。タブごとにパネルを並べ、選んでいないものを隠す。 */}
      <div
        id={tabPanelElementId(PREFIX, 'table')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'table')}
        className="bottom-body"
        style={{ height }}
        hidden={!open || tab !== 'table'}
      >
        <TableView />
      </div>
      <div
        id={tabPanelElementId(PREFIX, 'missing')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'missing')}
        className="bottom-body"
        style={{ height }}
        hidden={!open || tab !== 'missing'}
      >
        <MissingView />
      </div>
    </section>
  );
}
