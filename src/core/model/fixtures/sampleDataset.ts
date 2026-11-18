/**
 * core のテスト用データ。歴史データにありがちな「意地悪な」入力を 1 つの Dataset に集める。
 *
 * 含むもの: 同名異人、型違いの同名、アラビア文字のラベル、合成済み／分解済みの文字、
 * 自己ループ、往復エッジ、多重エッジ、孤立ノード、欠損の 4 種の理由、
 * ヒジュラ暦の FuzzyDate、紀元前の日付、複数値、終わりが分からない期間。
 *
 * schema の全属性について、当てはまる持ち主は必ずキーを持つ（無ければ Missing）。
 */
import {
  makeAttrs,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type AttrValue,
  type AttributeDef,
  type Dataset,
  type FuzzyDate,
  type GraphEdge,
  type GraphNode,
  type NodeTypeId,
} from '../index';

export const personType = toNodeTypeId('person');
export const placeType = toNodeTypeId('place');

/**
 * 西暦の 1 日だけの日付（テスト用の簡易版。暦の換算は T1-02 の担当）。
 * @param jdn - ユリウス通日
 * @param label - 元の表記
 * @returns 幅のない（earliest = latest）日付
 */
export function day(jdn: number, label = String(jdn)): FuzzyDate {
  return { earliest: jdn, latest: jdn, certainty: 'certain', calendar: 'gregorian', label };
}

/** ヒジュラ暦 1050 年ラマダーン月 15 日（前後 2 日の幅）。JDN は概算の例示値。 */
export const hijriDate: FuzzyDate = {
  earliest: 2_323_000,
  latest: 2_323_004,
  certainty: 'probable',
  calendar: 'hijri',
  label: '15 Ramaḍān 1050',
};

/** 紀元前の日付（JDN は小さな値）。 */
export const bceDate: FuzzyDate = {
  earliest: 1_500_000,
  latest: 1_500_365,
  certainty: 'possible',
  calendar: 'gregorian',
  label: 'c.1000 BCE',
};

export const sampleSchema: readonly AttributeDef[] = [
  { key: 'born', label: '生年', appliesTo: 'node', valueType: 'date' },
  {
    key: 'role',
    label: '役職',
    appliesTo: 'node',
    valueType: 'category',
    multi: { separator: ';' },
  },
  { key: 'note', label: '備考', appliesTo: 'node', valueType: 'string' },
  // 地名だけが持つ属性（人物は持たない）
  { key: 'region', label: '地方', appliesTo: 'node', nodeType: placeType, valueType: 'category' },
  { key: 'amount', label: '額', appliesTo: 'edge', valueType: 'number' },
];

const missing: AttrValue = { kind: 'missing', reason: 'unrecorded' };

/**
 * 型に当てはまる属性をすべて Missing で埋めた、既定の属性の組を作る。
 * @param type - ノード型
 * @returns （キー, 値）の組の並び
 */
function defaultNodeAttrs(type: NodeTypeId): (readonly [string, AttrValue])[] {
  return sampleSchema
    .filter((d) => d.appliesTo === 'node' && (d.nodeType === undefined || d.nodeType === type))
    .map((d) => [d.key, missing] as const);
}

/**
 * テスト用のノードを作る。当てはまる属性は Missing で埋め、extra.attrs で上書き・追加する。
 * @param id - ノード ID の文字列
 * @param type - ノード型（既定は人物）
 * @param label - ラベル（既定は ID と同じ）
 * @param extra - 上書きする項目
 * @returns ノード
 */
export function node(
  id: string,
  type = personType,
  label = id,
  extra: Partial<GraphNode> = {},
): GraphNode {
  const attrs = makeAttrs([...defaultNodeAttrs(type), ...Object.entries(extra.attrs ?? {})]);
  return { id: toNodeId(id), type, label, ...extra, attrs };
}

/**
 * テスト用のエッジを作る（既定は有向、重み 1、amount は Missing）。
 * @param id - エッジ ID の文字列
 * @param source - 始点のノード ID
 * @param target - 終点のノード ID
 * @param extra - 上書きする項目
 * @returns エッジ
 */
export function edge(
  id: string,
  source: string,
  target: string,
  extra: Partial<GraphEdge> = {},
): GraphEdge {
  const attrs = makeAttrs([['amount', missing], ...Object.entries(extra.attrs ?? {})]);
  return {
    id: toEdgeId(id),
    source: toNodeId(source),
    target: toNodeId(target),
    directed: true,
    weight: 1,
    ...extra,
    attrs,
  };
}

/**
 * 問題の無い、意地悪な入力入りの Dataset を作る。
 * @returns Dataset
 */
export function sampleDataset(): Dataset {
  return {
    graphMode: 'mixed',
    nodeTypes: [
      { id: personType, label: '人物', shape: 'circle' },
      { id: placeType, label: '地名', color: '#336699' },
    ],
    nodes: [
      // 同名異人: 同じラベル、別の ID
      node('p1', personType, 'Muḥammad', {
        attrs: makeAttrs([
          ['born', { kind: 'date', value: hijriDate }],
          ['role', { kind: 'value', value: ['qadi', 'scholar'], certainty: 'probable' }],
        ]),
        geo: { kind: 'point', lat: 30.0444, lon: 31.2357 },
        time: { kind: 'span', start: hijriDate, end: day(2_323_500) },
      }),
      node('p2', personType, 'Muḥammad'),
      // 型違いの同名
      node('pl1', placeType, 'Muḥammad', {
        attrs: makeAttrs([['region', { kind: 'value', value: 'Hijaz' }]]),
      }),
      // アラビア文字のラベル。欠損の 4 種の理由
      node('p3', personType, 'ابن خلدون', {
        attrs: makeAttrs([
          ['note', { kind: 'missing', reason: 'unrecorded' }],
          ['role', { kind: 'missing', reason: 'lost' }],
          ['born', { kind: 'missing', reason: 'illegible' }],
        ]),
        geo: { kind: 'missing', reason: 'illegible' },
        time: { kind: 'missing', reason: 'not-applicable' },
      }),
      // 紀元前
      node('p4', personType, 'Hammurabi', { time: { kind: 'span', start: bceDate } }),
      // 終わりが分からない期間
      node('p5', personType, 'Unknown end', {
        time: { kind: 'span', start: hijriDate, end: { kind: 'missing', reason: 'lost' } },
      }),
      // 孤立ノード
      node('lonely', personType, '孤立'),
    ],
    edges: [
      edge('e1', 'p1', 'p2'),
      edge('e2', 'p2', 'p1'), // 往復
      edge('e3', 'p1', 'p3', { relation: 'teacher', weight: 2.5 }),
      edge('e4', 'p1', 'p3', { relation: 'teacher', directed: false }), // 多重エッジ
      edge('e5', 'p4', 'p4', {
        weight: 0,
        attrs: makeAttrs([['amount', { kind: 'value', value: 3 }]]),
      }), // 自己ループ
      edge('e6', 'p1', 'pl1', { time: { kind: 'missing', reason: 'lost' } }),
    ],
    schema: sampleSchema,
    meta: { title: 'テスト用データ' },
  };
}
