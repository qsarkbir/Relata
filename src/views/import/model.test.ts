import { expect, it } from 'vitest';
import { getAttr, checkDataset } from '../../core/model';
import { parseTextTable } from '../../io/table';
import { draftTable, previewImport, restorePossibleSuffix } from './model';
import type { ImportDraft } from './model';

function change(
  draft: ImportDraft,
  header: string,
  patch: Partial<ImportDraft['columns'][number]>,
): ImportDraft {
  return {
    ...draft,
    columns: draft.columns.map((column, index) =>
      draft.table.headers[index] === header ? { ...column, ...patch } : column,
    ),
  };
}
it('FR-IN-04: 1表の両端と属性先を設定し、元表を変更しない', () => {
  let draft = draftTable(
    parseTextTable('From,To,born,relation\nA,B,1050,teacher\nA,C,1050,friend'),
    'single',
    'paste',
  );
  draft = change(draft, 'born', { role: 'sourceAttr', type: 'date', calendar: 'hijri' });
  const before = JSON.stringify(draft);
  const result = previewImport('single', draft, null, 'person', 'person', 'directed', [], 'People');
  expect(result.dataset?.nodes).toHaveLength(3);
  expect(result.dataset?.edges).toHaveLength(2);
  const node = result.dataset?.nodes.find((item) => item.label === 'A');
  expect(node && getAttr(node.attrs, 'born')).toMatchObject({
    kind: 'date',
    value: { calendar: 'hijri', label: '1050' },
  });
  expect(result.dataset && checkDataset(result.dataset)).toEqual([]);
  expect(JSON.stringify(draft)).toBe(before);
});
it('FR-IN-03 / FR-IN-05: 2表の列を対応づけて方向・重みを保つ', () => {
  const nodes = draftTable(
    parseTextTable('id,label,type\n1,A,p\n2,B,p'),
    'node',
    'nodes.csv',
    'shift_jis',
  );
  const edges = draftTable(
    parseTextTable('source,target,weight,directed\n1,2,0,false'),
    'edge',
    'edges.csv',
    'utf-8',
  );
  const result = previewImport('pair', nodes, edges, '', '', 'mixed', [], 'Pair');
  expect(result.dataset?.edges[0]).toMatchObject({ weight: 0, directed: false });
  expect(result.settings.columnCalendars).toEqual([]);
  expect(result.settings.encoding).toBe('shift_jis');
  expect(result.dataset && checkDataset(result.dataset)).toEqual([]);
});
it('FR-IN-06: 参照のない行や不正日付を捨てずエラーにする', () => {
  const nodes = draftTable(parseTextTable('id,label,start\n1,A,invalid'), 'node', 'nodes');
  const edges = draftTable(parseTextTable('source,target\n1,absent'), 'edge', 'edges');
  const result = previewImport('pair', nodes, edges, '', '', 'directed', [], 'Pair');
  expect(result.dataset).toBeNull();
  expect(result.warnings.map((item) => item.code)).toEqual(
    expect.arrayContaining(['invalid-date', 'unknown-node']),
  );
  expect(nodes.table.rows).toHaveLength(1);
  expect(edges.table.rows).toHaveLength(1);
});
it('FR-IN-05 / FR-IN-07: 欠損理由と複数値を保ち、暦指定を保存する', () => {
  let draft = draftTable(
    parseTextTable('From,To,date,tags,note\nA,B,1050,x;y,□'),
    'single',
    'table',
  );
  draft = change(draft, 'date', { type: 'date', calendar: 'hijri' });
  draft = change(draft, 'tags', { separator: ';', type: 'category' });
  const result = previewImport(
    'single',
    draft,
    null,
    'p',
    'p',
    'directed',
    [{ token: '□', reason: 'illegible' }],
    'Dataset',
  );
  expect(result.dataset?.edges[0]?.attrs).toMatchObject({
    tags: { kind: 'value', value: ['x', 'y'] },
    note: { kind: 'missing', reason: 'illegible' },
  });
  expect(result.dataset?.edges[0]?.time).toMatchObject({ start: { calendar: 'hijri' } });
  // 1 表なので table は持たず、列名で保存する（D-24 補足）。
  expect(result.settings.columnCalendars).toEqual([{ column: 'date', calendar: 'hijri' }]);
});
it('FR-IN-05: 2表では、暦の指定に列名とどちらの表かを保存する（D-24 補足）', () => {
  const nodes = change(
    draftTable(parseTextTable('id,label,type,date\n1,A,p,800\n2,B,p,801'), 'node', 'n.csv'),
    'date',
    { type: 'date', calendar: 'hijri' },
  );
  const edges = change(
    draftTable(parseTextTable('source,target,date\n1,2,1400'), 'edge', 'e.csv'),
    'date',
    { type: 'date', calendar: 'gregorian' },
  );
  const result = previewImport('pair', nodes, edges, '', '', 'directed', [], 'Pair');
  expect(result.settings.columnCalendars).toEqual([
    { column: 'date', table: 'node', calendar: 'hijri' },
    { column: 'date', table: 'edge', calendar: 'gregorian' },
  ]);
});
it('FR-IN-06: 重複した特殊用途を上書きせず、設定エラーにする', () => {
  let draft = draftTable(parseTextTable('From,To,extra\nA,B,C'), 'single', 'table');
  draft = change(draft, 'extra', { role: 'source' });
  expect(() => previewImport('single', draft, null, 'p', 'p', 'directed', [], '')).toThrow(
    'duplicate-role',
  );
});
it('FR-IN-05 / FR-IN-06: 同名・空の見出しを上書きせず、確認済みの復号警告も結果に残す', () => {
  const raw = parseTextTable('id,label,note,note,\n1,A,x,y,z');
  const draft = {
    ...draftTable(raw, 'node', 'table'),
    decodeWarnings: [{ code: 'suspect-encoding' as const, message: 'Check encoding' }],
  };
  expect(new Set(draft.columns.map((column) => column.key)).size).toBe(5);
  const result = previewImport(
    'pair',
    draft,
    draftTable(parseTextTable('source,target\n1,1'), 'edge', 'edges'),
    '',
    '',
    'directed',
    [],
    '',
  );
  expect(result.warnings).toContainEqual({
    table: 'node',
    code: 'suspect-encoding',
    message: 'Check encoding',
    severity: 'warning',
  });
  expect(result.dataset?.nodes[0]?.attrs).toMatchObject({
    note: { kind: 'value', value: 'x' },
    'note [4]': { kind: 'value', value: 'y' },
  });
});

// ---- T2-01b: 確からしさ（D-37、FR-DM-06） ----
const CERTAINTY_CSV =
  'From,To,certainty,place,born\nأحمد,علي,probable,بغداد؟,1050?\nأحمد,سعيد,certain,Basra?,1060\nعلي,سعيد,?,Mosul,1070\nسعيد,أحمد,,Cairo,1080';
function certaintyDraft(suffix: boolean): ImportDraft {
  let draft = draftTable(parseTextTable(CERTAINTY_CSV), 'single', 'c.csv');
  draft = change(draft, 'place', { role: 'edgeAttr', possibleSuffix: suffix });
  // 日付の列に選択を付けても、設定にも変換にも効かない。
  return change(draft, 'born', { role: 'edgeAttr', type: 'date', possibleSuffix: suffix });
}
it('FR-DM-06: 列の役割「確からしさ」を、見出しから自動で対応づけて読む', () => {
  const draft = certaintyDraft(false);
  expect(draft.columns.find((c) => c.key === 'certainty')?.role).toBe('certainty');
  const result = previewImport('single', draft, null, 'person', 'person', 'directed', [], 'T');
  expect(result.dataset?.edges.map((e) => e.certainty)).toEqual([
    'probable',
    'certain',
    'possible',
    undefined,
  ]);
});
it('FR-DM-06: 末尾の ? の選択が変換に効き、既定（無効）では原文のまま', () => {
  const place = (suffix: boolean): unknown[] => {
    const result = previewImport(
      'single',
      certaintyDraft(suffix),
      null,
      'person',
      'person',
      'directed',
      [],
      'T',
    );
    return (result.dataset?.edges ?? []).map((e) => getAttr(e.attrs, 'place'));
  };
  expect(place(false)[0]).toEqual({ kind: 'value', value: 'بغداد؟' });
  expect(place(true)).toEqual([
    { kind: 'value', value: 'بغداد', certainty: 'possible' },
    { kind: 'value', value: 'Basra', certainty: 'possible' },
    { kind: 'value', value: 'Mosul' },
    { kind: 'value', value: 'Cairo' },
  ]);
});
it('FR-DM-06: 選択を possibleSuffixColumns に列名で保存し、日付の列は含めない', () => {
  const off = previewImport(
    'single',
    certaintyDraft(false),
    null,
    'person',
    'person',
    'directed',
    [],
    'T',
  );
  expect(off.settings.possibleSuffixColumns).toBeUndefined();
  const on = previewImport(
    'single',
    certaintyDraft(true),
    null,
    'person',
    'person',
    'directed',
    [],
    'T',
  );
  expect(on.settings.possibleSuffixColumns).toEqual([{ column: 'place' }]);
});
it('FR-DM-06: 保存した設定から選択を再現すると、変換の結果が元と一致する（1 表）', () => {
  const run = (draft: ImportDraft) =>
    previewImport('single', draft, null, 'person', 'person', 'directed', [], 'T');
  const original = run(certaintyDraft(true));
  const restored = run(
    restorePossibleSuffix(certaintyDraft(false), original.settings.possibleSuffixColumns),
  );
  expect(restored.dataset).toEqual(original.dataset);
  expect(restored.settings).toEqual(original.settings);
});
it('FR-DM-06: 2 表では表ごとに保存し、同名の列でも表を取り違えない', () => {
  const nodes = change(
    draftTable(parseTextTable('id,label,note\n1,A,x?\n2,B,y'), 'node', 'n.csv'),
    'note',
    { possibleSuffix: true },
  );
  const edges = draftTable(parseTextTable('source,target,note\n1,2,z?'), 'edge', 'e.csv');
  const run = (n: ImportDraft, e: ImportDraft) =>
    previewImport('pair', n, e, '', '', 'directed', [], 'P');
  const original = run(nodes, edges);
  expect(original.settings.possibleSuffixColumns).toEqual([{ column: 'note', table: 'node' }]);
  const refs = original.settings.possibleSuffixColumns;
  const restored = run(
    restorePossibleSuffix(draftTable(nodes.table, 'node', 'n.csv'), refs, 'node'),
    restorePossibleSuffix(draftTable(edges.table, 'edge', 'e.csv'), refs, 'edge'),
  );
  expect(restored.dataset).toEqual(original.dataset);
  expect(restored.dataset?.edges[0] && getAttr(restored.dataset.edges[0].attrs, 'note')).toEqual({
    kind: 'value',
    value: 'z?',
  });
});
it('FR-DM-06: 読めない確からしさは警告（行・列つき）で、値は持たない', () => {
  const draft = draftTable(parseTextTable('From,To,certainty\nA,B,たぶん'), 'single', 'c');
  const result = previewImport('single', draft, null, 'p', 'p', 'directed', [], 'T');
  expect(result.warnings).toContainEqual(
    expect.objectContaining({ code: 'invalid-certainty', row: 2, column: 'certainty' }),
  );
  expect(result.dataset?.edges[0]?.certainty).toBeUndefined();
});
it('FR-DM-06: key を書き換えた列は、保存した設定から再現されない（再現の対象外）', () => {
  const run = (draft: ImportDraft) =>
    previewImport('single', draft, null, 'person', 'person', 'directed', [], 'T');
  const original = run(certaintyDraft(true));
  expect(original.settings.possibleSuffixColumns).toEqual([{ column: 'place' }]);
  // 利用者が属性キーを place から location に書き換えた表。
  const renamed = change(certaintyDraft(false), 'place', { key: 'location' });
  const restored = restorePossibleSuffix(renamed, original.settings.possibleSuffixColumns);
  expect(restored.columns.every((c) => !c.possibleSuffix)).toBe(true);
  expect(run(restored).settings.possibleSuffixColumns).toBeUndefined();
});
