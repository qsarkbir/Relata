import { describe, expect, it } from 'vitest';
import { applyFilters, DEFAULT_FILTER_STATE, toFilterId } from '../../core/filter';
import { filterDataset, num, mkEdge } from '../../core/filter/fixtures/filterDataset';
import { makeAttrs, toNodeId } from '../../core/model';
import { computeMetrics } from '../../core/metrics';
import { buildGraph, toSnapshot } from '../../core/graph';
import { parseTextTable } from '../table/text';
import { encodeCsv, exportDatasetCsv, exportMetricsCsv } from './csv';

describe('FR-OUT-02 / R-12: CSV', () => {
  it('BOM既定あり・CRLF・RFC4180の引用でUnicodeと改行を保つ', () => {
    const raw = [
      ['id', 'label'],
      ['a', 'محمد, "東京"\r\nnext'],
    ];
    const text = encodeCsv(raw);
    expect(text.startsWith('\ufeff')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(parseTextTable(text).rows).toEqual([raw[1]]);
    expect(encodeCsv(raw, { bom: false }).startsWith('\ufeff')).toBe(false);
  });
  it('式候補と元々の先頭アポストロフィは明示読戻しで原文に戻り、通常CSVは勝手に外さない', () => {
    const values = [
      '=HYPERLINK("x")',
      '+SUM(1)',
      '-1+2',
      '@SUM(1)',
      ' \t=1',
      '\tword',
      '\nword',
      "'=real",
      "'ordinary",
      "''",
      'safe',
    ];
    const text = encodeCsv([['value'], ...values.map((value) => [value])]);
    expect(
      parseTextTable(text, ',', { formulaProtection: true }).rows.map((row) => row[0]),
    ).toEqual(values);
    expect(parseTextTable(text).rows[0]?.[0]).toBe("'" + (values[0] ?? ''));
    expect(parseTextTable("value\n'=user").rows[0]?.[0]).toBe("'=user");
    expect(
      parseTextTable(encodeCsv([['value'], ['=1']], { formulaProtection: false })).rows,
    ).toEqual([['=1']]);
  });
  it('実際の数値と真偽値は文字列の式候補とは区別し、非有限値は拒否する', () => {
    expect(encodeCsv([[-2, false, '-2']], { bom: false })).toBe("-2,false,'-2\r\n");
    expect(() => encodeCsv([[Infinity]])).toThrow(RangeError);
  });
  it('ヘッダも式保護して戻し、空ファイル・空セルも解析できる', () => {
    const text = encodeCsv([
      ['=header', "'header"],
      ['', ''],
    ]);
    expect(parseTextTable(text, ',', { formulaProtection: true })).toMatchObject({
      headers: ['=header', "'header"],
      rows: [['', '']],
    });
  });
});

describe('FR-OUT-02 / FR-MT-04: 現在の全対象', () => {
  it('表の50行ページを超える全120件を指標CSVへ保存する', () => {
    const original = filterDataset();
    const first = original.nodes[0];
    if (first === undefined) throw new Error('fixture');
    const dataset = {
      ...original,
      nodes: Array.from({ length: 120 }, (_, index) => ({
        ...first,
        id: toNodeId('node-' + String(index)),
      })),
      edges: [],
    };
    const filtered = applyFilters(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    const result = computeMetrics(toSnapshot(buildGraph(dataset, filtered)), {
      nodeMetrics: ['degree'],
      globalMetrics: [],
    });
    const output = parseTextTable(exportMetricsCsv(dataset, result).metrics.text);
    expect(output.rows).toHaveLength(120);
    expect(new Set(output.rows.map((row) => row[0])).size).toBe(120);
  });
  it('宣言済みschemaとown属性キーの和集合を出し、未宣言の値を落とさない', () => {
    const original = filterDataset();
    const first = original.nodes[0];
    if (first === undefined) throw new Error('fixture');
    const dataset = {
      ...original,
      nodes: [
        { ...first, attrs: makeAttrs([['unlisted', { kind: 'value', value: 'kept' }]]) },
        ...original.nodes.slice(1),
      ],
    };
    const table = parseTextTable(
      exportDatasetCsv(
        dataset,
        applyFilters(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true }),
      ).nodes.text,
    );
    expect(table.rows[0]?.[table.headers.indexOf('attr.unlisted')]).toBe('kept');
  });
  it('選ばれた元ノード・元エッジだけをcanonical IDで出し、多重辺をまとめない', () => {
    const original = filterDataset();
    const extra = mkEdge('parallel', 'p1', 'p2', num(30));
    const dataset = { ...original, edges: [...original.edges, extra] };
    const filtered = applyFilters(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    const files = exportDatasetCsv(dataset, filtered);
    const nodes = parseTextTable(files.nodes.text, ',', { formulaProtection: true });
    const edges = parseTextTable(files.edges.text, ',', { formulaProtection: true });
    expect(nodes.rows).toHaveLength(7);
    expect(edges.rows).toHaveLength(6);
    const ids = new Set(nodes.rows.map((row) => row[0]));
    for (const row of edges.rows) {
      expect(ids.has(row[1])).toBe(true);
      expect(ids.has(row[2])).toBe(true);
    }
    const narrow = applyFilters(dataset, {
      ...DEFAULT_FILTER_STATE,
      filters: [
        {
          kind: 'range',
          id: toFilterId('amount'),
          target: 'edge',
          attr: 'amount',
          min: 20,
          missing: 'exclude',
        },
      ],
    });
    expect(parseTextTable(exportDatasetCsv(dataset, narrow).edges.text).rows).toHaveLength(2);
  });
  it('欠損理由・属性なし・特殊キー・数値・複数値・日付を曖昧な結合なく出す', () => {
    const original = filterDataset();
    const dataset = {
      ...original,
      schema: [
        ...original.schema,
        { key: '__proto__', label: 'x', appliesTo: 'node' as const, valueType: 'string' as const },
      ],
      nodes: original.nodes.map((node) =>
        node.id === toNodeId('p1')
          ? {
              ...node,
              attrs: makeAttrs([
                ...Object.entries(node.attrs),
                ['__proto__', { kind: 'value', value: ['a;b', 'c'] }],
              ]),
            }
          : node,
      ),
    };
    const filtered = applyFilters(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    const table = parseTextTable(exportDatasetCsv(dataset, filtered).nodes.text, ',', {
      formulaProtection: true,
    });
    expect(new Set(table.headers).size).toBe(table.headers.length);
    const p1 = table.rows.find((row) => row[0] === 'p1');
    const p3 = table.rows.find((row) => row[0] === 'p3');
    const c1 = table.rows.find((row) => row[0] === 'c1');
    expect(p1?.[table.headers.indexOf('attr.__proto__')]).toBe('["a;b","c"]');
    expect(p3?.[table.headers.indexOf('attr.role')]).toBe('');
    expect(p3?.[table.headers.indexOf('missing.role')]).toBe('lost');
    expect(c1?.[table.headers.indexOf('kind.role')]).toBe('not-applicable');
    expect(JSON.parse(p1?.[table.headers.indexOf('time')] ?? '{}')).toMatchObject({
      kind: 'span',
      start: { calendar: 'gregorian' },
    });
  });
  it('指標は全nodeIdsと一致し、向き・HITS別列・失敗statusを0と区別する', () => {
    const dataset = filterDataset();
    const filtered = applyFilters(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    const result = computeMetrics(toSnapshot(buildGraph(dataset, filtered)));
    const files = exportMetricsCsv(dataset, result);
    const nodes = parseTextTable(files.metrics.text);
    const global = parseTextTable(files.global.text);
    expect(nodes.rows).toHaveLength(result.nodeIds.length);
    expect(nodes.headers).toContain('degree.in');
    expect(nodes.headers).toContain('degree.out');
    expect(nodes.headers).toContain('eigenvector.hubs');
    expect(nodes.headers).toContain('eigenvector.authorities');
    const failed = exportMetricsCsv(dataset, {
      ...result,
      global: { reciprocity: { ok: false, code: 'notApplicable', message: 'no' } },
      node: { degree: { ok: false, code: 'unexpected', message: 'no' } },
    });
    const failedNodes = parseTextTable(failed.metrics.text);
    expect(failedNodes.rows[0]?.[failedNodes.headers.indexOf('degree.status')]).toBe('unexpected');
    const failedGlobal = parseTextTable(failed.global.text);
    expect(failedGlobal.rows.find((row) => row[0] === 'reciprocity')).toEqual([
      'reciprocity',
      '',
      'notApplicable',
      'directed',
      JSON.stringify(result.notes),
    ]);
    expect(global.rows.find((row) => row[0] === 'nodeCount')?.[1]).toBe(
      String(result.nodeIds.length),
    );
  });
});
