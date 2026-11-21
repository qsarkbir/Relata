import Graph from 'graphology';
import { expect, it, vi } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId } from '../../core/model';
import { buildScene } from '../scene';
import { placeLabels } from './layout';

const a = toNodeId('a');
const b = toNodeId('b');
const c = toNodeId('c');
const type = toNodeTypeId('person');
function graph(): RelataGraph {
  const g: RelataGraph = new Graph();
  for (const [id, label] of [
    [a, 'small'],
    [b, 'large'],
    [c, 'محمد'],
  ] as const)
    g.addNode(id, { label, type });
  return g;
}
const sizes = new Map([
  [a, { size: 3, missing: false }],
  [b, { size: 10, missing: false }],
  [c, { size: 5, missing: false }],
]);
const pos = new Map([
  [a, { x: 0, y: 0 }],
  [b, { x: 0, y: 0 }],
  [c, { x: 0, y: 0 }],
]);

it('FR-VG-10: 重なるラベルは大きいノードを残す。RTLは左側なので両立できる', () => {
  const scene = buildScene(graph(), pos, { sizes }, { measureText: () => 60 });
  expect(scene.labels.map((l) => l.nodeId)).toEqual([b, c]);
  expect(scene.hiddenLabels).toEqual([a]);
  expect(scene.labels[1]).toMatchObject({ direction: 'rtl', anchor: 'right' });
});

it('FR-VG-10: 同じ大きさは入力順を優先し、隠した結果も再現する', () => {
  const g = graph();
  g.setNodeAttribute(c, 'label', 'third');
  const first = buildScene(g, pos, {}, { measureText: () => 60 });
  const second = buildScene(g, pos, {}, { measureText: () => 60 });
  expect(first.labels.map((l) => l.nodeId)).toEqual([a]);
  expect(first.hiddenLabels).toEqual([b, c]);
  expect(first).toEqual(second);
});

it('FR-VG-10: 選択中のみ・大きいノードのみを候補にしてから衝突を減らす', () => {
  const selected = buildScene(
    graph(),
    pos,
    { sizes },
    { labels: 'selected', selected: new Set([a]), measureText: () => 60 },
  );
  expect(selected.labels.map((l) => l.nodeId)).toEqual([a]);
  expect(selected.hiddenLabels).toEqual([]);
  const large = buildScene(graph(), pos, { sizes }, { labels: 'large', largeLabelCount: 1 });
  expect(large.labels.map((l) => l.nodeId)).toEqual([b]);
  // 選択の強調を含めない設定でも、選択中ラベルの候補は消さない。
  expect(selected.nodes.every((n) => !n.selected)).toBe(true);
});

it('FR-VG-10: 実測幅と隙間を使い、別の区画に跨る衝突も見逃さない', () => {
  const labels = [
    { nodeId: a, text: 'a', x: 30, y: 20, fontSize: 12, direction: 'ltr', anchor: 'left' },
    { nodeId: b, text: 'b', x: 40, y: 20, fontSize: 12, direction: 'ltr', anchor: 'left' },
    { nodeId: c, text: 'c', x: 100, y: 20, fontSize: 12, direction: 'ltr', anchor: 'left' },
  ] as const;
  expect(placeLabels(labels, [], () => 20).hidden).toEqual([b]);
  expect(placeLabels(labels, [], () => 1).hidden).toEqual([]);
});

it('FR-VG-10: 測定失敗は見積もりに戻し、極端な座標でも終了する', () => {
  const labels = [
    { nodeId: a, text: 'long', x: 1e20, y: 1e20, fontSize: 12, direction: 'ltr', anchor: 'left' },
  ] as const;
  expect(placeLabels(labels, [], () => NaN).visible).toHaveLength(1);
  const scene = buildScene(graph(), pos, { sizes }, { measureText: () => Infinity });
  expect(scene.labels).not.toHaveLength(0);
  expect(Number.isFinite(scene.width)).toBe(true);
});

it('FR-VG-10: 非衝突ラベルの描画順を入力順に保ち、大きさ順へ並べ替えない', () => {
  const scene = buildScene(
    graph(),
    new Map([
      [a, { x: 0, y: 0 }],
      [b, { x: 300, y: 0 }],
      [c, { x: 600, y: 0 }],
    ]),
    { sizes },
  );
  expect(scene.labels.map((l) => l.nodeId)).toEqual([a, b, c]);
  expect(scene.hiddenLabels).toEqual([]);
});

it('FR-VG-10: 同じ文字列の幅は衝突判定と範囲計算で1回だけ実測する', () => {
  const g = graph();
  g.setNodeAttribute(a, 'label', 'same');
  g.setNodeAttribute(b, 'label', 'same');
  g.setNodeAttribute(c, 'label', 'same');
  const measureText = vi.fn(() => 60);
  buildScene(
    g,
    new Map([
      [a, { x: 0, y: 0 }],
      [b, { x: 300, y: 0 }],
      [c, { x: 600, y: 0 }],
    ]),
    {},
    { measureText },
  );
  expect(measureText).toHaveBeenCalledExactlyOnceWith('same', '12px sans-serif');
});

it('FR-VG-10 / FR-OUT-01: 非衝突のLTR・RTLラベル全体を余白つきviewBoxへ収める', () => {
  const scene = buildScene(
    graph(),
    new Map([
      [a, { x: -300, y: -100 }],
      [b, { x: 0, y: 100 }],
      [c, { x: 300, y: 0 }],
    ]),
    { sizes },
    { measureText: () => 60 },
  );
  expect(scene.labels).toHaveLength(3);
  for (const label of scene.labels) {
    const left = label.anchor === 'right' ? label.x - 60 : label.x;
    expect(left).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(left + 60).toBeLessThanOrEqual(scene.width - 24 + 1e-9);
    expect(label.y - label.fontSize).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(label.y + label.fontSize * 0.3).toBeLessThanOrEqual(scene.height - 24 + 1e-9);
  }
});
