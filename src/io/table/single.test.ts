import { describe, expect, it } from 'vitest';
import { getAttr, parseDataset, parseNodeId, checkDataset } from '../../core/model';
import { importSingleTable, type SingleTableMapping } from './single';
import { parseTextTable } from './text';

const mapping: SingleTableMapping = {
  source: { column: 0, type: 'sender', attributes: [] },
  target: { column: 1, type: 'receiver', attributes: [] },
};
describe('FR-IN-04: Palladio 式の 1 表', () => {
  it('両端の列を別のノード型にし、残余列を各ノードとエッジの属性へ割り当てる', () => {
    const table = parseTextTable(
      'sender,receiver,senderCity,receiverCity,note\nمحمد,東京,فاس,日本,書簡\nمحمد,大阪,فاس,日本,取引',
    );
    const before = JSON.stringify(table);
    const result = importSingleTable(
      table,
      {
        source: {
          column: 0,
          type: 'person',
          attributes: [{ column: 2, key: 'city', label: 'city', type: 'string' }],
        },
        target: {
          column: 1,
          type: 'place',
          attributes: [{ column: 3, key: 'country', label: 'country', type: 'category' }],
        },
        edge: {
          fields: {},
          attributes: [{ column: 4, key: 'note', label: 'note', type: 'string' }],
        },
      },
      'directed',
      '史料',
    );
    expect(result.dataset?.nodes).toHaveLength(3);
    expect(result.dataset?.edges).toHaveLength(2);
    expect(result.dataset?.schema).toHaveLength(3);
    const node = result.dataset?.nodes[0];
    expect(node?.type).toBe('person');
    expect(node && getAttr(node.attrs, 'city')).toEqual({ kind: 'value', value: 'فاس' });
    expect(result.dataset?.edges[0]?.attrs.note).toEqual({ kind: 'value', value: '書簡' });
    expect(result.dataset?.meta.title).toBe('史料');
    expect(parseDataset(result.dataset).ok).toBe(true);
    if (result.dataset !== null) expect(checkDataset(result.dataset)).toEqual([]);
    expect(result.table).toBe(table);
    expect(JSON.stringify(table)).toBe(before);
  });
  it('同じ綴りでも型が違えば別ノードにし、同型指定では自己ループと多重エッジを保つ', () => {
    const table = parseTextTable('source,target\nA,A\nA,A');
    expect(importSingleTable(table, mapping).dataset?.nodes).toHaveLength(2);
    const result = importSingleTable(table, {
      ...mapping,
      target: { ...mapping.target, type: 'sender' },
    });
    expect(result.dataset?.nodes).toHaveLength(1);
    expect(result.dataset?.edges).toHaveLength(2);
    expect(result.dataset?.edges[0]?.source).toBe(result.dataset?.edges[0]?.target);
    expect(result.dataset?.edges[0]?.id).not.toBe(result.dataset?.edges[1]?.id);
  });
  it('ラベル照合は NFC のみ。末尾空白とアラビア文字の綴りを勝手にまとめない', () => {
    const table = parseTextTable('source,target\né,é\nA,A \nأحمد,احمد');
    const result = importSingleTable(table, {
      ...mapping,
      target: { ...mapping.target, type: 'sender' },
    });
    expect(result.dataset?.nodes).toHaveLength(5);
    expect(result.warnings.filter((w) => w.code === 'generated-ids')).toHaveLength(1);
    expect(result.warnings.some((w) => w.severity === 'error')).toBe(false);
    expect(result.dataset?.nodes.some((node) => parseNodeId(node.id)?.text === 'A ')).toBe(true);
  });
  it('ID 列を指定すると同名異人を区別し、同じ人物を両端で共有する', () => {
    const table = parseTextTable('source,target,sid,tid\nA,A,1,2\nA,A,2,3');
    const result = importSingleTable(table, {
      source: { column: 0, idColumn: 2, type: 'person', attributes: [] },
      target: { column: 1, idColumn: 3, type: 'person', attributes: [] },
    });
    expect(result.dataset?.nodes).toHaveLength(3);
    expect(result.dataset?.edges[0]?.target).toBe(result.dataset?.edges[1]?.source);
    expect(result.warnings).toEqual([]);
    expect(result.dataset?.nodes.map((node) => parseNodeId(node.id)?.source)).toEqual([
      'key',
      'key',
      'key',
    ]);
  });
  it('同じ ID のラベル・属性競合はレコード番号つき警告にして最初の値を保持する', () => {
    const table = parseTextTable('source,target,sid,tid,age\nA,B,1,2,10\nA改,B,1,2,11');
    const result = importSingleTable(table, {
      source: {
        column: 0,
        idColumn: 2,
        type: 'person',
        attributes: [{ column: 4, key: 'age', label: 'age', type: 'number' }],
      },
      target: { column: 1, idColumn: 3, type: 'person', attributes: [] },
    });
    expect(result.warnings).toMatchObject([
      { code: 'label-conflict', row: 3, column: 'source', severity: 'warning' },
      { code: 'attribute-conflict', row: 3, column: 'age', severity: 'warning' },
    ]);
    const node = result.dataset?.nodes[0];
    expect(node?.label).toBe('A');
    expect(node && getAttr(node.attrs, 'age')).toEqual({ kind: 'value', value: 10 });
    expect(result.dataset?.nodes[1]?.attrs.age).toEqual({ kind: 'missing', reason: 'unrecorded' });
    expect(parseDataset(result.dataset).ok).toBe(true);
  });
  it('同型の両端に別々の属性を持たせ、後で現れた属性を追加する', () => {
    const table = parseTextTable('source,target,age,town\nA,B,20,Tokyo\nB,A,30,Fes');
    const result = importSingleTable(table, {
      source: {
        column: 0,
        type: 'person',
        attributes: [{ column: 2, key: 'age', label: 'age', type: 'number' }],
      },
      target: {
        column: 1,
        type: 'person',
        attributes: [{ column: 3, key: 'town', label: 'town', type: 'string' }],
      },
    });
    expect(result.dataset?.nodes[0]?.attrs).toMatchObject({
      age: { value: 20 },
      town: { value: 'Fes' },
    });
    expect(result.dataset?.nodes[1]?.attrs).toMatchObject({
      age: { value: 30 },
      town: { value: 'Tokyo' },
    });
    expect(result.warnings.filter((w) => w.code === 'attribute-conflict')).toHaveLength(0);
  });
  it('欠損理由・列ごとの暦・複数値は T1-06 と同じ規則で変換する', () => {
    const table = parseTextTable('source,target,born,tags,date\nA,B,1050,a;b,1650\nA,C,□,c,1651');
    const result = importSingleTable(table, {
      ...mapping,
      missingTokens: [{ token: '□', reason: 'illegible' }],
      source: {
        ...mapping.source,
        attributes: [{ column: 2, key: 'born', label: 'born', type: 'date', calendar: 'hijri' }],
      },
      edge: {
        fields: { date: 4 },
        attributes: [{ column: 3, key: 'tags', label: 'tags', type: 'category', separator: ';' }],
      },
    });
    expect(result.dataset?.nodes[0]?.attrs.born).toMatchObject({
      kind: 'date',
      value: { calendar: 'hijri', label: '1050' },
    });
    expect(result.dataset?.edges[0]?.attrs.tags).toEqual({ kind: 'value', value: ['a', 'b'] });
    expect(result.dataset?.edges[0]?.time).toMatchObject({
      start: { calendar: 'gregorian', label: '1650' },
    });
    expect(result.warnings.find((w) => w.code === 'attribute-conflict')).toMatchObject({
      row: 3,
      column: 'born',
    });
  });
  it('特殊な ID・属性キーと混在の方向・重み・エッジ ID を保持する', () => {
    const table = parseTextTable(
      'source,target,sid,tid,directed,weight,id,__proto__\nA,B,__proto__,constructor,false,0,edge1,yes',
    );
    const result = importSingleTable(
      table,
      {
        source: {
          column: 0,
          idColumn: 2,
          type: 'person',
          attributes: [{ column: 7, key: '__proto__', label: 'note', type: 'string' }],
        },
        target: { column: 1, idColumn: 3, type: 'person', attributes: [] },
        edge: { fields: { id: 6, directed: 4, weight: 5 }, attributes: [] },
      },
      'mixed',
    );
    expect(result.dataset?.edges[0]).toMatchObject({ id: 'edge1', directed: false, weight: 0 });
    const node = result.dataset?.nodes[0];
    expect(node && getAttr(node.attrs, '__proto__')).toEqual({ kind: 'value', value: 'yes' });
    expect(parseDataset(result.dataset).ok).toBe(true);
  });
  it('変換エラーはすべて報告し、原文の全行を保ち Dataset を公開しない', () => {
    const table = parseTextTable('source,target,id,age,weight\nA,B,,abc,-1\n,C,3,20,1');
    const result = importSingleTable(table, {
      source: {
        column: 0,
        idColumn: 2,
        type: 'person',
        attributes: [{ column: 3, key: 'age', label: 'age', type: 'number' }],
      },
      target: mapping.target,
      edge: { fields: { weight: 4 }, attributes: [] },
    });
    expect(result.dataset).toBeNull();
    expect(result.table).toBe(table);
    expect(result.table.rows).toHaveLength(2);
    expect(result.warnings.filter((w) => w.severity === 'error').length).toBeGreaterThan(1);
  });
  it('列数エラーやExcelセル警告を生成表で隠さない', () => {
    const table = parseTextTable('source,target\nA,B\nC');
    const result = importSingleTable(table, mapping);
    expect(result.dataset).toBeNull();
    expect(result.warnings.find((w) => w.code === 'column-count')).toMatchObject({
      row: 3,
      table: 'single',
    });
    const excel = importSingleTable(
      {
        ...table,
        rows: [['A', 'B']],
        warnings: [{ code: 'excel-cell', row: 2, message: 'bad date' }],
      },
      mapping,
    );
    expect(excel.dataset).toBeNull();
    expect(excel.warnings.find((w) => w.code === 'excel-cell')).toMatchObject({
      row: 2,
      message: 'bad date',
    });
  });
  it('空の表でも型と属性の定義を返す', () => {
    const result = importSingleTable(parseTextTable('source,target'), mapping);
    expect(result.dataset?.nodes).toEqual([]);
    expect(result.dataset?.nodeTypes).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });
  it('異なるノード型の同じ属性キーを拒否し、別キーなら整合した Dataset を返す', () => {
    const table = parseTextTable('source,target,sourceCity,targetCity\nA,B,Fes,Tokyo');
    const config: SingleTableMapping = {
      source: {
        column: 0,
        type: 'person',
        attributes: [{ column: 2, key: 'city', label: 'city', type: 'string' }],
      },
      target: {
        column: 1,
        type: 'place',
        attributes: [{ column: 3, key: 'city', label: 'city', type: 'string' }],
      },
    };
    expect(() => importSingleTable(table, config)).toThrow('異なるノード型の属性には異なるキー');
    const result = importSingleTable(table, {
      source: {
        ...config.source,
        attributes: [{ column: 2, key: 'sourceCity', label: 'city', type: 'string' }],
      },
      target: {
        ...config.target,
        attributes: [{ column: 3, key: 'targetCity', label: 'city', type: 'string' }],
      },
    });
    expect(result.dataset).not.toBeNull();
    if (result.dataset !== null) {
      expect(checkDataset(result.dataset)).toEqual([]);
      expect(result.dataset.schema.map((attr) => attr.key)).toEqual(['sourceCity', 'targetCity']);
      expect(getAttr(result.dataset.nodes[0]?.attrs ?? {}, 'sourceCity')).toEqual({
        kind: 'value',
        value: 'Fes',
      });
      expect(getAttr(result.dataset.nodes[1]?.attrs ?? {}, 'targetCity')).toEqual({
        kind: 'value',
        value: 'Tokyo',
      });
    }
  });
  it('不正な対応、同型の不一致、生成参照列への指定を拒否する', () => {
    const table = parseTextTable('source,target,age');
    expect(() =>
      importSingleTable(table, { ...mapping, source: { ...mapping.source, type: ' ' } }),
    ).toThrow(RangeError);
    expect(() =>
      importSingleTable(table, { ...mapping, edge: { fields: { weight: 3 }, attributes: [] } }),
    ).toThrow(RangeError);
    expect(() =>
      importSingleTable(table, { ...mapping, source: { ...mapping.source, column: -1 } }),
    ).toThrow(RangeError);
    expect(() =>
      importSingleTable(table, {
        source: {
          column: 0,
          type: 'p',
          attributes: [{ column: 2, key: 'age', label: 'age', type: 'number' }],
        },
        target: {
          column: 1,
          type: 'p',
          attributes: [{ column: 2, key: 'age', label: 'age', type: 'string' }],
        },
      }),
    ).toThrow(RangeError);
  });
});

it('FR-IN-04 / FR-IN-06: 無効な端点でも同じ行の属性の問題をすべて報告する', () => {
  const table = parseTextTable('source,target,sid,tid,n\n,B,,b,bad');
  const result = importSingleTable(table, {
    source: {
      column: 0,
      idColumn: 2,
      type: 'p',
      attributes: [{ column: 4, key: 'n', label: 'n', type: 'number' }],
    },
    target: { column: 1, idColumn: 3, type: 'p', attributes: [] },
  });
  expect(result.dataset).toBeNull();
  expect(result.table).toBe(table);
  expect(result.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-value', column: 'n', row: 2, severity: 'error' }),
      expect.objectContaining({
        code: 'invalid-value',
        column: 'source',
        row: 2,
        severity: 'error',
      }),
    ]),
  );
});

it.each([
  { first: 'a;b', second: 'b;a', expected: ['a', 'b'] },
  { first: 'b;a', second: 'a;b', expected: ['b', 'a'] },
])(
  'FR-IN-04 / FR-DM-07: 複数値は原文の順序を保持し順序違いも競合として知らせる ($first)',
  ({ first, second, expected }) => {
    const result = importSingleTable(
      parseTextTable(`source,target,tags\nA,B,${first}\nA,B,${second}`),
      {
        source: {
          column: 0,
          type: 'p',
          attributes: [{ column: 2, key: 'tags', label: 'tags', type: 'category', separator: ';' }],
        },
        target: { column: 1, type: 'p', attributes: [] },
      },
    );
    expect(result.dataset?.nodes[0]?.attrs.tags).toEqual({ kind: 'value', value: expected });
    expect(result.warnings.filter((w) => w.code === 'attribute-conflict')).toMatchObject([
      { row: 3, column: 'tags' },
    ]);
  },
);

it('FR-IN-04 / FR-IN-07: 最初の欠損理由を後の値で自動補完せず逆順でも先頭値を保つ', () => {
  for (const firstMissing of [true, false]) {
    const first = firstMissing ? '□' : '20';
    const second = firstMissing ? '20' : '□';
    const result = importSingleTable(
      parseTextTable(`source,target,n\nA,B,${first}\nA,B,${second}`),
      {
        source: {
          column: 0,
          type: 'p',
          attributes: [{ column: 2, key: 'n', label: 'n', type: 'number' }],
        },
        target: { column: 1, type: 'p', attributes: [] },
        missingTokens: [{ token: '□', reason: 'lost' }],
      },
    );
    expect(result.dataset?.nodes[0]?.attrs.n).toEqual(
      firstMissing ? { kind: 'missing', reason: 'lost' } : { kind: 'value', value: 20 },
    );
    expect(result.warnings.filter((w) => w.code === 'attribute-conflict')).toHaveLength(1);
  }
});

it('FR-IN-07: 空表・属性なしでも各範囲の空欠損記号を拒否する', () => {
  const invalid = [{ token: '', reason: 'lost' }] as const; // 【TS】欠損理由を文字列リテラルに保つ。
  const configs: readonly SingleTableMapping[] = [
    { ...mapping, missingTokens: invalid },
    { ...mapping, edge: { fields: {}, attributes: [], missingTokens: invalid } },
    {
      ...mapping,
      edge: { fields: {}, attributes: [], timeOptions: { type: 'date', missingTokens: invalid } },
    },
    {
      ...mapping,
      edge: {
        fields: {},
        attributes: [],
        fieldOptions: { date: { type: 'date', missingTokens: invalid } },
      },
    },
    {
      ...mapping,
      source: {
        ...mapping.source,
        attributes: [{ column: 2, key: 'n', label: 'n', type: 'number', missingTokens: invalid }],
      },
    },
  ];
  for (const config of configs)
    expect(() => importSingleTable(parseTextTable('source,target,n'), config)).toThrow(RangeError);
});

it('FR-IN-05: 空欄セルより先に区切り設定を検査し、通常の空欄は欠損として読む', () => {
  const config: SingleTableMapping = {
    ...mapping,
    source: {
      ...mapping.source,
      attributes: [{ column: 2, key: 'n', label: 'n', type: 'number', separator: '' }],
    },
  };
  expect(() => importSingleTable(parseTextTable('source,target,n'), config)).toThrow(RangeError);
  const result = importSingleTable(parseTextTable('source,target,n\nA,B,'), {
    ...config,
    source: { ...config.source, attributes: [{ column: 2, key: 'n', label: 'n', type: 'number' }] },
  });
  expect(result.dataset?.nodes[0]?.attrs.n).toEqual({ kind: 'missing', reason: 'unrecorded' });
});

it('FR-IN-04: 明示的undefinedの任意列設定でも空表を受け付ける', () => {
  const result = importSingleTable(parseTextTable('source,target'), {
    ...mapping,
    edge: { fields: {}, attributes: [], fieldOptions: { date: undefined } },
  });
  expect(result.dataset?.nodes).toEqual([]);
  expect(result.warnings).toEqual([]);
});
