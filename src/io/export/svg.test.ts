import Graph from 'graphology';
import { afterEach, expect, it, vi } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId } from '../../core/model';
import { createSvgExport, downloadSvg } from './svg';

const a = toNodeId('a');
const b = toNodeId('b');
function graph(): RelataGraph {
  const result: RelataGraph = new Graph({ type: 'mixed', multi: false });
  result.addNode(a, { label: 'محمد & 東京', type: toNodeTypeId('person') });
  result.addNode(b, { label: '<label>', type: toNodeTypeId('person') });
  result.addEdgeWithKey('edge', a, b, {
    weight: 1,
    count: 1,
    edgeIds: [],
    directed: false,
    missingWeightCount: 0,
  });
  return result;
}
const positions = new Map([
  [a, { x: -500, y: 400 }],
  [b, { x: 700, y: -300 }],
]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('FR-OUT-01: UTF-8 の単独の SVG に全体と編集用グループ、凡例、RTL ラベルを保存する', async () => {
  const output = createSvgExport(
    graph(),
    positions,
    {},
    {
      title: '<題名>',
      legend: { title: '凡例', items: [{ label: '人物', fill: '#0072b2' }] },
      measureText: (text) => text.length * 12,
    },
  );
  const svg = await output.blob.text();
  expect(output.blob.type).toBe('image/svg+xml;charset=utf-8');
  expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  for (const group of ['nodes', 'edges', 'labels', 'legend'])
    expect(svg).toContain('<g id="' + group + '"');
  expect(svg).toContain('viewBox="0 0 ' + String(output.width) + ' ' + String(output.height) + '"');
  expect(output.width).toBeGreaterThan(1200);
  expect(output.height).toBeGreaterThan(700);
  expect(svg).toContain('محمد &amp; 東京');
  expect(svg).toContain('direction="rtl"');
  expect(svg).toContain('&lt;題名&gt;');
  expect(svg).toContain('&lt;label&gt;');
  expect(svg).not.toContain('transform=');
  expect(svg).not.toContain('<script');
  expect(output.omitted.nodesWithoutPosition).toEqual([]);
});

it('FR-OUT-01 / D-31: 選択の強調は既定で含めず、指定したときだけ含める', async () => {
  const selected = new Set([a]);
  const normal = await createSvgExport(graph(), positions, {}, { selected }).blob.text();
  const highlighted = await createSvgExport(
    graph(),
    positions,
    {},
    { selected, includeSelection: true },
  ).blob.text();
  expect(normal).not.toContain('class="selected"');
  expect(highlighted).toContain('class="selected"');
});

it('FR-OUT-01: 位置のないノードを報告し、空のグラフも開ける SVG を返す', async () => {
  const output = createSvgExport(graph(), new Map());
  expect(output.omitted.nodesWithoutPosition).toEqual([a, b]);
  expect(output.omitted.edgesWithoutEndpoint).toBe(1);
  expect(output.width).toBeGreaterThan(0);
  expect(await output.blob.text()).toContain('</svg>');
});

it('FR-OUT-01 / NFR-02: ローカル Blob を保存し、開始の猶予の後に URL を解放する', () => {
  vi.useFakeTimers();
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-svg');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal('document', { createElement: () => anchor, body: { append } });
  const output = createSvgExport(graph(), positions);
  downloadSvg(output, 'figure');
  expect(create).toHaveBeenCalledWith(output.blob);
  expect(anchor.download).toBe('figure.svg');
  expect(anchor.href).toBe('blob:local-svg');
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10_000);
  expect(revoke).toHaveBeenCalledWith('blob:local-svg');
});

it('FR-OUT-01 / D-31: ノードより太いエッジも余白を残して全体を SVG に収める', async () => {
  const output = createSvgExport(
    graph(),
    new Map([
      [a, { x: 0, y: 0 }],
      [b, { x: 0, y: 100 }],
    ]),
    { widths: new Map([['edge', { width: 200, missing: false }]]) },
    { labels: 'selected' },
  );
  // 線幅 200 に左右の既定余白 24 が必要。ノードだけの範囲（約 61）では切れてしまう。
  expect(output.width).toBeGreaterThanOrEqual(248);
  const svg = await output.blob.text();
  const path = /d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"/u.exec(svg);
  expect(path).not.toBeNull();
  const x = Number(path?.[1]);
  expect(x - 100).toBeGreaterThanOrEqual(24);
  expect(x + 100).toBeLessThanOrEqual(output.width - 24);
});

it('FR-OUT-01 / NFR-02: 保存リンクの生成に失敗しても Blob URL を解放する', () => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-svg');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.stubGlobal('document', {
    createElement: () => {
      throw new Error('failed');
    },
  });
  expect(() => {
    downloadSvg(createSvgExport(graph(), positions));
  }).toThrow('failed');
  vi.advanceTimersByTime(10_000);
  expect(revoke).toHaveBeenCalledWith('blob:failed-svg');
});

it.each([
  [undefined, 'relata.svg'],
  ['', 'relata.svg'],
  [' \t\n ', 'relata.svg'],
  [' figure ', 'figure.svg'],
  [' figure.SVG ', 'figure.SVG'],
])('FR-OUT-01: 保存名の前後の空白を除き空なら既定名を使う (%s)', (fileName, expected) => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:named-svg');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => anchor, body: { append: vi.fn() } });
  downloadSvg(createSvgExport(graph(), positions), fileName);
  expect(anchor.download).toBe(expected);
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(10_000);
});

it('FR-TM-02 / D-38: 再生の薄い表示を渡すと、書き出しのシーンと SVG でも薄く描く。渡さなければ通常の図', () => {
  const plain = createSvgExport(graph(), positions);
  expect(plain.svg).not.toContain('data-out-of-time');
  const faded = createSvgExport(
    graph(),
    positions,
    {},
    {
      timeFade: { nodes: new Set([a]), edges: new Set(['edge']) },
    },
  );
  expect(faded.scene.nodes.find((n) => n.id === a)?.faded).toBe(true);
  expect(faded.scene.nodes.find((n) => n.id === b)?.faded).toBeUndefined();
  expect(faded.scene.edges[0]?.faded).toBe(true);
  // ノード a とそのラベル、エッジの 3 か所に印が付く（PNG はこの SVG から、PDF はこのシーンから作る）。
  expect(faded.svg.match(/data-out-of-time="true"/g)?.length).toBe(3);
});
