import { expect, it, vi } from 'vitest';
import type * as DatasetModule from './dataset';
import { importSingleTable } from './single';
import { parseTextTable } from './text';

// 【なぜ】2表APIの将来の整列を模擬する。変換自体は本物で行い、出力ノード順だけを変える。
vi.mock('./dataset', async (original) => {
  const actual = await original<typeof DatasetModule>();
  return {
    ...actual,
    importTables: (...args: Parameters<typeof actual.importTables>) => {
      const result = actual.importTables(...args);
      return {
        ...result,
        dataset:
          result.dataset === null
            ? null
            : { ...result.dataset, nodes: [...result.dataset.nodes].reverse() },
      };
    },
  };
});

it('FR-IN-04 / FR-DM-01: 2表APIの出力順が変わっても一時キーで元IDへ復元する', () => {
  const result = importSingleTable(parseTextTable('source,target\nA,B\nB,C'), {
    source: { column: 0, type: 'person', attributes: [] },
    target: { column: 1, type: 'person', attributes: [] },
  });
  const a = result.dataset?.nodes.find((node) => node.label === 'A');
  const b = result.dataset?.nodes.find((node) => node.label === 'B');
  const c = result.dataset?.nodes.find((node) => node.label === 'C');
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(c).toBeDefined();
  expect(result.dataset?.edges.map((edge) => [edge.source, edge.target])).toEqual([
    [a?.id, b?.id],
    [b?.id, c?.id],
  ]);
});
