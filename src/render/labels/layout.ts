/** ラベルの重なりを減らす配置（FR-VG-10、設計§8.6）。 */
import type { NodeId } from '../../core/model';
import type { SceneLabel, SceneNode } from '../scene/types';
import { estimateTextWidth } from '../text/width';

/** 候補から採用したラベルと、重なりで隠したノード ID。 */
export interface LabelPlacement {
  readonly visible: readonly SceneLabel[];
  readonly hidden: readonly NodeId[];
}
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * 大きいノードのラベルを優先し、既に採用したラベルとの重なりを避ける。
 *
 * 手順: 文字幅を測り矩形化→大きさ順の貪欲法→採用した矩形を格子に登録。
 * セル寸法は中央値から決め、1件の長文で格子全体を粗くしない。各矩形の全区画を登録する。
 * 64区画を超える矩形や安全な整数で表せない区画は別索引で全採用矩形と照合し、巨大座標でも終了する。
 * 平均 O(N log N + 比較数)、最悪 O(N²)（同じ区画に候補が集中する場合）。領域 O(N)。
 * @param labels - 表示設定で選んだ候補（空ラベルを含まない）
 * @param nodes - シーンのノード。半径を優先度に使う
 * @param measureWidth - 同じフォントで文字の幅を測る関数
 * @returns 採用ラベルは元の順番、隠したノードも元の順番で返す
 */
export function placeLabels(
  labels: readonly SceneLabel[],
  nodes: readonly SceneNode[],
  measureWidth: (text: string) => number,
): LabelPlacement {
  const radii = new Map(nodes.map((n) => [n.id, n.r]));
  // 【TS】map の戻り値を明示し、番号と矩形を取り違えないようにする。
  const boxes: readonly Box[] = labels.map((label) => {
    const measured = measureWidth(label.text);
    const width =
      Number.isFinite(measured) && measured >= 0
        ? measured
        : estimateTextWidth(label.text, label.fontSize);
    const left = label.anchor === 'right' ? label.x - width : label.x;
    return {
      left: left - 2,
      right: left + width + 2,
      top: label.y - label.fontSize - 2,
      bottom: label.y + label.fontSize * 0.3 + 2,
    };
  });
  const medianSize = (sizes: readonly number[], minimum: number, maximum: number): number => {
    const finite = sizes.filter((size) => Number.isFinite(size) && size > 0).sort((a, b) => a - b);
    return Math.min(maximum, Math.max(minimum, finite[Math.floor(finite.length / 2)] ?? minimum));
  };
  const cellWidth = medianSize(
    boxes.map((box) => box.right - box.left),
    32,
    512,
  );
  const cellHeight = medianSize(
    boxes.map((box) => box.bottom - box.top),
    16,
    128,
  );
  const grid = new Map<string, Box[]>();
  const largeBoxes: Box[] = [];
  const accepted: Box[] = [];
  const shown = new Set<number>();
  const ordered = labels.map((label, index) => ({
    index,
    radius: label.nodeId === null ? 0 : (radii.get(label.nodeId) ?? 0),
  }));
  ordered.sort((a, b) => b.radius - a.radius || a.index - b.index);
  const overlap = (a: Box, b: Box) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const cells = (box: Box): readonly string[] | null => {
    const x0 = Math.floor(box.left / cellWidth);
    const x1 = Math.floor(box.right / cellWidth);
    const y0 = Math.floor(box.top / cellHeight);
    const y1 = Math.floor(box.bottom / cellHeight);
    const columns = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    // 【なぜ】巨大値でx++が丸められる無限ループと、長文による大量区画の確保を避ける。
    if (
      ![x0, x1, y0, y1].every(Number.isSafeInteger) ||
      columns < 1 ||
      rows < 1 ||
      columns * rows > 64
    )
      return null;
    const keys: string[] = [];
    for (let column = 0; column < columns; column++)
      for (let row = 0; row < rows; row++) keys.push(String(x0 + column) + ':' + String(y0 + row));
    return keys;
  };
  for (const { index } of ordered) {
    const box = boxes[index];
    if (box === undefined) continue;
    const keys = cells(box);
    const candidates =
      keys === null
        ? accepted
        : new Set([...largeBoxes, ...keys.flatMap((key) => grid.get(key) ?? [])]);
    let collision = false;
    for (const other of candidates)
      if (overlap(box, other)) {
        collision = true;
        break;
      }
    if (collision) continue;
    shown.add(index);
    accepted.push(box);
    if (keys === null) largeBoxes.push(box);
    else
      for (const key of keys) {
        const bucket = grid.get(key) ?? [];
        bucket.push(box);
        grid.set(key, bucket);
      }
  }
  const visible: SceneLabel[] = [];
  const hidden: NodeId[] = [];
  for (const [index, label] of labels.entries()) {
    if (shown.has(index)) visible.push(label);
    else if (label.nodeId !== null) hidden.push(label.nodeId);
  }
  return { visible, hidden };
}
