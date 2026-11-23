import { describe, expect, it } from 'vitest';
import { applyFilters, DEFAULT_FILTER_STATE } from '../../core/filter';
import { buildGraph, projectGraph } from '../../core/graph';
import type { Dataset } from '../../core/model';
import { gregorianToJdn } from '../../core/time';
import {
  makeAttrs,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type FuzzyDate,
  type GraphEdge,
  type GraphNode,
} from '../../core/model';
import { exportGexf } from './gexf';
import { exportGraphml } from './graphml';
import { jdnToIso } from './network';
import { xmlAttr, xmlText } from './xml';

// ---- 読み戻し用の、最小の XML 解析（テスト専用。実行時の読み込みは別タスク） ----
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
function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(re)) {
    const top = req(stack[stack.length - 1]);
    if (m[5] !== undefined) {
      top.text += decode(m[5]);
    } else if (m[1] === '/') {
      stack.pop();
    } else {
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? '').matchAll(/([\w:.-]+)="([^"]*)"/g))
        attrs[req(a[1])] = decode(req(a[2]));
      const node: XmlNode = { name: req(m[2]), attrs, children: [], text: '' };
      top.children.push(node);
      if (m[4] !== '/') stack.push(node);
    }
  }
  return req(root.children[0]);
}
function req<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('値がありません');
  return v;
}
const find = (n: XmlNode, name: string): XmlNode[] => n.children.filter((c) => c.name === name);

const fuzzy = (y: number, m: number, d: number, label: string): FuzzyDate => ({
  earliest: gregorianToJdn(y, m, d),
  latest: gregorianToJdn(y, m, d),
  certainty: 'certain',
  calendar: 'gregorian',
  label,
});
const type = toNodeTypeId('person');
const mkNode = (id: string, label: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id: toNodeId(id),
  type,
  label,
  attrs: makeAttrs([]),
  ...extra,
});
const mkEdge = (id: string, s: string, t: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({
  id: toEdgeId(id),
  source: toNodeId(s),
  target: toNodeId(t),
  directed: true,
  weight: 1,
  attrs: makeAttrs([]),
  ...extra,
});
function dataset(): Dataset {
  return {
    graphMode: 'mixed',
    nodeTypes: [{ id: type, label: '人物' }],
    nodes: [
      mkNode('a', 'ابن خلدون & <Ibn Khaldūn>', {
        attrs: makeAttrs([
          ['birth', { kind: 'date', value: fuzzy(1332, 5, 27, '732 AH') }],
          ['rank', { kind: 'value', value: 3 }],
          ['place', { kind: 'missing', reason: 'unrecorded' }],
          ['type', { kind: 'value', value: 'ユーザー属性' }],
        ]),
        time: {
          kind: 'span',
          start: fuzzy(1332, 5, 27, '732 AH'),
          end: fuzzy(1406, 3, 17, '808 AH'),
        },
      }),
      mkNode('b', '日本語の名前"引用"'),
      mkNode('c', 'C'),
    ],
    edges: [
      mkEdge('e1', 'a', 'b', {
        relation: 'teacher',
        weight: 2,
        attrs: makeAttrs([['source', { kind: 'value', value: 'a;b' }]]),
      }),
      mkEdge('e2', 'a', 'b', { relation: 'friend', weight: 3 }),
      mkEdge('e3', 'b', 'c', { directed: false, weight: 0.5 }),
    ],
    schema: [
      { key: 'birth', label: '生年', appliesTo: 'node', valueType: 'date' },
      { key: 'rank', label: '順位', appliesTo: 'node', valueType: 'number' },
      { key: 'place', label: '場所', appliesTo: 'node', valueType: 'string' },
      { key: 'type', label: '種別', appliesTo: 'node', valueType: 'string' },
      { key: 'source', label: '出典', appliesTo: 'edge', valueType: 'string' },
    ],
    meta: { title: 'テスト' },
  };
}
const graphOf = (d: Dataset) => buildGraph(d, applyFilters(d, DEFAULT_FILTER_STATE));

describe('FR-OUT-05: XML の文字列', () => {
  it('本文と属性値をエスケープし、アラビア文字は UTF-8 のまま残す', () => {
    expect(xmlText('a<b>&"\r')).toBe('a&lt;b&gt;&amp;"&#13;');
    expect(xmlAttr('"x"\n\t')).toBe('&quot;x&quot;&#10;&#9;');
    expect(xmlText('ابن\u0001')).toBe('ابن');
  });
  it('FR-OUT-05: JDN を ISO 8601 にする（紀元前は天文学的な年）', () => {
    expect(jdnToIso(2451545)).toBe('2000-01-01');
    expect(jdnToIso(gregorianToJdn(0, 3, 1))).toBe('0000-03-01');
    expect(jdnToIso(gregorianToJdn(-43, 3, 15))).toBe('-0043-03-15');
  });
});

describe('FR-OUT-05: GraphML', () => {
  const d = dataset();
  const xml = exportGraphml(d, graphOf(d));
  const root = parseXml(xml);
  const graph = req(find(root, 'graph')[0]);
  const keys = new Map(find(root, 'key').map((k) => [req(k.attrs.id), k.attrs]));
  const dataOf = (n: XmlNode): Record<string, string> =>
    Object.fromEntries(
      find(n, 'data').map((x) => [req(keys.get(req(x.attrs.key))?.['attr.name']), x.text]),
    );
  it('XML 宣言と名前空間を持ち、混在の向きは edgedefault と各エッジの directed で表す', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(root.attrs.xmlns).toBe('http://graphml.graphdrawing.org/xmlns');
    expect(graph.attrs.edgedefault).toBe('undirected');
    const edges = find(graph, 'edge');
    expect(edges.map((e) => e.attrs.directed)).toEqual(['true', undefined]);
  });
  it('往復: ID、ラベル（アラビア文字、記号、引用符）、型、期間、属性が戻る', () => {
    const nodes = find(graph, 'node');
    expect(nodes.map((n) => n.attrs.id)).toEqual(['a', 'b', 'c']);
    const a = dataOf(req(nodes[0]));
    expect(a.label).toBe('ابن خلدون & <Ibn Khaldūn>');
    expect(a.type).toBe('person');
    expect(a.type_label).toBe('人物');
    expect(a.rank).toBe('3');
    expect(a.birth).toBe('1332-05-27');
    expect(a.start).toBe('1332-05-27');
    expect(a.end).toBe('1406-03-17');
    expect(a.time_label).toBe('732 AH – 808 AH');
    expect(dataOf(req(nodes[1])).label).toBe('日本語の名前"引用"');
  });
  it('欠損の属性は書かない。予約名とぶつかる利用者の属性は改名する', () => {
    const a = dataOf(req(find(graph, 'node')[0]));
    expect('place' in a).toBe(false);
    expect(a.type_attr).toBe('ユーザー属性');
  });
  it('まとめたエッジは重みの合計と件数、関係名の連結を持ち、1 本のエッジは属性を持つ', () => {
    const edges = find(graph, 'edge').map((e) => ({ e, data: dataOf(e) }));
    expect(edges).toHaveLength(2);
    const [merged, single] = edges as [(typeof edges)[number], (typeof edges)[number]];
    expect(merged.e.attrs.source).toBe('a');
    expect(merged.e.attrs.target).toBe('b');
    expect(merged.data.weight).toBe('5');
    expect(merged.data.count).toBe('2');
    expect(merged.data.relation).toBe('teacher;friend');
    expect(merged.data.edge_ids).toBe('e1;e2');
    expect(single.e.attrs.id).toBe('e3');
    expect(single.data.weight).toBe('0.5');
  });
});

describe('FR-OUT-05: GEXF', () => {
  const d = dataset();
  const xml = exportGexf(d, graphOf(d), { modifiedDate: '2026-11-23' });
  const root = parseXml(xml);
  const graph = req(find(root, 'graph')[0]);
  it('GEXF 1.3、動的グラフ、日付の形式、作成者を持つ', () => {
    expect(root.attrs.version).toBe('1.3');
    expect(graph.attrs.mode).toBe('dynamic');
    expect(graph.attrs.timeformat).toBe('date');
    // GEXF 1.3 には mixed が無いので、混在のときは undirected にして、各エッジの type で向きを書く
    expect(graph.attrs.defaultedgetype).toBe('undirected');
    expect(find(req(find(root, 'meta')[0]), 'creator')[0]?.text).toBe('Relata');
  });
  it('往復: ノードのラベル・期間、エッジの向き・重み・関係名が戻る', () => {
    const nodes = find(req(find(graph, 'nodes')[0]), 'node');
    expect(nodes[0]?.attrs).toMatchObject({
      id: 'a',
      label: 'ابن خلدون & <Ibn Khaldūn>',
      start: '1332-05-27',
      end: '1406-03-17',
    });
    expect(nodes[1]?.attrs.label).toBe('日本語の名前"引用"');
    const edges = find(req(find(graph, 'edges')[0]), 'edge');
    expect(edges.map((e) => [e.attrs.type, e.attrs.weight, e.attrs.label])).toEqual([
      ['directed', '5', 'teacher;friend'],
      ['undirected', '0.5', undefined],
    ]);
  });
  it('属性の宣言と値: 数は double、欠損の属性は attvalue を作らない', () => {
    const decl = find(req(find(graph, 'attributes')[0]), 'attribute');
    const rank = decl.find((x) => x.attrs.title === 'rank');
    expect(rank?.attrs.type).toBe('double');
    const place = decl.find((x) => x.attrs.title === 'place');
    expect(place).toBeUndefined();
  });
  it('期間が無いデータは静的グラフにする', () => {
    const plain: Dataset = {
      ...d,
      nodes: d.nodes.map((n) => ({ ...n, time: undefined })),
    };
    const text = exportGexf(plain, graphOf(plain));
    expect(parseXml(text).children.find((c) => c.name === 'graph')?.attrs.mode).toBe('static');
  });
});

describe('FR-OUT-05: 射影したグラフの書き出し', () => {
  const person = toNodeTypeId('person');
  const org = toNodeTypeId('org');
  const d: Dataset = {
    graphMode: 'undirected',
    nodeTypes: [
      { id: person, label: '人物' },
      { id: org, label: '組織' },
    ],
    nodes: [
      mkNode('p1', 'P1'),
      mkNode('p2', 'P2'),
      { ...mkNode('o1', 'O1'), type: org },
      { ...mkNode('o2', 'O2'), type: org },
    ],
    edges: [
      mkEdge('m1', 'p1', 'o1', {
        directed: false,
        relation: 'member',
        attrs: makeAttrs([['role', { kind: 'value', value: 'x' }]]),
      }),
      mkEdge('m2', 'p2', 'o1', { directed: false, relation: 'member' }),
      mkEdge('m3', 'p1', 'o2', { directed: false }),
      mkEdge('m4', 'p2', 'o2', { directed: false }),
    ],
    schema: [{ key: 'role', label: '役割', appliesTo: 'edge', valueType: 'string' }],
    meta: { title: '射影' },
  };
  const filtered = applyFilters(d, DEFAULT_FILTER_STATE);
  const base = buildGraph(d, filtered);
  const graph = projectGraph(base, { target: person, via: org, method: 'shared' }).graph;
  it('連番の ID を振り、元のエッジの関係名・属性を引き継がず、根拠の仲介ノードを残す', () => {
    const root = parseXml(exportGraphml(d, graph));
    const g = req(find(root, 'graph')[0]);
    const keys = new Map(find(root, 'key').map((k) => [req(k.attrs.id), k.attrs]));
    const edges = find(g, 'edge');
    expect(edges).toHaveLength(1);
    const edge = req(edges[0]);
    expect(edge.attrs.id).toMatch(/^m\d+$/);
    const data = Object.fromEntries(
      find(edge, 'data').map((x) => [req(keys.get(req(x.attrs.key))?.['attr.name']), x.text]),
    );
    expect(data.via).toBe('o1;o2');
    expect(data.relation).toBeUndefined();
    expect(data.role).toBeUndefined();
  });
  it('GEXF でも、射影したエッジに元の関係名（label）を付けない', () => {
    const root = parseXml(exportGexf(d, graph));
    const edge = req(find(req(find(req(find(root, 'graph')[0]), 'edges')[0]), 'edge')[0]);
    expect(edge.attrs.label).toBeUndefined();
    expect(edge.attrs.id).toMatch(/^m\d+$/);
  });
  it('利用者の属性が label、start、end のとき、書き出しの項目と名前が重ならない', () => {
    const clash: Dataset = {
      ...dataset(),
      nodes: dataset().nodes.map((n) => ({
        ...n,
        attrs: makeAttrs([
          ['label', { kind: 'value', value: 'L' }],
          ['start', { kind: 'value', value: 'S' }],
        ]),
      })),
    };
    const root = parseXml(exportGraphml(clash, graphOf(clash)));
    const names = find(root, 'key')
      .filter((k) => k.attrs.for === 'node')
      .map((k) => k.attrs['attr.name']);
    expect(names.filter((n) => n === 'label')).toHaveLength(1);
    expect(names.filter((n) => n === 'start')).toHaveLength(1);
    expect(names).toContain('label_attr');
    expect(names).toContain('start_attr');
  });
});
