import { useRef } from 'react';
// 【TS】`import type` は型だけを読み込む（実行時には消える）。`as` で別名を付けると、DOM の同名の型（PointerEvent）と区別できる。
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { toNodeId } from '../core/model';
import type { EdgeId, NodeId } from '../core/model';
import { selectionStore } from '../state';

/** 矩形の判定に使う、画面（client）座標の矩形。左上が (left, top)、右下が (right, bottom)。 */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** `useRangeSelect` が返す操作の集まり。 */
export interface RangeSelect {
  /** 範囲選択の最中か。 */
  readonly active: () => boolean;
  /** Shift ＋ 押下で呼ぶ。範囲選択（またはその Shift ＋ クリック）を始めたら true。 */
  readonly begin: (e: ReactPointerEvent<SVGSVGElement>) => boolean;
  /** ポインタの移動。 */
  readonly move: (e: ReactPointerEvent<SVGSVGElement>) => void;
  /** 離したとき。ドラッグなら矩形のノードを選択に足す。動いていなければ、押したノード・エッジを足す・外す。 */
  readonly end: (e: ReactPointerEvent<SVGSVGElement>) => void;
  /** 中断する（Esc、ポインタの取りこぼし、取り消し）。選択は変えない。 */
  readonly cancel: () => void;
}

/**
 * 画面座標を SVG の座標に直す。
 *
 * 【なぜ】ズーム・パン・枠の大きさの変化を含む変換行列（getScreenCTM）の逆を使う。
 *
 * @param element - SVG 要素（無ければ変換しない）
 * @param clientX - 画面の x
 * @param clientY - 画面の y
 * @returns SVG の座標
 */
export function clientToSvg(
  element: SVGSVGElement | null,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const matrix = element?.getScreenCTM();
  return matrix === null || matrix === undefined
    ? { x: clientX, y: clientY }
    : new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
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
 * 矩形を、別の矩形と重なる部分に絞る。重ならなければ null。
 *
 * 【なぜ】ズームやパンで図の外にはみ出したノードは、画面に見えない。見えないものを拾わない。
 *
 * @param box - 矩形
 * @param clip - 絞り込みの範囲（SVG の表示領域）
 * @returns 重なる部分、無ければ null
 */
export function clipBox(box: ClientBox, clip: ClientBox): ClientBox | null {
  const left = Math.max(box.left, clip.left);
  const top = Math.max(box.top, clip.top);
  const right = Math.min(box.right, clip.right);
  const bottom = Math.min(box.bottom, clip.bottom);
  return left > right || top > bottom ? null : { left, top, right, bottom };
}

// 【TS】`readonly` は代入を禁じる。`moved` だけが途中で変わるので付けない。`id?:` は「無くてもよい項目」。
interface Start {
  readonly cx: number;
  readonly cy: number;
  readonly sx: number;
  readonly sy: number;
  moved: boolean;
  readonly id?: NodeId;
  readonly edgeKey?: string;
}

/**
 * グラフの Shift ＋ ドラッグの矩形選択（FR-FL-11、D-41）。
 *
 * Shift なしの操作（パン、ノードのドラッグ、クリック）には関与しない。呼ぶ側は、`begin` が
 * true を返したときだけ、そのイベントを通常のドラッグとして扱わない。
 *
 * @param svg - 図の SVG 要素への ref
 * @param rectRef - 矩形を描く `<rect>` への ref。再描画せずに属性を直接書き換える（ドラッグ中に図全体を描き直さない）
 * @param edgeIdsOf - 図のエッジのキーから、元のエッジ ID の一覧を引く関数（Shift ＋ クリック用）
 * @returns 矩形の ref と、ポインタ操作の関数
 */
export function useRangeSelect(
  svg: RefObject<SVGSVGElement | null>,
  rectRef: RefObject<SVGRectElement | null>,
  edgeIdsOf: (edgeKey: string) => readonly EdgeId[],
): RangeSelect {
  const start = useRef<Start | null>(null);

  const hideRect = (): void => {
    rectRef.current?.setAttribute('visibility', 'hidden');
  };
  const cancel = (): void => {
    start.current = null;
    hideRect();
  };
  const box = (cx: number, cy: number, s: Start): ClientBox | null => {
    const frame = svg.current?.getBoundingClientRect();
    const raw = {
      left: Math.min(s.cx, cx),
      right: Math.max(s.cx, cx),
      top: Math.min(s.cy, cy),
      bottom: Math.max(s.cy, cy),
    };
    return frame === undefined ? raw : clipBox(raw, frame);
  };

  return {
    active: () => start.current !== null,
    begin: (e) => {
      // 【なぜ】前の操作の取りこぼしが残っていても、新しい操作の前に捨てる。
      cancel();
      if (!e.shiftKey || e.button !== 0) return false;
      const p = clientToSvg(svg.current, e.clientX, e.clientY);
      const element = e.target instanceof Element ? e.target.closest('[data-id]') : null;
      const dataId = element?.getAttribute('data-id') ?? undefined;
      const inNodes = element?.closest('#graph-view-nodes') != null;
      const inEdges = element?.closest('#graph-view-edges') != null;
      start.current = {
        cx: e.clientX,
        cy: e.clientY,
        sx: p.x,
        sy: p.y,
        moved: false,
        ...(dataId !== undefined && inNodes ? { id: toNodeId(dataId) } : {}),
        ...(dataId !== undefined && inEdges && !inNodes ? { edgeKey: dataId } : {}),
      };
      svg.current?.setPointerCapture(e.pointerId);
      return true;
    },
    move: (e) => {
      const s = start.current;
      if (s === null) return;
      // 【なぜ】ボタンが離されたのに pointerup を取りこぼした場合は、矩形を残さず中断する。
      if (e.buttons === 0) {
        cancel();
        return;
      }
      const p = clientToSvg(svg.current, e.clientX, e.clientY);
      // 【TS】`||=` は「左が false のときだけ右を代入する」。一度でも動いたら true のまま保つ。
      s.moved ||= Math.abs(p.x - s.sx) + Math.abs(p.y - s.sy) > 3;
      const r = rectRef.current;
      if (!s.moved || r === null) return;
      r.setAttribute('x', String(Math.min(s.sx, p.x)));
      r.setAttribute('y', String(Math.min(s.sy, p.y)));
      r.setAttribute('width', String(Math.abs(p.x - s.sx)));
      r.setAttribute('height', String(Math.abs(p.y - s.sy)));
      r.setAttribute('visibility', 'visible');
    },
    end: (e) => {
      const s = start.current;
      cancel();
      if (s === null) return;
      if (svg.current?.hasPointerCapture(e.pointerId)) {
        svg.current.releasePointerCapture(e.pointerId);
      }
      const sel = selectionStore.getState();
      if (s.moved) {
        // 【なぜ】Shift ＋ ドラッグは選択を置き換えず足す（D-41）。エッジの選択も消さない。
        const b = box(e.clientX, e.clientY, s);
        if (b === null) return;
        const hits = nodesInBox(
          svg.current?.querySelectorAll('#graph-view-nodes [data-id]') ?? [],
          b,
        );
        sel.add({ nodes: hits });
      } else if (s.id !== undefined) {
        if (sel.nodes.has(s.id)) sel.remove({ nodes: [s.id] });
        else sel.add({ nodes: [s.id] });
      } else if (s.edgeKey !== undefined) {
        // 表と同じ。元のエッジ ID がすべて選択中なら外し、そうでなければ足す（D-40）。
        const ids = edgeIdsOf(s.edgeKey);
        if (ids.length > 0 && ids.every((id) => sel.edges.has(id))) sel.remove({ edges: ids });
        else sel.add({ edges: ids });
      }
    },
    cancel,
  };
}
