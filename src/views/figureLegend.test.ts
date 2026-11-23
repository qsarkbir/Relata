import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../core/graph';
import { DEFAULT_ENCODING } from '../core/encode';
import { toNodeId, toNodeTypeId, type Dataset } from '../core/model';
import { DEFAULT_EDGE_COLOR, DEFAULT_EDGE_OPACITY, buildScene } from '../render';
import type { Scene } from '../render';
import { buildFigureLegend, clipText, CREDIT_MAX_CHARS } from './figureLegend';
import type { FigureLegendInput } from './figureLegend';
import type { EncodingLegends } from './graphEncoding';

const person = toNodeTypeId('person');
const place = toNodeTypeId('place');
const dataset: Dataset = {
  graphMode: 'mixed',
  nodeTypes: [
    { id: person, label: '人物' },
    { id: place, label: 'مكان' },
  ],
  nodes: [],
  edges: [],
  schema: [{ key: 'rank', label: '順位', appliesTo: 'node', valueType: 'number' }],
  meta: { title: 'データ名' },
};
function graph(directed: boolean, undirected = false): RelataGraph {
  const g: RelataGraph = new Graph({ type: 'mixed', multi: false });
  g.addNode('a', { label: 'A', type: person });
  g.addNode('b', { label: 'B', type: person });
  const base = { weight: 1, count: 1, edgeIds: [], missingWeightCount: 0 };
  if (directed) g.addDirectedEdgeWithKey('e1', 'a', 'b', { ...base, directed: true });
  if (undirected) g.addUndirectedEdgeWithKey('e2', 'b', 'a', { ...base, directed: false });
  return g;
}
const noLegends: EncodingLegends = { size: null, width: null, color: { kind: 'nodeType' } };
const positions = new Map([
  [toNodeId('a'), { x: 0, y: 0 }],
  [toNodeId('b'), { x: 100, y: 0 }],
]);
// 【なぜ】翻訳関数の代わりに、キーと差し込みを文字列にする。文言ではなく、どの項目が出たかを確かめる。
const t: FigureLegendInput['t'] = (key, params) =>
  params === undefined ? key : `${key}${JSON.stringify(params)}`;

function input(over: Partial<FigureLegendInput> = {}, g: RelataGraph = graph(true)) {
  const scene: Scene = buildScene(g, positions, {}, {});
  return {
    t,
    formatNumber: (n: number) => String(n),
    dataset,
    graph: g,
    settings: DEFAULT_ENCODING,
    encoding: {
      typeColors: new Map([[person, '#0072b2']]),
      shapes: new Map([[person, 'square' as const]]),
    },
    legends: noLegends,
    directedStyle: 'arrow' as const,
    scene,
    legend: true,
    ...over,
  } satisfies FigureLegendInput;
}
const labels = (spec: ReturnType<typeof buildFigureLegend>) => spec?.items.map((i) => i.label);

describe('FR-OUT-07: 書き出しの凡例の組み立て', () => {
  it('凡例も出典表記も選ばなければ、何も作らない', () => {
    expect(buildFigureLegend(input({ legend: false }))).toBeUndefined();
  });
  it('ノードの型は、図に現れる型だけを、型の色と形で出す', () => {
    const spec = buildFigureLegend(input());
    expect(spec?.title).toBe('legend.title');
    const type = spec?.items.find((i) => i.label === '人物');
    expect(type).toMatchObject({ fill: '#0072b2', shape: 'square' });
    expect(labels(spec)).not.toContain('مكان'); // 図に無い型は出さない
  });
  it('D-07: 有向エッジは既定の矢印の見本。無向があれば無向の線も出す', () => {
    const spec = buildFigureLegend(input({}, graph(true, true)));
    expect(spec?.items.find((i) => i.label === 'legend.directed.arrow')).toMatchObject({
      mark: 'arrow',
    });
    expect(spec?.items.find((i) => i.label === 'legend.undirected')).toMatchObject({
      mark: 'line',
    });
    // 有向だけなら、無向の行は無い。先細りと濃淡は、見本の線ではなく説明の行になる。
    expect(labels(buildFigureLegend(input()))).not.toContain('legend.undirected');
    const taper = buildFigureLegend(input({ directedStyle: 'taper' }));
    expect(taper?.items.find((i) => i.label === 'legend.directed.taper')).toMatchObject({
      mark: 'taper',
    });
    const gradient = buildFigureLegend(input({ directedStyle: 'gradient' }));
    expect(gradient?.items.find((i) => i.label === 'legend.directed.gradient')).toMatchObject({
      mark: 'gradient',
    });
    // 線の見本は、図のエッジと同じ色と不透明度（凡例と図の見え方を一致させる）。
    const arrow = spec?.items.find((i) => i.label === 'legend.directed.arrow');
    expect(arrow).toMatchObject({ fill: DEFAULT_EDGE_COLOR, opacity: DEFAULT_EDGE_OPACITY });
  });
  it('D-42: 欠損の破線は、図に現れた種類だけを、粗さを変えて出す', () => {
    const none = buildFigureLegend(input());
    expect(labels(none)).not.toContain('legend.missing');
    const g = graph(true);
    const base = buildScene(g, positions, {}, {});
    const withMissing: Scene = {
      ...base,
      nodes: base.nodes.map((n, i) => ({
        ...n,
        dashed: true,
        ...(i === 0 ? { attrMissing: true } : {}),
      })),
      edges: base.edges.map((e) => ({ ...e, dashed: true })),
    };
    const spec = buildFigureLegend(input({ scene: withMissing }, g));
    const byLabel = (l: string) => spec?.items.find((i) => i.label === l);
    expect(byLabel('legend.missing.nodeValue')).toMatchObject({ dashed: true });
    expect(byLabel('legend.missing.nodeValue')?.attrMissing).toBeUndefined();
    expect(byLabel('legend.missing.nodeAttr')).toMatchObject({ dashed: true, attrMissing: true });
    expect(byLabel('legend.missing.edgeValue')).toMatchObject({ mark: 'line', dashed: true });
    expect(byLabel('legend.missing.edgeAttr')).toBeUndefined();
  });
  it('FR-VG-03: 大きさと太さの凡例は、割り当ての代表値と大きさをそのまま使う', () => {
    const ticks = [
      { value: 1, size: 4 },
      { value: 9, size: 12 },
    ];
    const scale = {
      kind: 'sqrt' as const,
      domain: { min: 1, max: 9 },
      range: { min: 4, max: 12 },
      negativeCount: 0,
      missingCount: 0,
      ticks,
    };
    const spec = buildFigureLegend(
      input({
        settings: {
          ...DEFAULT_ENCODING,
          nodeSize: { source: { kind: 'attr', attr: 'rank' }, scale: 'sqrt', min: 4, max: 12 },
        },
        legends: {
          ...noLegends,
          size: scale,
          width: { ...scale, range: { min: 1, max: 4 }, ticks: [{ value: 2, size: 3 }] },
        },
      }),
    );
    expect(labels(spec)).toContain('legend.nodeSize{"name":"順位"}');
    const sizes = spec?.items.filter(
      (i) => i.mark === undefined && i.fill === '#999999' && i.r !== undefined,
    );
    expect(sizes?.map((i) => [i.label, i.r])).toEqual([
      ['1', 4],
      ['9', 12],
    ]);
    expect(spec?.items.find((i) => i.mark === 'line' && i.label === '2')).toMatchObject({
      lineWidth: 3,
    });
  });
  it('出典表記: データ名・出典・作成日・「Relata で作成」。データ名は長ければ切る', () => {
    const spec = buildFigureLegend(
      input({
        legend: false,
        credit: { title: 'あ'.repeat(100), source: '短い出典', date: '2026-11-23' },
      }),
    );
    expect(spec?.title).toBeUndefined();
    expect(labels(spec)).toEqual([
      `legend.credit.data{"title":"${'あ'.repeat(CREDIT_MAX_CHARS - 1)}…"}`,
      'legend.credit.source{"source":"短い出典"}',
      'legend.credit.date{"date":"2026-11-23"}',
      'legend.credit.tool',
    ]);
    expect(spec?.items.every((i) => i.mark === 'none')).toBe(true);
  });
  it('出典の欄は短い引用だけ: 長い説明文は省き、データ名と作成日は残す', () => {
    const spec = buildFigureLegend(
      input({
        legend: false,
        credit: { title: 'データ名', source: 'あ'.repeat(200), date: '2026-11-23' },
      }),
    );
    expect(labels(spec)).toEqual([
      'legend.credit.data{"title":"データ名"}',
      'legend.credit.date{"date":"2026-11-23"}',
      'legend.credit.tool',
    ]);
  });
  it('clipText は、サロゲートペアの文字を途中で切らない', () => {
    expect(clipText('𓂀𓂀𓂀', 2)).toBe('𓂀…');
    expect(clipText('abc', 3)).toBe('abc');
    // 結合記号（h + U+0323 = ḥ）を、土台と離して切らない。
    expect(clipText('t\u0323ab', 2)).toBe('t\u0323…');
  });
});
