import { describe, expect, it } from 'vitest';
import { getAttr, parseDataset } from '../../core/model';
import { importTables } from './dataset';
import type { TableMapping } from './dataset';
import { parseTextTable } from './text';

const nodeMapping: TableMapping = { fields: { id: 0, label: 1, type: 2 }, attributes: [] };
const edgeMapping: TableMapping = { fields: { source: 0, target: 1 }, attributes: [] };
const nodes = parseTextTable('id,label,type\n1,محمد,person\n2,東京,place');

it('FR-IN-05 / FR-IN-07: 特殊列ごとの暦と座標の欠損理由を保持する', () => {
  const result = importTables(
    parseTextTable('name,start,end,lat,lon\nA,1050,1650,□,□'),
    parseTextTable('source,target\nA,A'),
    {
      fields: { label: 0, start: 1, end: 2, lat: 3, lon: 4 },
      attributes: [],
      missingTokens: [{ token: '□', reason: 'illegible' }],
      fieldOptions: {
        start: { type: 'date', calendar: 'hijri' },
        end: { type: 'date', calendar: 'gregorian' },
      },
    },
    edgeMapping,
  );
  expect(result.warnings).toEqual([]);
  expect(result.dataset?.nodes[0]).toMatchObject({
    time: { start: { calendar: 'hijri' }, end: { calendar: 'gregorian' } },
    geo: { kind: 'missing', reason: 'illegible' },
  });
  expect(parseDataset(result.dataset).ok).toBe(true);
});

it('FR-IN-06: 片側だけの座標欠損と異なる欠損理由を拒否し、列数警告を重複させない', () => {
  for (const coords of ['□,0', '□,〔欠〕']) {
    const result = importTables(
      parseTextTable(`name,lat,lon\nA,${coords}`),
      parseTextTable('source,target\nA,A'),
      {
        fields: { label: 0, lat: 1, lon: 2 },
        attributes: [],
        missingTokens: [
          { token: '□', reason: 'illegible' },
          { token: '〔欠〕', reason: 'lost' },
        ],
      },
      edgeMapping,
    );
    expect(result.dataset).toBeNull();
    expect(result.warnings[0]?.code).toBe('invalid-coordinate');
  }
  const result = importTables(
    parseTextTable('name\nA,extra'),
    parseTextTable('source,target'),
    { fields: { label: 0 }, attributes: [] },
    edgeMapping,
  );
  expect(result.warnings.filter((w) => w.code === 'column-count')).toHaveLength(1);
});

describe('FR-IN-03: 2 表を Dataset にする', () => {
  it('名前空間つき ID で結び、自己ループ・多重エッジを保つ', () => {
    const result = importTables(
      nodes,
      parseTextTable('source,target\n1,2\n1,2\n1,1'),
      nodeMapping,
      edgeMapping,
    );
    expect(result.warnings).toEqual([]);
    expect(result.dataset?.edges).toHaveLength(3);
    expect(result.dataset?.nodes[0]?.label).toBe('محمد');
    expect(result.dataset?.edges[0]?.source).toBe(result.dataset?.nodes[0]?.id);
    expect(result.dataset?.edges[2]?.target).toBe(result.dataset?.nodes[0]?.id);
    expect(parseDataset(result.dataset).ok).toBe(true);
  });
  it('同じ ID でも型が違えば別人。参照の型がない場合は曖昧さを報告する', () => {
    const table = parseTextTable('id,label,type\n1,A,person\n1,B,place');
    const edges = parseTextTable('source,target,sType,tType\n1,1,person,place');
    expect(
      importTables(table, edges, nodeMapping, edgeMapping).warnings.some(
        (w) => w.code === 'ambiguous-node',
      ),
    ).toBe(true);
    const result = importTables(table, edges, nodeMapping, {
      fields: { source: 0, target: 1, sourceType: 2, targetType: 3 },
      attributes: [],
    });
    expect(result.dataset?.nodes).toHaveLength(2);
    expect(result.dataset?.edges[0]?.source).not.toBe(result.dataset?.edges[0]?.target);
  });
  it('ID 列がない場合は NFC だけで合流し、同名異人への注意を出す', () => {
    const table = parseTextTable('name\né\né\nأحمد\nاحمد');
    const result = importTables(
      table,
      parseTextTable('source,target\né,أحمد'),
      { fields: { label: 0 }, attributes: [] },
      edgeMapping,
    );
    expect(result.dataset?.nodes).toHaveLength(3);
    expect(result.warnings).toMatchObject([{ code: 'merged-label', row: 3, severity: 'warning' }]);
  });
});

describe('FR-IN-05 / FR-IN-06 / FR-IN-07: 値と警告', () => {
  it('型、複数値、欠損、暦、座標、混在方向と重みを保つ', () => {
    const table = parseTextTable(
      'id,label,type,lat,lon,start,end,note\n1,A,p,35,139,1050,〔欠〕,□\n2,B,p,,,,,x',
    );
    const result = importTables(
      table,
      parseTextTable('source,target,weight,directed\n1,2,0,false'),
      {
        fields: { ...nodeMapping.fields, lat: 3, lon: 4, start: 5, end: 6 },
        timeOptions: {
          type: 'date',
          calendar: 'hijri',
          missingTokens: [{ token: '〔欠〕', reason: 'lost' }],
        },
        attributes: [
          {
            column: 7,
            key: '__proto__',
            label: 'note',
            type: 'string',
            missingTokens: [{ token: '□', reason: 'illegible' }],
          },
        ],
      },
      { fields: { source: 0, target: 1, weight: 2, directed: 3 }, attributes: [] },
      'mixed',
    );
    expect(result.warnings).toEqual([]);
    expect(result.dataset?.edges[0]).toMatchObject({ weight: 0, directed: false });
    expect(result.dataset?.nodes[0]).toMatchObject({
      geo: { kind: 'point', lat: 35, lon: 139 },
      time: { start: { calendar: 'hijri' }, end: { kind: 'missing', reason: 'lost' } },
    });
    const attrs = result.dataset?.nodes[0]?.attrs;
    expect(attrs && getAttr(attrs, '__proto__')).toEqual({ kind: 'missing', reason: 'illegible' });
    expect(parseDataset(result.dataset).ok).toBe(true);
  });
  it('不正な行を黙って捨てず、元表とすべての問題を返し Dataset を公開しない', () => {
    const nodeTable = parseTextTable(
      'id,label,type,lat,lon,start\n1,A,p,999,0,not-date\n1,B,p,0,0,1650',
    );
    const edgeTable = parseTextTable('source,target,weight\n1,absent,-1');
    const result = importTables(
      nodeTable,
      edgeTable,
      { fields: { ...nodeMapping.fields, lat: 3, lon: 4, start: 5 }, attributes: [] },
      { fields: { ...edgeMapping.fields, weight: 2 }, attributes: [] },
    );
    expect(result.dataset).toBeNull();
    expect(result.tables).toEqual({ node: nodeTable, edge: edgeTable });
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'invalid-date',
        'invalid-coordinate',
        'duplicate-id',
        'unknown-node',
        'invalid-value',
      ]),
    );
    expect(result.warnings.every((w) => w.row !== undefined)).toBe(true);
  });
  it('空 ID、型に合わない属性、列数の違い、重複エッジを報告する', () => {
    const result = importTables(
      parseTextTable('id,label,type\n,A,p\n2,B,p'),
      parseTextTable('source,target,id\n2,2,e\n2,2,e\n2'),
      nodeMapping,
      {
        fields: { ...edgeMapping.fields, id: 2 },
        attributes: [{ column: 0, key: 'bad', label: 'bad', type: 'boolean' }],
      },
    );
    expect(result.dataset).toBeNull();
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['invalid-value', 'column-count', 'duplicate-id']),
    );
  });
  it('列の対応が不正な場合は明示的に拒否する', () => {
    expect(() =>
      importTables(
        nodes,
        parseTextTable('source,target'),
        { fields: { label: 99 }, attributes: [] },
        edgeMapping,
      ),
    ).toThrow(RangeError);
    expect(() =>
      importTables(
        nodes,
        parseTextTable('source,target'),
        { fields: {}, attributes: [] },
        edgeMapping,
      ),
    ).toThrow(RangeError);
  });
});
