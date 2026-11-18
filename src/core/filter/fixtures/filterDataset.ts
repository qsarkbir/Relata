/**
 * フィルタのテスト用データ。k-partite（人物と地名）、複数値、欠損の 2 種の理由、
 * アラビア文字のラベル、孤立ノード、時間つきのエッジを含む。
 *
 * 人物は age、role を持ち、地名は region だけを持つ（互いに相手の属性のキーを持たない。D-19）。
 */
import {
  makeAttrs,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type AttrValue,
  type Dataset,
  type FuzzyDate,
  type GraphEdge,
  type GraphNode,
  type NodeTypeId,
  type TimeValue,
} from '../../model';
import { DEFAULT_FILTER_STATE, toFilterId, type FilterDef, type FilterState } from '../types';

export const person = toNodeTypeId('person');
export const place = toNodeTypeId('place');

/**
 * 西暦の幅のある日付（テスト用。暦の換算は time/ の担当）。
 * @param earliest - 最も早い日（JDN）
 * @param latest - 最も遅い日（JDN）
 * @returns 日付
 */
export function span(earliest: number, latest = earliest): FuzzyDate {
  return {
    earliest,
    latest,
    certainty: 'certain',
    calendar: 'gregorian',
    label: String(earliest),
  };
}

/**
 * ノードを作る。
 * @param id - ID
 * @param type - 型
 * @param label - ラベル
 * @param attrs - 属性の組
 * @param time - 時期
 * @returns ノード
 */
export function mkNode(
  id: string,
  type: NodeTypeId,
  label: string,
  attrs: [string, AttrValue][],
  time?: TimeValue,
): GraphNode {
  return { id: toNodeId(id), type, label, attrs: makeAttrs(attrs), ...(time ? { time } : {}) };
}

/**
 * エッジを作る（amount は必ず持つ）。
 * @param id - ID
 * @param source - 始点
 * @param target - 終点
 * @param amount - amount の値
 * @param extra - 上書きする項目
 * @returns エッジ
 */
export function mkEdge(
  id: string,
  source: string,
  target: string,
  amount: AttrValue,
  extra: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id: toEdgeId(id),
    source: toNodeId(source),
    target: toNodeId(target),
    directed: true,
    weight: 1,
    attrs: makeAttrs([['amount', amount]]),
    ...extra,
  };
}

/**
 * 数値の属性値。
 * @param n - 数
 * @returns 属性値
 */
export const num = (n: number): AttrValue => ({ kind: 'value', value: n });
/**
 * 文字列（または複数値）の属性値。
 * @param s - 値
 * @returns 属性値
 */
export const str = (s: string | string[]): AttrValue => ({ kind: 'value', value: s });
/**
 * 欠損の属性値。
 * @param reason - 理由
 * @returns 属性値
 */
export const miss = (
  reason: 'unrecorded' | 'lost' | 'illegible' | 'not-applicable',
): AttrValue => ({
  kind: 'missing',
  reason,
});

/**
 * フィルタのテスト用 Dataset を作る。
 *
 * 人物 p1〜p4 と iso（孤立）、地名 c1、c2。エッジ e1〜e5。
 * 連結: p1-p2-p3-c1-c2、p4-c2。
 * @returns Dataset
 */
export function filterDataset(): Dataset {
  return {
    graphMode: 'directed',
    nodeTypes: [
      { id: person, label: '人物' },
      { id: place, label: '地名' },
    ],
    nodes: [
      mkNode(
        'p1',
        person,
        'Ahmad',
        [
          ['age', num(30)],
          ['role', str(['qadi', 'scholar'])],
          ['note', str('Ḥanafī jurist')],
        ],
        {
          kind: 'span',
          start: span(100, 120),
          end: span(200, 220),
        },
      ),
      mkNode('p2', person, 'أحمد', [
        ['age', num(50)],
        ['role', str('scholar')],
        ['note', str('٣')],
      ]),
      mkNode('p3', person, 'Bilal', [
        ['age', miss('unrecorded')],
        ['role', miss('lost')],
        ['note', miss('unrecorded')],
      ]),
      mkNode(
        'p4',
        person,
        'Cem',
        [
          ['age', num(70)],
          ['role', str('qadi')],
          ['note', str('Cem note')],
        ],
        {
          kind: 'span',
          start: span(300),
          end: { kind: 'missing', reason: 'unrecorded' },
        },
      ),
      mkNode(
        'iso',
        person,
        'Iso',
        [
          ['age', num(20)],
          ['role', str('scholar')],
          ['note', miss('unrecorded')],
        ],
        {
          kind: 'missing',
          reason: 'lost',
        },
      ),
      mkNode('c1', place, 'Cairo', [['region', str('Egypt')]]),
      mkNode('c2', place, 'Konya', [['region', str('Anatolia')]]),
    ],
    edges: [
      mkEdge('e1', 'p1', 'p2', num(10), {
        relation: 'teacher',
        time: { kind: 'span', start: span(1000), end: span(1100) },
      }),
      mkEdge('e2', 'p2', 'p3', num(5), {
        relation: 'Friend',
        time: { kind: 'missing', reason: 'lost' },
      }),
      mkEdge('e3', 'p3', 'c1', miss('lost'), { relation: 'lived' }),
      mkEdge('e4', 'p4', 'c2', num(20)),
      mkEdge('e5', 'c1', 'c2', miss('not-applicable'), { relation: 'road' }),
    ],
    schema: [
      { key: 'age', label: '年齢', appliesTo: 'node', nodeType: person, valueType: 'number' },
      {
        key: 'role',
        label: '役職',
        appliesTo: 'node',
        nodeType: person,
        valueType: 'category',
        multi: { separator: ';' },
      },
      { key: 'note', label: '備考', appliesTo: 'node', nodeType: person, valueType: 'string' },
      { key: 'region', label: '地方', appliesTo: 'node', nodeType: place, valueType: 'category' },
      { key: 'amount', label: '額', appliesTo: 'edge', valueType: 'number' },
    ],
    meta: { title: 'filter test' },
  };
}

/**
 * テスト用の FilterState を作る（既定の edgeRule と showIsolated に、必要な設定を重ねる）。
 * @param filters - フィルタの並び
 * @param overrides - 上書きする設定
 * @returns FilterState
 */
export function st(
  filters: readonly FilterDef[],
  overrides: Partial<FilterState> = {},
): FilterState {
  return { ...DEFAULT_FILTER_STATE, filters, ...overrides };
}

/**
 * ID の集合を、比べやすい並べ替え済みの文字列の配列にする。
 * @param s - ID の集合
 * @returns 昇順の配列
 */
export function sorted(s: ReadonlySet<string>): string[] {
  return [...s].sort();
}

/** テスト用の短い別名。 */
export const fid = toFilterId;
