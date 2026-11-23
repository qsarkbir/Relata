import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId } from '../../core/model';
import { buildScene } from '../scene/build';
import { renderSvg } from '../svg/render';
import { buildPdf, pdfString } from './document';
import { parseGlyphPath } from './outline';
import type { TextOutliner } from './outline';
import { PX_TO_PT, renderPdfContent } from './scenePdf';

// 【なぜ】フォントを使わない代役。1 文字 = 幅 fontSize の四角形を返す（整形の中身は io のテストで確かめる）。
const boxes: TextOutliner = (text, size) => ({
  width: Array.from(text).length * size,
  commands: Array.from(text).flatMap((_, i) => [
    { type: 'M' as const, x: i * size, y: 0 },
    { type: 'L' as const, x: i * size + size, y: 0 },
    { type: 'L' as const, x: i * size + size, y: -size },
    { type: 'Z' as const },
  ]),
});

const type = toNodeTypeId('t');
function graph(): RelataGraph {
  const g: RelataGraph = new Graph({ type: 'mixed', multi: false });
  g.addNode('a', { label: 'ابن', type });
  g.addNode('b', { label: 'B', type });
  g.addDirectedEdgeWithKey('e', 'a', 'b', {
    weight: 1,
    count: 1,
    edgeIds: [],
    missingWeightCount: 0,
    directed: true,
  });
  return g;
}
const positions = new Map([
  [toNodeId('a'), { x: 0, y: 0 }],
  [toNodeId('b'), { x: 200, y: 0 }],
]);

describe('FR-OUT-04: PDF の部品', () => {
  it('SVG のパス文字列を、倍率・y 反転・平行移動をして命令にする', () => {
    const out = parseGlyphPath('M0 0L100 0Q100 100 0 100C1 2 3 4 5 6Z', 0.01, 10, 20);
    expect(out).toEqual([
      { type: 'M', x: 10, y: 20 },
      { type: 'L', x: 11, y: 20 },
      { type: 'Q', cx: 11, cy: 19, x: 10, y: 19 },
      { type: 'C', c1x: 10.01, c1y: 19.98, c2x: 10.03, c2y: 19.96, x: 10.05, y: 19.94 },
      { type: 'Z' },
    ]);
    expect(parseGlyphPath('', 1, 0, 0)).toEqual([]);
  });
  it('題名: ASCII は丸括弧、日本語とアラビア文字は UTF-16BE の 16 進（BOM つき）', () => {
    expect(pdfString('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(pdfString('日')).toBe('<FEFF65E5>');
    expect(pdfString('ب')).toBe('<FEFF0628>');
  });
  it('ページの大きさは図の大きさの 0.75 倍（px から pt）で、先頭で y を反転する', () => {
    const scene = buildScene(graph(), positions, {}, {});
    const c = renderPdfContent(scene, { outline: boxes });
    expect(c.widthPt).toBeCloseTo(scene.width * PX_TO_PT, 9);
    expect(c.stream.startsWith(`0.75 0 0 -0.75 0 ${String(c.heightPt)} cm`)).toBe(true);
    expect(c.stream).not.toMatch(/NaN|Infinity/);
  });
  it('描く順は SVG と同じ: 背景、エッジ、ノード、ラベル。背景の色は 0〜1 の rg', () => {
    const scene = buildScene(graph(), positions, {}, {});
    const c = renderPdfContent(scene, { background: '#ff8000', outline: boxes });
    const lines = c.stream.split('\n');
    expect(lines[1]).toMatch(/^1 0\.502 0 rg 0 0 /);
    // エッジの線（S）が、ノードの塗り（B）より前にある
    expect(lines.indexOf('S')).toBeGreaterThan(0);
    expect(lines.indexOf('S')).toBeLessThan(lines.indexOf('B'));
  });
  it('矢じりの多角形（塗り f）がエッジごとに 1 つ、ノードは円の 4 本のベジェ', () => {
    const scene = buildScene(graph(), positions, {}, {});
    const c = renderPdfContent(scene, { outline: boxes });
    expect(c.stream.match(/ c\n/g)?.length).toBeGreaterThanOrEqual(8); // 2 ノード × 4
    expect(scene.edges[0]?.head).toBeDefined();
    expect(c.stream).toContain('\nf\n');
  });
  it('欠損の破線は SVG と同じ間隔: ノード 3 2 と 6 3', () => {
    const base = buildScene(graph(), positions, {}, {});
    const scene = {
      ...base,
      nodes: base.nodes.map((n, i) =>
        i === 0 ? { ...n, dashed: true } : { ...n, dashed: true, attrMissing: true },
      ),
    };
    const c = renderPdfContent(scene, { outline: boxes });
    expect(c.stream).toContain('[3 2] 0 d');
    expect(c.stream).toContain('[6 3] 0 d');
    const svg = renderSvg(scene);
    expect(svg).toContain('stroke-dasharray="3 2"');
    expect(svg).toContain('stroke-dasharray="6 3"');
  });
  it('NFR-09: 右から左のラベルは、x が右端なので、幅の分だけ左から始まる', () => {
    const scene = buildScene(graph(), positions, {}, {});
    const label = scene.labels.find((l) => l.direction === 'rtl');
    expect(label).toBeDefined();
    if (label === undefined) return;
    expect(label.anchor).toBe('right');
    const c = renderPdfContent(scene, { outline: boxes });
    const width = Array.from(label.text).length * label.fontSize;
    const left = label.x - width;
    // 輪郭の最初の点（M）が、左端の x とベースラインの y にある
    expect(c.stream).toContain(
      `${String(Math.round(left * 1000) / 1000)} ${String(Math.round(label.y * 1000) / 1000)} m`,
    );
  });
  it('凡例の見本: 矢印は線と塗りの多角形、線の破線は 4 3 と 9 4。SVG も同じ', () => {
    const scene = buildScene(
      graph(),
      positions,
      {},
      {
        legend: {
          items: [
            { label: '有向', fill: '#666666', mark: 'arrow', lineWidth: 2 },
            { label: '欠損', fill: '#666666', mark: 'line', dashed: true },
            { label: '欠損 2', fill: '#666666', mark: 'line', dashed: true, attrMissing: true },
            { label: '見出し', fill: '#000000', mark: 'none', bold: true },
          ],
        },
      },
    );
    const c = renderPdfContent(scene, { outline: boxes });
    expect(c.stream).toContain('[4 3] 0 d');
    expect(c.stream).toContain('[9 4] 0 d');
    const svg = renderSvg(scene);
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(svg).toContain('stroke-dasharray="9 4"');
    expect(svg).toContain('font-weight="bold"');
    // 矢印の見本: 線の先に多角形の矢じり（長さ max(6, 3w) = 6）
    const legend = scene.legend;
    const arrow = legend?.items[0]?.swatch;
    expect(arrow).toMatchObject({ mark: 'arrow', lineWidth: 2 });
    expect(svg).toMatch(/<polygon points="[^"]+" fill="#666666"\/>/);
  });
  it('PDF のファイル: xref の位置が正しく、圧縮の関数を渡すと FlateDecode になる', async () => {
    const scene = buildScene(graph(), positions, {}, {});
    const content = renderPdfContent(scene, { outline: boxes });
    const bytes = await buildPdf(content, { title: 'x' });
    const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    expect(text).not.toContain('FlateDecode');
    const packed = await buildPdf(content, {}, (d) => Promise.resolve(d.slice(0, 10)));
    expect(Array.from(packed, (b) => String.fromCharCode(b)).join('')).toContain(
      '/Filter /FlateDecode',
    );
  });
});
