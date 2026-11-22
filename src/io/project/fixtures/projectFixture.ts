/**
 * プロジェクトの往復テスト用データ。`checkDataset` と `checkFilterState` が問題を返さない形にしてある。
 *
 * 含むもの: アラビア文字と日本語のラベル、複数値（`multi` のある列）、列名 `__proto__`、
 * ヒジュラ暦の幅のある日付、欠損の理由、期間、k-partite（人物と地名）。
 */
import { toFilterId, type FilterState } from '../../../core/filter';
import { makeAttrs, toEdgeId, toNodeId, toNodeTypeId, type Dataset } from '../../../core/model';
import type { ImportSettings } from '../types';

const person = toNodeTypeId('person');
const place = toNodeTypeId('place');

/**
 * 問題のないデータセットを作る。
 * @returns Dataset
 */
export function cleanDataset(): Dataset {
  return {
    graphMode: 'directed',
    nodeTypes: [
      { id: person, label: '人物' },
      { id: place, label: '地名' },
    ],
    nodes: [
      {
        id: toNodeId('p1'),
        type: person,
        label: 'محمد بن علي / 山田',
        attrs: makeAttrs([
          ['name', { kind: 'value', value: ['محمد', '山田'] }],
          ['__proto__', { kind: 'value', value: 'z' }],
          [
            'born',
            {
              kind: 'date',
              value: {
                earliest: 2300000,
                latest: 2300010,
                certainty: 'probable',
                calendar: 'hijri',
                label: '1050 AH',
              },
            },
          ],
          ['age', { kind: 'value', value: 50 }],
        ]),
        time: {
          kind: 'span',
          start: {
            earliest: 2300000,
            latest: 2300010,
            certainty: 'certain',
            calendar: 'gregorian',
            label: 'c.1640',
          },
          end: { kind: 'missing', reason: 'lost' },
        },
      },
      {
        id: toNodeId('p2'),
        type: person,
        label: 'Bilal',
        attrs: makeAttrs([
          ['name', { kind: 'value', value: 'Bilal' }],
          ['__proto__', { kind: 'missing', reason: 'illegible' }],
          ['born', { kind: 'missing', reason: 'unrecorded' }],
          ['age', { kind: 'missing', reason: 'lost' }],
        ]),
      },
      {
        id: toNodeId('c1'),
        type: place,
        label: 'القاهرة',
        attrs: makeAttrs([['region', { kind: 'value', value: 'Egypt' }]]),
      },
    ],
    edges: [
      {
        id: toEdgeId('e1'),
        source: toNodeId('p1'),
        target: toNodeId('p2'),
        directed: true,
        weight: 1,
        relation: 'teacher',
        attrs: makeAttrs([['amount', { kind: 'value', value: 10 }]]),
      },
      {
        id: toEdgeId('e2'),
        source: toNodeId('p2'),
        target: toNodeId('c1'),
        directed: true,
        weight: 2,
        attrs: makeAttrs([['amount', { kind: 'missing', reason: 'not-applicable' }]]),
      },
    ],
    schema: [
      {
        key: 'name',
        label: '名',
        appliesTo: 'node',
        nodeType: person,
        valueType: 'string',
        multi: { separator: ';' },
      },
      {
        key: '__proto__',
        label: '特殊な列',
        appliesTo: 'node',
        nodeType: person,
        valueType: 'string',
      },
      { key: 'born', label: '生年', appliesTo: 'node', nodeType: person, valueType: 'date' },
      { key: 'age', label: '年齢', appliesTo: 'node', nodeType: person, valueType: 'number' },
      { key: 'region', label: '地方', appliesTo: 'node', nodeType: place, valueType: 'category' },
      { key: 'amount', label: '額', appliesTo: 'edge', valueType: 'number' },
    ],
    meta: { title: '写本の伝承者 — رواة', source: 'テスト' },
  };
}

/** 4 種のフィルタを含み、`cleanDataset` と整合する状態。 */
export const cleanFilter: FilterState = {
  filters: [
    {
      id: toFilterId('c'),
      kind: 'category',
      target: 'node',
      attr: 'region',
      include: [{ kind: 'value', value: 'Egypt' }],
    },
    {
      id: toFilterId('r'),
      kind: 'range',
      target: 'node',
      attr: 'age',
      min: 40,
      missing: 'exclude',
    },
    {
      id: toFilterId('t'),
      kind: 'time',
      target: 'edge',
      from: 2000000,
      to: 2400000,
      match: 'within',
      missing: 'include',
    },
    { id: toFilterId('x'), kind: 'text', target: 'node', query: 'محمد', matching: 'strict' },
  ],
  edgeRule: 'both-ends',
  showIsolated: true,
};

/** 取り込みの設定の例。 */
export const sampleSettings: ImportSettings = {
  missingTokens: [
    { token: '〔欠〕', reason: 'lost' },
    { token: '□', reason: 'illegible' },
  ],
  encoding: 'shift_jis',
  columnCalendars: [
    { column: 'born', calendar: 'hijri' },
    { column: '__proto__', calendar: 'gregorian' },
    { column: 'date', table: 'edge', calendar: 'gregorian' },
  ],
};
