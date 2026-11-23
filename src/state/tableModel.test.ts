import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER_STATE, applyFilters } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { toNodeId, toNodeTypeId } from '../core/model';
import type { Dataset } from '../core/model';
import {
  attrColumnKey,
  getTableColumns,
  getTableRows,
  pageCount,
  visibleColumns,
} from './tableModel';
import { TABLE_PAGE_SIZE } from './tableModel';

// テストの前提として在るはずの値を取り出す。無ければ失敗にする。
function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('テストの前提が崩れています');
  return x;
}

const dataset = sampleDataset();
const all = applyFilters(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });

describe('表の行（絞り込み後の集合）', () => {
  it('FR-TB-01: 行は絞り込みの結果に含まれるものだけで、元のデータの順', () => {
    const rows = getTableRows(dataset, all, 'node', null, 'en');
    expect(rows.map((r) => r.id)).toEqual(dataset.nodes.map((n) => n.id));
    // 孤立ノードを既定（表示しない）で除くと、表からも消える。
    const filtered = applyFilters(dataset, DEFAULT_FILTER_STATE);
    const without = getTableRows(dataset, filtered, 'node', null, 'en');
    expect(without.map((r) => r.id)).not.toContain('lonely');
    expect(without).toHaveLength(filtered.counts.nodes.shown);
    expect(getTableRows(dataset, filtered, 'edge', null, 'en')).toHaveLength(
      filtered.counts.edges.shown,
    );
  });

  it('FR-TB-01: 同じ入力なら同じ配列を返す（ページ送りで並べ直さない）', () => {
    const sort = { column: 'label', direction: 'asc' } as const;
    expect(getTableRows(dataset, all, 'node', sort, 'en')).toBe(
      getTableRows(dataset, all, 'node', sort, 'en'),
    );
  });

  it('FR-TB-01: 並べ替えは昇順・降順で、欠損は向きによらず末尾', () => {
    const born = attrColumnKey('role');
    const asc = getTableRows(dataset, all, 'node', { column: born, direction: 'asc' }, 'en');
    const desc = getTableRows(dataset, all, 'node', { column: born, direction: 'desc' }, 'en');
    // role が値を持つのは p1 だけ（ほかは欠損か当てはまらない）。
    expect(asc[0]?.id).toBe('p1');
    expect(desc[0]?.id).toBe('p1');
    const weights = getTableRows(
      dataset,
      all,
      'edge',
      { column: 'weight', direction: 'desc' },
      'en',
    );
    expect(weights.map((r) => r.id)).toEqual(['e3', 'e1', 'e2', 'e4', 'e6', 'e5']);
  });

  it('FR-TB-01: 並べ替えは安定で、数は数として比べる（p2 は p10 より前）', () => {
    const base = sampleDataset();
    const many: Dataset = {
      ...base,
      nodes: ['p10', 'p2', 'p1'].map((id) => ({
        ...must(base.nodes[0]),
        id: toNodeId(id),
        label: id,
      })),
    };
    const result = applyFilters(many, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    const rows = getTableRows(many, result, 'node', { column: 'label', direction: 'asc' }, 'en');
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p10']);
  });

  it('FR-TB-01: 実在しない列の並べ替えは、データの順', () => {
    const rows = getTableRows(
      dataset,
      all,
      'node',
      { column: 'attr:gone', direction: 'asc' },
      'en',
    );
    expect(rows.map((r) => r.id)).toEqual(dataset.nodes.map((n) => n.id));
  });
});

describe('表の列とセル', () => {
  it('FR-TB-01: 既定の列は空でない列だけ。属性の列は属性の名前（ラベル）を見出しにする', () => {
    const columns = getTableColumns(dataset, 'node');
    const keys = visibleColumns(columns, null).map((c) => c.key);
    expect(keys).toContain('label');
    expect(keys).toContain('time');
    expect(keys).not.toContain('certainty'); // 確からしさを持つノードが無い
    expect(keys).toContain(attrColumnKey('role'));
    const edgeKeys = visibleColumns(getTableColumns(dataset, 'edge'), null).map((c) => c.key);
    expect(edgeKeys).toContain('sourceLabel');
    expect(edgeKeys).not.toContain('sourceId'); // ID の列は選べるが既定では出さない
    expect(edgeKeys).toContain('directed'); // 向きが混在するデータ
  });

  it('FR-TB-01: 保存した列のうち、今のデータに無いものは外す。空配列は「すべて外した」', () => {
    const columns = getTableColumns(dataset, 'node');
    expect(visibleColumns(columns, ['label', 'attr:gone']).map((c) => c.key)).toEqual(['label']);
    expect(visibleColumns(columns, [])).toEqual([]);
  });

  it('FR-DM-04: 欠損は理由つきで、属性が無い行は理由の無い欠損（当てはまらない）', () => {
    const columns = getTableColumns(dataset, 'node');
    const cell = (key: string, id: string) =>
      must(columns.find((c) => c.key === key)).cell(must(dataset.nodes.find((n) => n.id === id)));
    expect(cell('attr:role', 'p3')).toEqual({ kind: 'missing', reason: 'lost' });
    expect(cell('attr:region', 'p1')).toEqual({ kind: 'missing', reason: null });
    expect(cell('attr:role', 'p1')).toMatchObject({
      kind: 'values',
      certainty: 'probable',
      items: [
        { kind: 'text', text: 'qadi' },
        { kind: 'text', text: 'scholar' },
      ],
    });
    // 日付は入力どおりの表記、期間は始点 – 終点、終わりが不明な期間は始点だけ。
    expect(cell('attr:born', 'p1')).toMatchObject({ kind: 'values', items: [{ kind: 'date' }] });
    expect(cell('time', 'p5')).toMatchObject({ items: [{ kind: 'date' }] });
    expect(cell('time', 'p3')).toEqual({ kind: 'missing', reason: 'not-applicable' });
    expect(cell('type', 'pl1')).toEqual({
      kind: 'values',
      items: [{ kind: 'text', text: '地名' }],
    });
  });

  it('FR-TB-01: エッジ表は端のノードのラベルを出す（ID ではない）', () => {
    const columns = getTableColumns(dataset, 'edge');
    const e3 = must(dataset.edges.find((e) => e.id === 'e3'));
    expect(must(columns.find((c) => c.key === 'targetLabel')).cell(e3)).toEqual({
      kind: 'values',
      items: [{ kind: 'text', text: 'ابن خلدون' }],
    });
    expect(must(columns.find((c) => c.key === 'targetId')).cell(e3)).toEqual({
      kind: 'values',
      items: [{ kind: 'text', text: 'p3' }],
    });
  });

  it('FR-TB-01: 型の名前は辞書のとおり、列は同じ引数で使い回す', () => {
    expect(getTableColumns(dataset, 'node')).toBe(getTableColumns(dataset, 'node'));
    expect(toNodeTypeId('x')).toBe('x');
  });

  it('FR-TB-01: 数千行でもページ数で描く行を一定に保つ', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(TABLE_PAGE_SIZE)).toBe(1);
    expect(pageCount(TABLE_PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(5000)).toBe(Math.ceil(5000 / TABLE_PAGE_SIZE));
  });
});
