import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { WORKSPACE_HEIGHT_MAX, WORKSPACE_HEIGHT_MIN } from '../core/project';
import type { WorkspaceTab } from '../core/project';
import { workspaceStore } from '../state';
import { useT, useWorkspaceView } from './hooks';
import { MissingView } from './MissingView';
import { TableView } from './TableView';
import { TimelineView } from './timeline/TimelineView';
import { Icon } from './ui/icons';
import { Tabs } from './ui/Tabs';
import { tabElementId, tabPanelElementId } from './ui/tabIds';
import './workspace.css';

/** タブとパネルを結ぶ ID の接頭辞。 */
const PREFIX = 'workspace';
/** 矢印キー 1 回で変える高さ（CSS ピクセル）と、PageUp / PageDown の幅。 */
const STEP = 24;
/** 図の高さの下限（CSS ピクセル）。graph.css の `.graph-canvas` の min-block-size と同じ（D-49）。 */
const GRAPH_HEIGHT_MIN = 240;
/**
 * 下の段の高さの上限を、中央の列の内側の高さに対する割合で表す（D-49）。
 * CSS の `min(保存した高さ, 40cqb)`（下の style）と、広げる操作の丸めの両方で同じ値を使う。
 */
export const BOTTOM_MAX_RATIO = 0.4;
/** 年表の棒グラフの下限（CSS ピクセル）。timeline.css の `.timeline-main` の min-block-size と同じ。 */
const TIMELINE_CHART_MIN = 120;
/** 年表の下限を測れるまでの仮の値（初回の描画だけ）。 */
const TIMELINE_FLOOR_FALLBACK = 290;
/** 表の下限: ツールバー、見出し、3 行ほどが見える高さ（15rem 相当。D-49）。 */
const TABLE_FLOOR = 240;
const BIG_STEP = 96;

/**
 * 下の段（フェーズ 2 の方針 §3.1）。図の下に置く、開閉と高さの変更ができるタブの領域。
 *
 * タブは「年表」「表」「欠損」（空のタブを置かない）。
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
  const panel = useRef<HTMLElement | null>(null);
  // 【なぜ】段の「実際の高さ」（実効の高さ）を測って持つ。保存している高さ（height）は、窓が低いと
  //   CSS の min(…, 40cqb) と中身の下限で変わる。ドラッグの開始値、キー操作の基準、aria-valuenow は
  //   すべてこの実際の高さにそろえる（そろえないと、操作が数十 px 空振りする）。保存する値は窓で
  //   書き換えない（D-44）。
  const [effective, setEffective] = useState<number>(height);
  // 年表の下限: 操作の部分の高さ ＋ 棒グラフ ＋ 年表の中の間隔 ＋ 段の余白（D-49）。操作が折り返すと変わるので、測る。
  const [timelineFloor, setTimelineFloor] = useState<number>(TIMELINE_FLOOR_FALLBACK);
  // 分割バーで実際に広げられる上限（aria-valuemax）。窓と図の余裕で変わるので、測る。
  const [growthMax, setGrowthMax] = useState<number>(WORKSPACE_HEIGHT_MAX);
  /**
   * 中央の列（`data-bottom-column`）と、その内側の高さ。
   *
   * @returns 列の要素と内側の高さ。列が見つからなければ null
   */
  const column = (): { el: HTMLElement; inner: number } | null => {
    const el = panel.current?.closest<HTMLElement>('[data-bottom-column]');
    if (el === null || el === undefined) return null;
    const style = getComputedStyle(el);
    const inner =
      el.clientHeight - parseFloat(style.paddingBlockStart) - parseFloat(style.paddingBlockEnd);
    return { el, inner };
  };
  /**
   * 広げられる高さの上限。中央の列の {@link BOTTOM_MAX_RATIO} と、図が下限（240 px）を下回らない余裕の
   * 小さいほう。いまの実際の高さより低くはしない。
   *
   * @param current - いまの実際の高さ
   * @returns 上限（CSS ピクセル）
   */
  const growthLimit = (current: number): number => {
    const col = column();
    if (col === null) return WORKSPACE_HEIGHT_MAX;
    // 【なぜ】T3-03 で地図の枠にも同じ印を付ける。見えている（display:none でない）枠だけを見る。
    const frame = Array.from(document.querySelectorAll<HTMLElement>('[data-main-frame]')).find(
      (el) => el.offsetParent !== null,
    );
    const slack =
      frame === undefined ? Infinity : Math.max(0, frame.offsetHeight - GRAPH_HEIGHT_MIN);
    return Math.max(
      current,
      Math.min(WORKSPACE_HEIGHT_MAX, Math.floor(col.inner * BOTTOM_MAX_RATIO), current + slack),
    );
  };
  // 開いているタブの下限（中身で決まる。D-49）。
  const floor =
    tab === 'timeline' ? timelineFloor : tab === 'table' ? TABLE_FLOOR : WORKSPACE_HEIGHT_MIN;
  useEffect(() => {
    const body = panel.current?.querySelector<HTMLElement>('.bottom-body:not([hidden])');
    if (!open || body === null || body === undefined) return;
    const head = body.querySelector<HTMLElement>('.timeline-head');
    const view = body.querySelector<HTMLElement>('.timeline-view');
    const measure = () => {
      const now = Math.round(body.getBoundingClientRect().height);
      setEffective(now);
      setGrowthMax(growthLimit(now));
      if (head !== null && view !== null) {
        const bodyStyle = getComputedStyle(body);
        const padding =
          parseFloat(bodyStyle.paddingBlockStart) + parseFloat(bodyStyle.paddingBlockEnd);
        const gap = parseFloat(getComputedStyle(view).rowGap) || 0;
        setTimelineFloor(Math.ceil(head.offsetHeight + gap + TIMELINE_CHART_MIN + padding));
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    if (head !== null) observer.observe(head);
    const col = column();
    if (col !== null) observer.observe(col.el);
    return () => {
      observer.disconnect();
    };
    // 【なぜ】measure は描画のたびに作り直される関数。依存に入れると毎回つなぎ直すので、
    //   測る元になる値（開閉、タブ、保存した高さ）だけを依存にする。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 上の理由で、依存を絞っている
  }, [open, tab, height]);
  const patch = (change: { open?: boolean; height?: number; tab?: WorkspaceTab }) => {
    workspaceStore.getState().patchWorkspace(change);
  };
  // 【TS】`as const` で ID を `string` ではなく文字列リテラル型 `'table'` に保つ（`Tabs` の型引数 Id になる）。
  const tabs = [
    { id: 'timeline' as const, label: t('workspace.tab.timeline') },
    { id: 'table' as const, label: t('workspace.tab.table') },
    { id: 'missing' as const, label: t('workspace.tab.missing') },
  ];
  const toggleLabel = t(open ? 'workspace.close' : 'workspace.open');
  /**
   * いまの実際の高さをその場で測る。キーを続けて押したとき、`effective`（ResizeObserver 経由で遅れて
   * 更新される）ではなく、直前の操作が反映された DOM の値を基準にするため。
   *
   * @returns 開いている段の実際の高さ（CSS ピクセル）
   */
  const liveHeight = (): number => {
    const body = panel.current?.querySelector<HTMLElement>('.bottom-body:not([hidden])');
    return body === null || body === undefined
      ? effective
      : Math.round(body.getBoundingClientRect().height);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const base = liveHeight();
    // 上へ動かすと段が高くなる（段の上の縁を動かす分割バーのため）。
    const change =
      e.key === 'ArrowUp'
        ? base + STEP
        : e.key === 'ArrowDown'
          ? base - STEP
          : e.key === 'PageUp'
            ? base + BIG_STEP
            : e.key === 'PageDown'
              ? base - BIG_STEP
              : e.key === 'Home'
                ? WORKSPACE_HEIGHT_MIN
                : e.key === 'End'
                  ? WORKSPACE_HEIGHT_MAX
                  : undefined;
    if (change === undefined) return;
    e.preventDefault();
    // 下限にいるのに縮める操作は、保存した高さも変えない（見た目が変わらないのに値だけ動くのを避ける）。
    if (change < base && base <= floor) return;
    // 広げる向きだけ、窓の余裕で丸める。
    patch({ height: change > base ? Math.min(change, growthLimit(base)) : change });
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // 【なぜ】既定の動作（ドラッグ中の文字の選択、画像のドラッグ）を止める。止めないと、つかんだまま
    //   動かすと下の表の文字が選択されてしまう。
    e.preventDefault();
    drag.current = { y: e.clientY, height: liveHeight() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start !== null) {
      const wanted = start.height + (start.y - e.clientY);
      if (wanted < start.height && start.height <= floor) return;
      patch({
        height: wanted > start.height ? Math.min(wanted, growthLimit(start.height)) : wanted,
      });
    }
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  // 【なぜ】高さは「保存した高さ」と「中央の列の割合」の小さいほう（cqb は列の内側の高さの 1%）。
  const bodySize = `min(${String(height)}px, ${String(BOTTOM_MAX_RATIO * 100)}cqb)`;
  return (
    <section
      ref={panel}
      className="bottom-panel"
      aria-label={t('workspace.region')}
      data-open={open}
    >
      {open && (
        // 【なぜ】WAI-ARIA の「ウィンドウ分割バー」。フォーカスでき、矢印キーで動かせる。
        //   ドラッグでもキーでも同じ patchWorkspace を通すので、保存と範囲の制限が 1 か所に集まる。
        <div
          className="bottom-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-controls={tabPanelElementId(PREFIX, tab)}
          aria-label={t('workspace.resize')}
          aria-valuenow={effective}
          aria-valuemin={Math.min(floor, effective)}
          aria-valuemax={Math.max(growthMax, effective)}
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
      {/* 閉じても描いたまま隠す。タブごとにパネルを並べ、選んでいないものを隠す（中身を作り直さない）。 */}
      <div
        id={tabPanelElementId(PREFIX, 'timeline')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'timeline')}
        className="bottom-body bottom-body-timeline"
        style={{ blockSize: bodySize, minBlockSize: timelineFloor }}
        hidden={!open || tab !== 'timeline'}
      >
        <TimelineView />
      </div>
      <div
        id={tabPanelElementId(PREFIX, 'table')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'table')}
        className="bottom-body bottom-body-table"
        style={{ blockSize: bodySize, minBlockSize: TABLE_FLOOR }}
        hidden={!open || tab !== 'table'}
      >
        <TableView />
      </div>
      <div
        id={tabPanelElementId(PREFIX, 'missing')}
        role="tabpanel"
        aria-labelledby={tabElementId(PREFIX, 'missing')}
        className="bottom-body bottom-body-missing"
        style={{ blockSize: bodySize }}
        hidden={!open || tab !== 'missing'}
      >
        <MissingView />
      </div>
    </section>
  );
}
