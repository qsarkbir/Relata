import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { toNodeId } from '../core/model';
import type { NodeId } from '../core/model';
import { selectionStore } from '../state';

/** 矩形（SVG の座標）。描画用。 */
export interface RangeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 矩形の判定に使う、画面（client）座標の 2 点。 */
interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * 画面座標の矩形の中に中心がある要素の ID を集める。
 *
 * 【なぜ】ノードの位置を自前の式で変換せず、描かれた要素の実際の位置（getBoundingClientRect）で判定する。
 * ズームとパンの変換（`<g transform>`）や枠のつまみの大きさ変更が、そのまま反映されるため。
 *
 * @param elements - ノードの要素（`data-id` を持つ）
 * @param box - 画面座標の矩形
 * @returns 矩形に入ったノード ID
 */
export function nodesInBox(elements: Iterable<Element>, box: ClientBox): NodeId[] {
  const ids: NodeId[] = [];
  for (const el of elements) {
    const id = el.getAttribute('data-id');
    if (id === null) continue;
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) {
      ids.push(toNodeId(id));
    }
  }
  return ids;
}

/**
 * グラフの Shift ＋ ドラッグの矩形選択（FR-FL-11、D-41）。
 *
 * Shift なしの操作（パン、ノードのドラッグ、クリック）には関与しない。呼ぶ側は、`begin` が
 * true を返したときだけ、そのイベントを通常のドラッグとして扱わない。
 *
 * @param svg - 図の SVG 要素
 * @returns 矩形（ドラッグ中だけ）と、ポインタ操作の関数
 */
export function useRangeSelect(svg: RefObject<SVGSVGElement | null>) {
  // 画面座標を SVG の座標に直す（ズーム・パン・枠の大きさの変化を含む変換行列の逆）。
  const point = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix === null || matrix === undefined
      ? { x: clientX, y: clientY }
      : new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  };
  const start = useRef<{
    cx: number;
    cy: number;
    sx: number;
    sy: number;
    moved: boolean;
    id?: NodeId;
  } | null>(null);
  const [rect, setRect] = useState<RangeRect | null>(null);

  const hits = (cx: number, cy: number, s: NonNullable<typeof start.current>): NodeId[] =>
    nodesInBox(svg.current?.querySelectorAll('#graph-view-nodes [data-id]') ?? [], {
      left: Math.min(s.cx, cx),
      right: Math.max(s.cx, cx),
      top: Math.min(s.cy, cy),
      bottom: Math.max(s.cy, cy),
    });

  return {
    rect,
    // 進行中か。
    active: () => start.current !== null,
    // Shift ＋ 押下で呼ぶ。範囲選択を始めたら true。
    begin: (e: ReactPointerEvent<SVGSVGElement>): boolean => {
      if (!e.shiftKey || e.button !== 0) return false;
      const p = point(e.clientX, e.clientY);
      const element = e.target instanceof Element ? e.target.closest('[data-id]') : null;
      const id =
        element?.closest('#graph-view-nodes') != null
          ? (element.getAttribute('data-id') ?? undefined)
          : undefined;
      start.current = {
        cx: e.clientX,
        cy: e.clientY,
        sx: p.x,
        sy: p.y,
        moved: false,
        ...(id === undefined ? {} : { id: toNodeId(id) }),
      };
      svg.current?.setPointerCapture(e.pointerId);
      return true;
    },
    move: (e: ReactPointerEvent<SVGSVGElement>): void => {
      const s = start.current;
      if (s === null) return;
      const p = point(e.clientX, e.clientY);
      s.moved ||= Math.abs(p.x - s.sx) + Math.abs(p.y - s.sy) > 3;
      if (!s.moved) return;
      setRect({
        x: Math.min(s.sx, p.x),
        y: Math.min(s.sy, p.y),
        width: Math.abs(p.x - s.sx),
        height: Math.abs(p.y - s.sy),
      });
    },
    // 離したとき。ドラッグなら矩形のノードを選択に足す。動いていなければ、押したノードを足す・外す。
    end: (e: ReactPointerEvent<SVGSVGElement>): void => {
      const s = start.current;
      start.current = null;
      setRect(null);
      if (s === null) return;
      if (svg.current?.hasPointerCapture(e.pointerId))
        svg.current.releasePointerCapture(e.pointerId);
      const sel = selectionStore.getState();
      if (s.moved) {
        // 【なぜ】Shift ＋ ドラッグは選択を置き換えず足す。続けて別の範囲を足せるように。
        // エッジの選択は、ノードの範囲選択と混ぜない（D-40: エッジの選択は ID だけ）ので外す。
        sel.select({ nodes: [...sel.nodes, ...hits(e.clientX, e.clientY, s)] });
      } else if (s.id !== undefined) {
        if (sel.nodes.has(s.id)) sel.remove({ nodes: [s.id] });
        else sel.add({ nodes: [s.id] });
      }
    },
    cancel: (): void => {
      start.current = null;
      setRect(null);
    },
  };
}
