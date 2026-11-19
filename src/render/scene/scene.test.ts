import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId, type NodeId } from '../../core/model';
import { buildScene, shapeExtent } from './index';
import { detectDirection } from '../text/direction';

const person = toNodeTypeId('person');
const place = toNodeTypeId('place');
const id = (s: string): NodeId => toNodeId(s);

function makeGraph(
  nodes: [string, string, string?][],
  edges: [string, string, string, boolean?][] = [],
): RelataGraph {
  const g: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
  for (const [n, label, t] of nodes) g.addNode(n, { label, type: t === 'place' ? place : person });
  for (const [k, s, t, d] of edges)
    g.addEdgeWithKey(k, s, t, {
      weight: 1,
      count: 1,
      edgeIds: [],
      directed: d ?? false,
      missingWeightCount: 0,
    });
  return g;
}
// 偽の幅の測定: 1 文字 10px
const measure = (text: string): number => text.length * 10;

describe('FR-VG-03: シーンの範囲', () => {
  const g = makeGraph([
    ['a', 'A'],
    ['b', 'B'],
    ['c', 'C'],
  ]);
  const pos = new Map([
    [id('a'), { x: -100, y: 50 }],
    [id('b'), { x: 300, y: -20 }],
    [id('c'), { x: 10, y: 400 }],
  ]);
  it('すべてのノードが、余白を残して範囲に収まる', () => {
    const sc = buildScene(g, pos, {}, { margin: 20 });
    for (const n of sc.nodes) {
      const e = shapeExtent(n.shape, n.r);
      expect(n.x - e).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(n.y - e).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(n.x + e).toBeLessThanOrEqual(sc.width - 20 + 1e-9);
      expect(n.y + e).toBeLessThanOrEqual(sc.height - 20 + 1e-9);
    }
    // 位置の相対関係は保たれる
    const a = sc.nodes.find((n) => n.id === id('a'));
    const b = sc.nodes.find((n) => n.id === id('b'));
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBeCloseTo(400);
  });
  it('幅の測定関数があれば、ラベルも範囲に収まる', () => {
    const long = makeGraph([['a', 'x'.repeat(50)]]);
    const sc = buildScene(long, new Map([[id('a'), { x: 0, y: 0 }]]), {}, { measureText: measure });
    const l = sc.labels[0];
    expect(l).toBeDefined();
    expect((l?.x ?? 0) + 500).toBeLessThanOrEqual(sc.width);
  });
  it('右から左のラベルが左へ伸びても範囲に収まる', () => {
    const g2 = makeGraph([['a', 'ابن الأثير']]);
    const sc = buildScene(g2, new Map([[id('a'), { x: 0, y: 0 }]]), {}, { measureText: measure });
    const l = sc.labels[0];
    // 右端が x で、文字は左へ 100px 伸びる。左端が 0 以上に収まる
    expect((l?.x ?? 0) - 100).toBeGreaterThanOrEqual(0);
    expect(sc.nodes[0]?.x).toBeGreaterThan(l?.x ?? 0);
  });
  it('測定関数が無くても、見積もりでラベルを範囲に収める', () => {
    const long = makeGraph([['a', 'x'.repeat(50)]]);
    const sc = buildScene(long, new Map([[id('a'), { x: 0, y: 0 }]]));
    // 50 文字 × 12 × 0.6 = 360px
    expect(sc.width).toBeGreaterThan(360);
  });
  it('NaN、負の値などの不正な数値は既定値になる', () => {
    const g4 = makeGraph([['a', 'abcd']]);
    const p = new Map([[id('a'), { x: 0, y: 0 }]]);
    const base = buildScene(g4, p);
    const bad = buildScene(
      g4,
      p,
      {},
      {
        margin: -5,
        labelFontSize: NaN,
        largeLabelCount: -1,
        measureText: () => NaN,
        legend: { items: [{ label: 'x', fill: 'red', r: Infinity }] },
      },
    );
    expect(bad.nodes[0]?.x).toBe(base.nodes[0]?.x);
    expect(bad.labels[0]?.fontSize).toBe(12);
    expect(Number.isFinite(bad.width)).toBe(true);
    expect(bad.legend?.items[0]?.swatch.r).toBe(6);
    expect(bad.legend?.items[0]?.swatch.fill).toBe('#999999');
  });
  it('fontFamily はシーンに持たせ、測定と描画で同じ', () => {
    const fonts: string[] = [];
    const sc = buildScene(
      makeGraph([['a', 'A']]),
      new Map([[id('a'), { x: 0, y: 0 }]]),
      {},
      {
        fontFamily: 'Amiri',
        measureText: (t, f) => {
          fonts.push(f);
          return t.length;
        },
      },
    );
    expect(sc.fontFamily).toBe('Amiri');
    expect(fonts).toEqual(['12px Amiri']);
  });
  it('widths のキーが 1 件も一致しなければ報告する', () => {
    const g5 = makeGraph(
      [
        ['a', 'A'],
        ['b', 'B'],
      ],
      [['e1', 'a', 'b']],
    );
    const p = new Map([
      [id('a'), { x: 0, y: 0 }],
      [id('b'), { x: 10, y: 0 }],
    ]);
    const w = (k: string) => new Map([[k, { width: 3, missing: false }]]);
    expect(buildScene(g5, p, { widths: w('wrong') }).omitted.widthsUnmatched).toBe(true);
    expect(buildScene(g5, p, { widths: w('e1') }).omitted.widthsUnmatched).toBe(false);
    expect(buildScene(g5, p, {}).omitted.widthsUnmatched).toBe(false);
  });
  it('ノードが 1 つも無くても例外にならない', () => {
    const sc = buildScene(makeGraph([]), new Map());
    expect(sc.nodes).toHaveLength(0);
    expect(sc.width).toBeGreaterThan(0);
  });
  it('位置の無いノードと、その端点のエッジは入れず、報告する', () => {
    const g3 = makeGraph(
      [
        ['a', 'A'],
        ['b', 'B'],
        ['c', 'C'],
      ],
      [
        ['e1', 'a', 'b'],
        ['e2', 'a', 'c'],
        ['e3', 'a', 'a'],
      ],
    );
    const p = new Map([
      [id('a'), { x: 0, y: 0 }],
      [id('b'), { x: 10, y: 0 }],
      [id('c'), { x: NaN, y: 0 }],
    ]);
    const sc = buildScene(g3, p);
    expect(sc.nodes.map((n) => n.id)).toEqual([id('a'), id('b')]);
    expect(sc.edges.map((e) => e.id)).toEqual(['e1']);
    expect(sc.omitted).toEqual({
      nodesWithoutPosition: [id('c')],
      edgesWithoutEndpoint: 1,
      selfLoops: 1,
      widthsUnmatched: false,
    });
  });
});

describe('FR-VG-03、FR-VG-08: 割り当ての結果の反映', () => {
  const g = makeGraph(
    [
      ['a', 'A', 'person'],
      ['b', 'B', 'place'],
      ['c', 'C'],
    ],
    [['e1', 'a', 'b', true]],
  );
  const pos = new Map([
    [id('a'), { x: 0, y: 0 }],
    [id('b'), { x: 100, y: 0 }],
    [id('c'), { x: 0, y: 100 }],
  ]);
  it('大きさ、色、形、太さが反映され、欠損は dashed になる', () => {
    const sc = buildScene(g, pos, {
      sizes: new Map([
        [id('a'), { size: 10, missing: false }],
        [id('b'), { size: 4, missing: true }],
      ]),
      colors: new Map([
        [id('a'), { color: '#E69F00', missing: false }],
        [id('c'), { color: '#dddddd', missing: true }],
      ]),
      typeColors: new Map([[place, '#0072b2']]),
      shapes: new Map([[place, 'diamond' as const]]),
      widths: new Map([['e1', { width: 3.5, missing: false }]]),
    });
    const [a, b, c] = sc.nodes;
    expect(a).toMatchObject({ r: 10, fill: '#e69f00', dashed: false, shape: 'circle' });
    expect(b).toMatchObject({ r: 4, fill: '#0072b2', dashed: true, shape: 'diamond' });
    expect(c).toMatchObject({ fill: '#dddddd', dashed: true });
    expect(sc.edges[0]).toMatchObject({ width: 3.5, directed: true, dashed: false });
  });
  it('NFR-07: 形は面積が円と等しい（正方形、三角形、ひし形）', () => {
    const area = (shape: 'square' | 'triangle' | 'diamond', r: number): number => {
      const e = shapeExtent(shape, r);
      return shape === 'square' ? 2 * e * e : shape === 'diamond' ? 2 * e * e : 1.299038 * e * e;
    };
    for (const s of ['square', 'triangle', 'diamond'] as const)
      expect(area(s, 10)).toBeCloseTo(Math.PI * 100, 2);
  });
});

describe('FR-VG-03: 選択の強調', () => {
  const g = makeGraph([
    ['a', 'A'],
    ['b', 'B'],
  ]);
  const pos = new Map([
    [id('a'), { x: 0, y: 0 }],
    [id('b'), { x: 50, y: 0 }],
  ]);
  it('既定では書き出しに含めない', () => {
    const sc = buildScene(g, pos, {}, { selected: new Set([id('a')]) });
    expect(sc.nodes.every((n) => !n.selected)).toBe(true);
    expect(sc.nodes[0]?.strokeWidth).toBe(sc.nodes[1]?.strokeWidth);
  });
  it('指定すると、選択中のノードだけ強調する', () => {
    const sc = buildScene(g, pos, {}, { selected: new Set([id('a')]), includeSelection: true });
    expect(sc.nodes[0]?.selected).toBe(true);
    expect(sc.nodes[1]?.selected).toBe(false);
    expect(sc.nodes[0]?.strokeWidth).toBeGreaterThan(sc.nodes[1]?.strokeWidth ?? 0);
  });
});

describe('FR-VG-10: ラベルの表示（3 種）', () => {
  const g = makeGraph([
    ['a', 'A'],
    ['b', 'B'],
    ['c', 'C'],
    ['d', ''],
  ]);
  const pos = new Map(['a', 'b', 'c', 'd'].map((k, i) => [id(k), { x: i * 50, y: 0 }]));
  const sizes = new Map([
    [id('a'), { size: 5, missing: false }],
    [id('b'), { size: 20, missing: false }],
    [id('c'), { size: 10, missing: false }],
  ]);
  it('all: すべて（空のラベルは出さない）', () => {
    expect(buildScene(g, pos, { sizes }).labels.map((l) => l.text)).toEqual(['A', 'B', 'C']);
  });
  it('selected: 選択中のみ', () => {
    const sc = buildScene(g, pos, { sizes }, { labels: 'selected', selected: new Set([id('c')]) });
    expect(sc.labels.map((l) => l.text)).toEqual(['C']);
  });
  it('large: 大きい順に指定の数', () => {
    const sc = buildScene(g, pos, { sizes }, { labels: 'large', largeLabelCount: 2 });
    expect(sc.labels.map((l) => l.text)).toEqual(['B', 'C']);
  });
});

describe('NFR-09: 文字の向きの判定', () => {
  it.each([
    ['ابن الأثير', 'rtl'],
    ['שלום', 'rtl'],
    ['Ibn al-Athir', 'ltr'],
    ['源頼朝', 'ltr'],
    ['1234', 'ltr'],
    ['', 'ltr'],
    ['١٢٣ الأثير', 'rtl'], // アラビア・インド数字は強い向きでない
    ['(ابن) Ibn', 'rtl'],
    ['Ibn (ابن)', 'ltr'],
    ['߀߁ߊ', 'rtl'], // N'Ko の数字と文字
    ['؛ابن', 'rtl'], // アラビア文字の句読点
    ['\u200Fabc', 'rtl'], // RLM
    ['\u061Cabc', 'rtl'], // ALM
    ['\u200Eابن', 'ltr'], // LRM
    ['\u2067abc\u2069ابن', 'rtl'], // アイソレートの中は読み飛ばす
    ['\u2066ابن\u2069abc', 'ltr'],
    ['\u0600ابن', 'rtl'], // U+0600 は AN。次の文字で決まる
    ['\u0600abc', 'ltr'],
    // 右から左のブロックにある、強い向きを持たない記号（ON、ET、CS、EN）は読み飛ばす
    ['\u0609100 Ibn', 'ltr'], // ‰ に似たアラビア文字のパーミル（ET）
    ['\u0606x', 'ltr'], // 立方根（ON）
    ['\u060Cabc', 'ltr'], // アラビア文字のコンマ（CS）
    ['\u066A50 Ibn', 'ltr'], // アラビア文字のパーセント（ET）
    ['\u06DEabc', 'ltr'], // ルブゥ・ル・ヒズブ（ON）
    ['\u06E9abc', 'ltr'], // サジダの印（ON）
    ['\u06F1\u06F2abc', 'ltr'], // ペルシア語の数字（EN）
    ['\uFD3Eabc\uFD3F', 'ltr'], // 装飾の括弧（ON）
    ['\uFDFDabc', 'ltr'], // バスマラの合字（ON）
    ['\u0609100 ابن', 'rtl'],
    ['\u061Fابن', 'rtl'], // アラビア文字の疑問符は AL（強い）
    ['\u070Fabc', 'rtl'], // シリア文字の略記の印は Cf だが AL（強い）
  ])('%s は %s', (text, dir) => {
    expect(detectDirection(text)).toBe(dir);
  });
  it('右から左のラベルは、ノードの左側に text-anchor=end で置く', () => {
    const g = makeGraph([
      ['a', 'ابن'],
      ['b', 'Ibn'],
    ]);
    const sc = buildScene(
      g,
      new Map([
        [id('a'), { x: 0, y: 0 }],
        [id('b'), { x: 0, y: 50 }],
      ]),
    );
    const [ar, lt] = sc.labels;
    const [na, nb] = sc.nodes;
    expect(ar).toMatchObject({ direction: 'rtl', anchor: 'right' });
    expect(ar?.x).toBeLessThan(na?.x ?? 0);
    expect(lt).toMatchObject({ direction: 'ltr', anchor: 'left' });
    expect(lt?.x).toBeGreaterThan(nb?.x ?? 0);
  });
});
