import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, pngSize } from './png';
import { withExtension } from './download';
import Graph from 'graphology';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId } from '../../core/model';
import { buildBundleGraph } from '../../render/bundling';
import { createSvgExport } from './svg';

describe('FR-OUT-03: PNG の大きさ', () => {
  it('倍率に従って画素数が決まる（1×、2×、4×）', () => {
    expect(pngSize(1000, 500, 1)).toEqual({ width: 1000, height: 500, scale: 1, clamped: false });
    expect(pngSize(1000, 500, 2)).toMatchObject({ width: 2000, height: 1000, scale: 2 });
    expect(pngSize(1000, 500, 4)).toMatchObject({ width: 4000, height: 2000, clamped: false });
  });
  it('小数の大きさは切り上げる（端が欠けない）', () => {
    expect(pngSize(100.2, 50.5, 2)).toMatchObject({ width: 201, height: 101 });
  });
  it('canvas の上限（辺と面積）を超えるときは倍率を下げ、clamped で知らせる', () => {
    const huge = pngSize(6000, 4000, 4);
    expect(huge.clamped).toBe(true);
    expect(huge.scale).toBeLessThan(4);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(huge.width / huge.height).toBeCloseTo(1.5, 2);
    const wide = pngSize(10000, 100, 4);
    expect(wide.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(wide.clamped).toBe(true);
  });
  it('面積の上限は Safari に合わせた 16,777,216 px（4096 × 4096）', () => {
    expect(MAX_CANVAS_AREA).toBe(4096 * 4096);
    const big = pngSize(3000, 2000, 4);
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(big.clamped).toBe(true);
  });
  it('大きさが 0 や負でも、1 画素以上にする', () => {
    expect(pngSize(0, -5, 2)).toMatchObject({ width: 2, height: 2 });
  });
  it('FR-OUT-01: ファイル名に拡張子を付ける（二重に付けない、空は既定の名前）', () => {
    expect(withExtension('図', 'png')).toBe('図.png');
    expect(withExtension('a.PNG', 'png')).toBe('a.PNG');
    expect(withExtension('  ', 'pdf')).toBe('relata.pdf');
  });
});

describe('FR-VG-13: 束ねた図の書き出し', () => {
  it('同じシーンの SVG に帯の層が入り、PNG の大きさは SVG の寸法から決まる', () => {
    const a = toNodeId('a');
    const b = toNodeId('b');
    const graph: RelataGraph = new Graph({ type: 'mixed', multi: false });
    graph.addNode(a, { label: 'A', type: toNodeTypeId('t') });
    graph.addNode(b, { label: 'B', type: toNodeTypeId('t') });
    graph.addEdgeWithKey('e', a, b, {
      weight: 2,
      count: 1,
      edgeIds: [],
      directed: false,
      missingWeightCount: 0,
    });
    const points = Array.from({ length: 9 }, (_, i) => [i * 25, 0]).flat();
    const paths = [{ id: 'e', points, bundled: true, directed: false }];
    const out = createSvgExport(
      graph,
      new Map([
        [a, { x: 0, y: 0 }],
        [b, { x: 200, y: 0 }],
      ]),
      {},
      { bundled: { paths, graph: buildBundleGraph(paths, [{ id: 'e', weight: 2 }]) } },
    );
    expect(out.svg).toContain('<g id="bundles"');
    expect(out.scene.bundle?.ribbons).toHaveLength(1);
    expect(pngSize(out.width, out.height, 2)).toMatchObject({ clamped: false });
  });
});
