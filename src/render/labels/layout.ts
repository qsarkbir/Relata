/** ラベルの重なりを減らす配置（FR-VG-10、設計§8.6）。 */
import type { NodeId } from '../../core/model';
import type { SceneLabel, SceneNode } from '../scene/types';

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
 * 各矩形が最大4区画に収まるセル寸法を使い、長いアラビア文字のラベルでも区画数を膨張させない。
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
        : label.text.length * label.fontSize * 0.6;
    const left = label.anchor === 'right' ? label.x - width : label.x;
    return {
      left: left - 2,
      right: left + width + 2,
      top: label.y - label.fontSize - 2,
      bottom: label.y + label.fontSize * 0.3 + 2,
    };
  });
  const cellWidth = boxes.reduce((size, b) => Math.max(size, b.right - b.left), 32);
  const cellHeight = boxes.reduce((size, b) => Math.max(size, b.bottom - b.top), 16);
  const grid = new Map<string, Box[]>();
  const shown = new Set<number>();
  const ordered = labels.map((label, index) => ({
    index,
    radius: label.nodeId === null ? 0 : (radii.get(label.nodeId) ?? 0),
  }));
  ordered.sort((a, b) => b.radius - a.radius || a.index - b.index);
  const overlap = (a: Box, b: Box) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const { index } of ordered) {
    const box = boxes[index];
    if (box === undefined) continue;
    const keys: string[] = [];
    // 端の区画を列挙する。巨大な座標で x++ が丸められて進まないループも避ける。
    for (const x of new Set([
      Math.floor(box.left / cellWidth),
      Math.floor(box.right / cellWidth),
    ])) {
      for (const y of new Set([
        Math.floor(box.top / cellHeight),
        Math.floor(box.bottom / cellHeight),
      ]))
        keys.push(String(x) + ':' + String(y));
    }
    if (keys.some((key) => (grid.get(key) ?? []).some((other) => overlap(box, other)))) continue;
    shown.add(index);
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
