import { describe, expect, it } from 'vitest';
import {
  checkDataset,
  makeAttrs,
  toNodeId,
  toNodeTypeId,
  type AttrValue,
  type AttributeDef,
  type Dataset,
  type DatasetIssue,
  type GraphEdge,
  type GraphNode,
} from './index';
import {
  bceDate,
  day,
  edge,
  hijriDate,
  node,
  personType,
  placeType,
  sampleDataset,
} from './fixtures/sampleDataset';

/**
 * 検査の結果から code だけを取り出す。
 * @param ds - 検査する Dataset
 * @returns 問題の code の一覧
 */
function codes(ds: Dataset): DatasetIssue['code'][] {
  return checkDataset(ds).map((i) => i.code);
}

/**
 * サンプルにノードを足した Dataset を作る。
 * @param extra - 足すノード
 * @returns 差し替えた Dataset
 */
function withNodes(...extra: GraphNode[]): Dataset {
  const ds = sampleDataset();
  return { ...ds, nodes: [...ds.nodes, ...extra] };
}

/**
 * サンプルにエッジを足した Dataset を作る。
 * @param extra - 足すエッジ
 * @returns 差し替えた Dataset
 */
function withEdges(...extra: GraphEdge[]): Dataset {
  const ds = sampleDataset();
  return { ...ds, edges: [...ds.edges, ...extra] };
}

/**
 * 属性 1 つを指定した人物ノードを作る。
 * @param key - 属性のキー
 * @param value - 値
 * @returns ノード
 */
function personWith(key: string, value: AttrValue): GraphNode {
  return node('t', personType, 't', { attrs: makeAttrs([[key, value]]) });
}

describe('checkDataset（FR-DM-01〜08）', () => {
  it('FR-DM-08: 同名異人、往復、多重エッジ、自己ループ、孤立ノードを含んでも問題なし', () => {
    expect(checkDataset(sampleDataset())).toEqual([]);
  });

  it('FR-DM-08: 自己ループと多重エッジだけを足しても問題にしない', () => {
    const ds = withEdges(
      edge('self', 'p1', 'p1'),
      edge('dup1', 'p1', 'p2'),
      edge('dup2', 'p1', 'p2'),
    );
    expect(checkDataset(ds)).toEqual([]);
  });

  it('FR-DM-01: ノード ID、エッジ ID、ノード型 ID、schema のキーの重複を報告する', () => {
    const ds = sampleDataset();
    const dup: Dataset = {
      ...ds,
      nodes: [...ds.nodes, node('p1')],
      edges: [...ds.edges, edge('e1', 'p1', 'p2')],
      nodeTypes: [...ds.nodeTypes, { id: personType, label: '重複' }],
      schema: [
        ...ds.schema,
        { key: 'note', label: '重複', appliesTo: 'node', valueType: 'string' },
      ],
    };
    expect(checkDataset(dup)).toEqual([
      { code: 'duplicate-node-type-id', owner: { entity: 'nodeType', id: personType } },
      { code: 'duplicate-node-id', owner: { entity: 'node', id: toNodeId('p1') } },
      { code: 'duplicate-edge-id', owner: { entity: 'edge', id: ds.edges[0]?.id } },
      { code: 'duplicate-schema-key', owner: { entity: 'schema', id: 'note' }, appliesTo: 'node' },
    ]);
  });

  it('FR-DM-01: ノードとエッジで同じキーの schema は重複ではない', () => {
    const ds = sampleDataset();
    const both: Dataset = {
      ...ds,
      schema: [...ds.schema, { key: 'note', label: 'e', appliesTo: 'edge', valueType: 'string' }],
      edges: ds.edges.map((e) =>
        edge(e.id, e.source, e.target, {
          ...e,
          attrs: makeAttrs([
            ...Object.entries(e.attrs),
            ['note', { kind: 'missing', reason: 'unrecorded' }],
          ]),
        }),
      ),
    };
    expect(checkDataset(both)).toEqual([]);
  });

  it('FR-DM-02: 存在しないノードを指すエッジと、存在しない型のノードを報告する', () => {
    const ds = withEdges(edge('bad', 'ghost', 'p1'), edge('bad2', 'p1', 'ghost2'));
    const issues = checkDataset({ ...ds, nodes: [...ds.nodes, node('q', toNodeTypeId('nope'))] });
    expect(issues).toContainEqual({
      code: 'edge-dangling-endpoint',
      owner: { entity: 'edge', id: 'bad' },
      end: 'source',
      nodeId: 'ghost',
    });
    expect(issues).toContainEqual({
      code: 'edge-dangling-endpoint',
      owner: { entity: 'edge', id: 'bad2' },
      end: 'target',
      nodeId: 'ghost2',
    });
    expect(issues).toContainEqual({
      code: 'node-unknown-type',
      owner: { entity: 'node', id: 'q' },
      typeId: 'nope',
    });
  });

  it('FR-DM-03: graphMode とエッジの directed の食い違いを報告する（mixed は報告しない）', () => {
    const ds = sampleDataset();
    expect(codes({ ...ds, graphMode: 'directed' })).toEqual(['graph-mode-mismatch']); // e4 だけ無向
    expect(codes({ ...ds, graphMode: 'undirected' })).toHaveLength(ds.edges.length - 1);
    expect(codes(ds)).toEqual([]);
  });

  it('FR-DM-05: 属性、ノード、エッジの日付で earliest > latest を報告する', () => {
    const inverted = { ...hijriDate, earliest: 10, latest: 5 };
    const ds = sampleDataset();
    const bad: Dataset = {
      ...ds,
      nodes: [
        ...ds.nodes,
        node('d1', personType, 'd1', {
          attrs: makeAttrs([['born', { kind: 'date', value: [hijriDate, inverted] }]]),
          time: { kind: 'span', start: inverted },
        }),
      ],
      edges: [
        ...ds.edges,
        edge('d2', 'p1', 'p2', { time: { kind: 'span', start: day(1), end: inverted } }),
      ],
    };
    const paths = checkDataset(bad).flatMap((i) =>
      i.code === 'date-range-inverted' ? [i.path] : [],
    );
    expect(paths).toEqual(['time.start', 'attrs.born[1]', 'time.end']);
  });

  it('FR-DM-05: 整数でない日（NaN、小数、安全でない大きさ）を報告する', () => {
    const bad = (earliest: number) =>
      node(`n${String(earliest)}`, personType, 'n', {
        time: { kind: 'span', start: { ...hijriDate, earliest, latest: 2_400_000 } },
      });
    const issues = checkDataset(withNodes(bad(Number.NaN), bad(1.5), bad(2 ** 60)));
    expect(issues.map((i) => i.code)).toEqual(Array<string>(3).fill('date-not-integer'));
    expect(issues[0]).toMatchObject({ path: 'time.start.earliest' });
  });

  it('FR-DM-05: 期間の start が end より後なら報告、幅の重なりや終わり不明は報告しない', () => {
    const reversed = node('r', personType, 'r', {
      time: { kind: 'span', start: day(200), end: day(100) },
    });
    expect(checkDataset(withNodes(reversed))).toEqual([
      {
        code: 'span-inverted',
        owner: { entity: 'node', id: 'r' },
        path: 'time',
        startEarliest: 200,
        endLatest: 100,
      },
    ]);
    const ok = node('ok', personType, 'ok', {
      time: { kind: 'span', start: bceDate, end: hijriDate },
    });
    const overlap = node('ov', personType, 'ov', {
      time: { kind: 'span', start: hijriDate, end: hijriDate },
    });
    const open = node('op', personType, 'op', {
      time: { kind: 'span', start: hijriDate, end: { kind: 'missing', reason: 'lost' } },
    });
    expect(checkDataset(withNodes(ok, overlap, open))).toEqual([]);
  });

  it('FR-IN-06: 範囲外または非有限の座標を報告する。欠損と項目なしは報告しない', () => {
    const geo = (lat: number, lon: number) =>
      node(`g${String(lat)}_${String(lon)}`, personType, 'g', { geo: { kind: 'point', lat, lon } });
    const bad = withNodes(
      geo(91, 0),
      geo(0, -181),
      geo(Number.NaN, 0),
      geo(0, Number.POSITIVE_INFINITY),
    );
    expect(codes(bad)).toEqual(Array<string>(4).fill('geo-out-of-range'));
    // 境界の値は許す
    expect(checkDataset(withNodes(geo(-90, 180), geo(90, -180)))).toEqual([]);
  });

  it('FR-GR-01: 負または非有限の重みを報告する。0 は許す', () => {
    const ds = withEdges(
      edge('w1', 'p1', 'p2', { weight: -1 }),
      edge('w2', 'p1', 'p2', { weight: Number.NaN }),
      edge('w3', 'p1', 'p2', { weight: Number.POSITIVE_INFINITY }),
      edge('w4', 'p1', 'p2', { weight: 0 }),
    );
    expect(checkDataset(ds).map((i) => (i.code === 'weight-invalid' ? i.owner.id : ''))).toEqual([
      'w1',
      'w2',
      'w3',
    ]);
  });

  it('FR-IN-06: schema にない属性キーを報告する（ノードとエッジで別々に見る）', () => {
    const ds = sampleDataset();
    const bad: Dataset = {
      ...ds,
      nodes: [
        ...ds.nodes,
        node('k', personType, 'k', {
          attrs: makeAttrs([
            ['unknown', { kind: 'value', value: 1 }],
            ['amount', { kind: 'value', value: 1 }],
          ]),
        }),
      ],
      edges: [
        ...ds.edges,
        edge('ek', 'p1', 'p2', { attrs: makeAttrs([['role', { kind: 'value', value: 'x' }]]) }),
      ],
    };
    expect(checkDataset(bad)).toEqual([
      { code: 'attribute-not-in-schema', owner: { entity: 'node', id: 'k' }, key: 'unknown' },
      // amount はエッジ用の属性なので、ノードが持つと不正
      { code: 'attribute-not-in-schema', owner: { entity: 'node', id: 'k' }, key: 'amount' },
      { code: 'attribute-not-in-schema', owner: { entity: 'edge', id: 'ek' }, key: 'role' },
    ]);
  });

  it('FR-DM-07: 有限でない数と空の値（空文字、空の配列、複数値の要素）を報告する', () => {
    const number: AttributeDef = {
      key: 'n',
      label: 'n',
      appliesTo: 'node',
      valueType: 'number',
      multi: { separator: ';' },
    };
    const text: AttributeDef = {
      key: 's',
      label: 's',
      appliesTo: 'node',
      valueType: 'string',
      multi: { separator: ';' },
    };
    const dates: AttributeDef = {
      key: 'ds',
      label: 'd',
      appliesTo: 'node',
      valueType: 'date',
      multi: { separator: ';' },
    };
    const ds = sampleDataset();
    const bad: Dataset = {
      ...ds,
      edges: [],
      schema: [...ds.schema, number, text, dates],
      nodes: [
        node('x', personType, 'x', {
          attrs: makeAttrs([
            ['n', { kind: 'value', value: [1, Number.NaN, Number.NEGATIVE_INFINITY] }],
            ['s', { kind: 'value', value: ['a', ''] }],
            ['note', { kind: 'value', value: '' }],
            ['role', { kind: 'value', value: [] }],
            ['ds', { kind: 'date', value: [] }],
          ]),
        }),
      ],
    };
    const got = checkDataset(bad)
      .map((i) => `${i.code}:${'path' in i ? i.path : ''}`)
      .sort();
    expect(got).toEqual(
      [
        'non-finite-scalar:attrs.n.value[1]',
        'non-finite-scalar:attrs.n.value[2]',
        'empty-value:attrs.s.value[1]',
        'empty-value:attrs.note.value[0]',
        'empty-value:attrs.role',
        'empty-value:attrs.ds',
      ].sort(),
    );
  });

  it.each<[string, string, AttrValue, string | undefined]>([
    ['date に value', 'born', { kind: 'value', value: 'x' }, 'value'],
    ['number に文字列', 'amount-n', { kind: 'value', value: 'x' }, 'string'],
    ['boolean に数', 'flag', { kind: 'value', value: 1 }, 'number'],
    ['string に date', 'note', { kind: 'date', value: hijriDate }, 'date'],
    ['category に数', 'role', { kind: 'value', value: ['a', 1] }, 'number'],
    ['multi なしで配列', 'note', { kind: 'value', value: ['a'] }, 'array'],
    ['multi なしの date 配列', 'born2', { kind: 'date', value: [hijriDate] }, 'array'],
    ['欠損はどの型でもよい', 'note', { kind: 'missing', reason: 'lost' }, undefined],
    ['boolean に真偽値', 'flag', { kind: 'value', value: true }, undefined],
    ['number に数', 'amount-n', { kind: 'value', value: 5 }, undefined],
  ])('FR-IN-06: schema の型と値の種類（%s）', (_name, key, value, found) => {
    const extraDefs: AttributeDef[] = [
      { key: 'amount-n', label: 'n', appliesTo: 'node', valueType: 'number' },
      { key: 'flag', label: 'f', appliesTo: 'node', valueType: 'boolean' },
      { key: 'born2', label: 'b', appliesTo: 'node', valueType: 'date' },
    ];
    const ds = sampleDataset();
    const base = personWith(key, value);
    // 追加の属性は Missing で埋め、検査対象のキーだけ値を差し替える
    const filled = node('t', personType, 't', {
      attrs: makeAttrs([
        ...extraDefs.map((d) => [d.key, { kind: 'missing', reason: 'unrecorded' }] as const),
        ...Object.entries(base.attrs),
      ]),
    });
    const issues = checkDataset({ ...ds, schema: [...ds.schema, ...extraDefs], nodes: [filled] });
    const mismatches = issues.filter((i) => i.code === 'attribute-type-mismatch');
    if (found === undefined) expect(mismatches).toEqual([]);
    else expect(mismatches).toMatchObject([{ key, found }]);
  });

  it('FR-IN-06: 存在しないノード型を指す schema を報告する', () => {
    const ds = sampleDataset();
    const bad: Dataset = {
      ...ds,
      schema: [
        ...ds.schema,
        {
          key: 'z',
          label: 'z',
          appliesTo: 'node',
          nodeType: toNodeTypeId('ghost'),
          valueType: 'string',
        },
      ],
    };
    expect(codes(bad)).toEqual(['schema-unknown-node-type']);
  });

  it('FR-IN-06: 型を限った属性を別の型のノードが持つと報告する（地名の region を人物が持つ）', () => {
    const bad = withNodes(personWith('region', { kind: 'value', value: 'x' }));
    expect(checkDataset(bad)).toEqual([
      {
        code: 'attribute-wrong-node-type',
        owner: { entity: 'node', id: 't' },
        key: 'region',
        expected: placeType,
      },
    ]);
  });

  it('FR-DM-04: 当てはまる属性のキーが無いと報告する（キーが無い ＝ 当てはまらない、は違反ではない）', () => {
    const ds = sampleDataset();
    // 人物は region に当てはまらないので、キーが無くてよい（sampleDataset がすでに満たしている）。
    const noNote = node('y', personType, 'y');
    const stripped = {
      ...noNote,
      attrs: makeAttrs(Object.entries(noNote.attrs).filter(([k]) => k !== 'note')),
    };
    const noAmount = { ...edge('z', 'p1', 'p2'), attrs: makeAttrs([]) };
    expect(
      checkDataset({ ...ds, nodes: [...ds.nodes, stripped], edges: [...ds.edges, noAmount] }),
    ).toEqual([
      { code: 'attribute-absent', owner: { entity: 'node', id: 'y' }, key: 'note' },
      { code: 'attribute-absent', owner: { entity: 'edge', id: 'z' }, key: 'amount' },
    ]);
  });

  it('FR-DM-01: 検査は入力を変更しない', () => {
    const ds = sampleDataset();
    const snapshot = JSON.stringify(ds);
    checkDataset(ds);
    expect(JSON.stringify(ds)).toBe(snapshot);
  });

  it('FR-DM-01: 空の Dataset は問題なし', () => {
    expect(
      checkDataset({
        graphMode: 'undirected',
        nodeTypes: [],
        nodes: [],
        edges: [],
        schema: [],
        meta: { title: '' },
      }),
    ).toEqual([]);
  });
});
