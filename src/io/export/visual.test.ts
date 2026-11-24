import { describe, expect, it } from 'vitest';
import { applyFilters, DEFAULT_FILTER_STATE } from '../../core/filter';
import { buildGraph } from '../../core/graph';
import type { Dataset } from '../../core/model';
import { makeAttrs, toEdgeId, toNodeId, toNodeTypeId } from '../../core/model';
import { exportGexf } from './gexf';
import { exportGraphml } from './graphml';
import { parseColor, visualFromScene } from './visual';
import type { VisualScene } from './visual';

// ---- 読み戻し用の、整形式を確かめる最小の XML 解析（テスト専用。名前空間の接頭辞つきの名前を許す） ----
interface XmlNode {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: XmlNode[];
  text: string;
}
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
// 閉じ忘れ、対応しない閉じ、複数の根があれば例外を投げる。
function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let consumed = 0;
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(re)) {
    consumed += m[0].length;
    const top = stack[stack.length - 1];
    if (top === undefined) throw new Error('スタックが空');
    if (m[5] !== undefined) {
      top.text += decode(m[5]);
    } else if (m[1] === '/') {
      const closed = stack.pop();
      if (closed?.name !== m[2]) throw new Error(`閉じタグが対応しない: ${m[2] ?? ''}`);
    } else {
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? '').matchAll(/([\w:.-]+)="([^"]*)"/g))
        attrs[a[1] ?? ''] = decode(a[2] ?? '');
      const node: XmlNode = { name: m[2] ?? '', attrs, children: [], text: '' };
      top.children.push(node);
      if (m[4] !== '/') stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error('閉じていない要素がある');
  if (consumed !== xml.replace(/<\?xml[^>]*\?>/, '').length) throw new Error('読めない部分がある');
  const only = root.children[0];
  if (root.children.length !== 1 || only === undefined) throw new Error('根が 1 つではない');
  return only;
}
const kids = (n: XmlNode, name: string): XmlNode[] => n.children.filter((c) => c.name === name);
// 指定のキーの `<data>`。
const dataByKey = (n: XmlNode, key: string): XmlNode => {
  const c = kids(n, 'data').find((x) => x.attrs.key === key);
  if (c === undefined) throw new Error(`data ${key} がありません`);
  return c;
};
const first = (n: XmlNode, name: string): XmlNode => {
  const c = kids(n, name)[0];
  if (c === undefined) throw new Error(`${name} がありません`);
  return c;
};

const type = toNodeTypeId('person');
function dataset(): Dataset {
  const node = (id: string, label: string) => ({
    id: toNodeId(id),
    type,
    label,
    attrs: makeAttrs([]),
  });
  const edge = (id: string, s: string, t: string, directed: boolean) => ({
    id: toEdgeId(id),
    source: toNodeId(s),
    target: toNodeId(t),
    directed,
    weight: 1,
    attrs: makeAttrs([]),
  });
  return {
    graphMode: 'mixed',
    nodeTypes: [{ id: type, label: '人物' }],
    nodes: [node('a', 'ابن خلدون'), node('b', 'B'), node('c', 'C')],
    edges: [edge('e1', 'a', 'b', true), edge('e2', 'b', 'c', false)],
    schema: [],
    meta: { title: 'テスト' },
  };
}
const graphOf = (d: Dataset) => buildGraph(d, applyFilters(d, DEFAULT_FILTER_STATE));

// シーンの代わり。エッジの id は、グラフのエッジのキー（元が 1 本なら元の ID）。
function scene(d: Dataset): VisualScene {
  const g = graphOf(d);
  return {
    nodes: g.nodes().map((id, i) => ({
      id,
      x: 100 + i * 50.123456,
      y: 40 + i * 20,
      r: 8,
      shape: i === 1 ? ('square' as const) : ('circle' as const),
      fill: i === 0 ? '#e41a1c' : '#4daf4a',
    })),
    edges: g.edges().map((key) => ({ id: key, color: '#999999', width: 1.5 })),
  };
}

describe('FR-OUT-05: parseColor', () => {
  it('#rgb、#rrggbb、rgb() を読み、読めない色は null', () => {
    expect(parseColor('#e41a1c')).toEqual({ r: 228, g: 26, b: 28 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor('none')).toBeNull();
  });
});

describe('FR-OUT-05: GraphML の表示情報（yFiles、Gephi）', () => {
  const d = dataset();
  const visual = visualFromScene(scene(d));
  const xml = exportGraphml(d, graphOf(d), visual);

  it('FR-OUT-05: 標準のヘッダ（xsi、schemaLocation）と yFiles の名前空間を持ち、整形式', () => {
    const root = parseXml(xml);
    expect(root.name).toBe('graphml');
    expect(root.attrs.xmlns).toBe('http://graphml.graphdrawing.org/xmlns');
    expect(root.attrs['xmlns:xsi']).toBe('http://www.w3.org/2001/XMLSchema-instance');
    expect(root.attrs['xmlns:y']).toBe('http://www.yworks.com/xml/graphml');
    expect(root.attrs['xsi:schemaLocation']).toContain('graphml.xsd');
  });
  it('FR-OUT-05: yfiles.type のキーと、y:ShapeNode（位置、大きさ、塗り、ラベル、形）がある', () => {
    const root = parseXml(xml);
    const keys = kids(root, 'key');
    expect(keys.find((k) => k.attrs['yfiles.type'] === 'nodegraphics')?.attrs.for).toBe('node');
    expect(keys.find((k) => k.attrs['yfiles.type'] === 'edgegraphics')?.attrs.for).toBe('edge');
    const nodeA = first(first(root, 'graph'), 'node');
    const shape = first(dataByKey(nodeA, 'ynode'), 'y:ShapeNode');
    // 左上の角 = 中心 - 大きさ / 2（中心は 100、40、半径 8）。
    expect(first(shape, 'y:Geometry').attrs).toEqual({
      x: '92',
      y: '32',
      width: '16',
      height: '16',
    });
    expect(first(shape, 'y:Fill').attrs.color).toBe('#E41A1C');
    expect(first(shape, 'y:Shape').attrs.type).toBe('ellipse');
  });
  it('FR-OUT-05: アラビア文字のラベルが y:NodeLabel に UTF-8 のまま入る', () => {
    expect(xml).toContain('>ابن خلدون</y:NodeLabel>');
    expect(xml).not.toContain('&#x');
  });
  it('FR-OUT-05: 有向のエッジにだけ矢印を付ける（線の色と太さも書く）', () => {
    const root = parseXml(xml);
    const edges = kids(first(root, 'graph'), 'edge');
    const arrows = edges.map((e) => {
      const pl = first(dataByKey(e, 'yedge'), 'y:PolyLineEdge');
      expect(first(pl, 'y:LineStyle').attrs).toMatchObject({ color: '#999999', width: '1.5' });
      return first(pl, 'y:Arrows').attrs.target;
    });
    expect(arrows).toEqual(['standard', 'none']);
  });
  it('FR-OUT-05: Gephi の x、y、size、r、g、b を書く（y は Gephi の向きに合わせて符号を反転）', () => {
    const root = parseXml(xml);
    const name = new Map(kids(root, 'key').map((k) => [k.attrs.id, k.attrs['attr.name']]));
    const nodes = kids(first(root, 'graph'), 'node');
    const b: Record<string, string> = {};
    for (const x of kids(nodes[1] ?? first(root, 'graph'), 'data'))
      b[name.get(x.attrs.key) ?? ''] = x.text;
    expect(b).toMatchObject({ x: '150.12', y: '-60', size: '16', r: '77', g: '175', b: '74' });
  });
  it('FR-OUT-05: 利用者の属性が x、size などの名前なら、後ろに _attr を付けて避ける', () => {
    const base = dataset();
    const clash: Dataset = {
      ...base,
      nodes: base.nodes.map((n) => ({
        ...n,
        attrs: makeAttrs([
          ['x', { kind: 'value', value: 1 }],
          ['size', { kind: 'value', value: 2 }],
        ]),
      })),
    };
    const out = exportGraphml(clash, graphOf(clash), visualFromScene(scene(clash)));
    const names = kids(parseXml(out), 'key')
      .filter((k) => k.attrs.for === 'node')
      .map((k) => k.attrs['attr.name']);
    expect(names.filter((n) => n === 'x')).toHaveLength(1);
    expect(names).toContain('x_attr');
    expect(names).toContain('size_attr');
  });
  it('FR-OUT-05: 表示情報が無いときは省き、構造と属性だけを書く', () => {
    const plain = exportGraphml(d, graphOf(d));
    expect(plain).not.toContain('y:');
    expect(plain).not.toContain('yfiles');
    expect(plain).not.toContain('attr.name="x"');
    expect(parseXml(plain).attrs['xmlns:xsi']).toBeDefined();
  });
  it('FR-OUT-05: シーンに無いノードやエッジは、表示情報だけ省く', () => {
    const s = scene(d);
    const partial = visualFromScene({ nodes: s.nodes.slice(0, 1), edges: [] });
    const out = parseXml(exportGraphml(d, graphOf(d), partial));
    const nodes = kids(first(out, 'graph'), 'node');
    expect(nodes.filter((n) => kids(n, 'data').some((x) => x.children.length > 0))).toHaveLength(1);
    expect(xml).toContain('y:PolyLineEdge');
    expect(JSON.stringify(out)).not.toContain('y:PolyLineEdge');
  });
});

describe('FR-OUT-05: GEXF の表示情報（viz）', () => {
  const d = dataset();
  const xml = exportGexf(d, graphOf(d), { visual: visualFromScene(scene(d)) });

  it('FR-OUT-05: viz の名前空間と、ノードの position、size、color、shape を書く', () => {
    const root = parseXml(xml);
    expect(root.attrs['xmlns:viz']).toBe('http://gexf.net/1.3/viz');
    const node = first(first(first(root, 'graph'), 'nodes'), 'node');
    expect(first(node, 'viz:position').attrs).toEqual({ x: '100', y: '-40', z: '0.0' });
    expect(first(node, 'viz:size').attrs.value).toBe('16');
    expect(first(node, 'viz:color').attrs).toEqual({ r: '228', g: '26', b: '28' });
    expect(first(node, 'viz:shape').attrs.value).toBe('disc');
  });
  it('FR-OUT-05: エッジに viz:thickness と viz:color を書く', () => {
    const root = parseXml(xml);
    const edge = first(first(first(root, 'graph'), 'edges'), 'edge');
    expect(first(edge, 'viz:thickness').attrs.value).toBe('1.5');
    expect(first(edge, 'viz:color').attrs.r).toBe('153');
  });
  it('FR-OUT-05: 表示情報が無いときは viz を書かない', () => {
    const plain = exportGexf(d, graphOf(d));
    expect(plain).not.toContain('viz');
    expect(parseXml(plain).attrs.version).toBe('1.3');
  });
});
