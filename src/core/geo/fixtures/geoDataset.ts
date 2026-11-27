/**
 * 座標の出どころと `geo` フィルタのテスト用データ（D-46、D-58）。
 *
 * - `geo` の列を持つ地名（place）: 都市の座標を `GraphNode.geo` に持つ。
 * - 属性の組（lat、lon）を持つ人物（person）: 文字列（アラビア・インド数字）、配列、欠損なども含む。
 * - 座標を持たない組織（org）: 射影の仲介の型として `passTypes` に使う。
 */
import {
  makeAttrs,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type AttrValue,
  type Dataset,
  type GeoValue,
  type GraphNode,
} from '../../model';

/** 人物の型。座標は属性の組（lat、lon）にある。 */
export const personT = toNodeTypeId('person');
/** 地名の型。座標は `GraphNode.geo` にある。 */
export const placeT = toNodeTypeId('place');
/** 組織の型。座標を持たない（射影の仲介の型の想定）。 */
export const orgT = toNodeTypeId('org');
/** ノードを持たない型。日付と真偽値の属性（座標にならない型）を、他のノードに要求せずに schema へ置くために使う。 */
export const miscT = toNodeTypeId('misc');

const v = (value: string | number | string[]): AttrValue => ({ kind: 'value', value });

/**
 * ノードを作る。
 * @param id - ID
 * @param type - 型
 * @param entries - 属性の組
 * @param geo - `geo`（省略すると項目なし）
 * @returns ノード
 */
function node(
  id: string,
  type: typeof personT,
  entries: [string, AttrValue][],
  geo?: GeoValue,
): GraphNode {
  return {
    id: toNodeId(id),
    type,
    label: id.toUpperCase(),
    attrs: makeAttrs(entries),
    ...(geo === undefined ? {} : { geo }),
  };
}

const pt = (lat: number, lon: number): GeoValue => ({ kind: 'point', lat, lon });

/**
 * テスト用の Dataset を作る。
 *
 * place（`geo` が出どころ）: fez（34.03, −5.0）、tunis（36.8, 10.18）、mecca（21.4, 39.8）、
 * fiji（−17.7, 178.0。180° の手前）、samoa（−13.8, −172.0。180° の向こう）、pole（89.0, 0。メルカトルの範囲外）、
 * lost（欠損）、nogeo（`geo` の項目なし）。
 * person（属性の組が出どころ。p1〜p3 は 2 表の読み込みと同じく、`geo` が欠損 `{ kind: 'missing' }`）: p1（文字列 "30.5"、"-6.5"）、p2（アラビア・インド数字 "٣٣٫٥"、"٠"）、
 * p3（配列 1 つ）、p4（複数値）、p5（欠損）、p6（緯度の列が無い）、p7（数でない文字列）、p8（経度が範囲外）。
 * org: o1（座標なし。仲介の型）。
 * @returns Dataset
 */
export function geoDataset(): Dataset {
  return {
    graphMode: 'undirected',
    nodeTypes: [
      { id: personT, label: 'person' },
      { id: placeT, label: 'place' },
      { id: orgT, label: 'org' },
      { id: miscT, label: 'misc' },
    ],
    nodes: [
      node('fez', placeT, [], pt(34.03, -5.0)),
      node('tunis', placeT, [], pt(36.8, 10.18)),
      node('mecca', placeT, [], pt(21.4, 39.8)),
      node('fiji', placeT, [], pt(-17.7, 178.0)),
      node('samoa', placeT, [], pt(-13.8, -172.0)),
      node('pole', placeT, [], pt(89.0, 0)),
      node('lost', placeT, [], { kind: 'missing', reason: 'lost' }),
      node('nogeo', placeT, []),
      node(
        'p1',
        personT,
        [
          ['lat', v('30.5')],
          ['lon', v('-6.5')],
        ],
        { kind: 'missing', reason: 'unrecorded' },
      ),
      node(
        'p2',
        personT,
        [
          ['lat', v('٣٣٫٥')],
          ['lon', v('٠')],
        ],
        { kind: 'missing', reason: 'unrecorded' },
      ),
      node(
        'p3',
        personT,
        [
          ['lat', v(['12'])],
          ['lon', v('5')],
        ],
        { kind: 'missing', reason: 'unrecorded' },
      ),
      node('p4', personT, [
        ['lat', v(['1', '2'])],
        ['lon', v('5')],
      ]),
      node('p5', personT, [
        ['lat', { kind: 'missing', reason: 'unrecorded' }],
        ['lon', v('5')],
      ]),
      node('p6', personT, [['lon', v('5')]]),
      node('p7', personT, [
        ['lat', v('north')],
        ['lon', v('5')],
      ]),
      node('p8', personT, [
        ['lat', v('10')],
        ['lon', v('200')],
      ]),
      node('o1', orgT, []),
    ],
    edges: [
      {
        id: toEdgeId('e1'),
        source: toNodeId('p1'),
        target: toNodeId('o1'),
        directed: false,
        weight: 1,
        attrs: makeAttrs([]),
      },
    ],
    schema: [
      {
        key: 'lat',
        label: 'Latitude',
        appliesTo: 'node',
        nodeType: personT,
        valueType: 'string',
        multi: { separator: ';' },
      },
      {
        key: 'lon',
        label: 'Longitude',
        appliesTo: 'node',
        nodeType: personT,
        valueType: 'string',
        multi: { separator: ';' },
      },
      { key: 'when', label: 'when', appliesTo: 'node', nodeType: miscT, valueType: 'date' },
      { key: 'flag', label: 'flag', appliesTo: 'node', nodeType: miscT, valueType: 'boolean' },
    ],
    meta: { title: 'geo' },
  };
}
