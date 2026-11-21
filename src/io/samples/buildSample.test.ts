import { expect, it } from 'vitest';
import sourceText from '../../../tests/fixtures/io/palladio/maghrib-20231106.json?raw';
import approvedText from '../../../tests/fixtures/io/palladio/README.md?raw';
import sampleText from '../../../public/samples/maghrib.relata.json?raw';
import { checkDataset, isPlainObject, parseNodeId } from '../../core/model';
import { parseProject, serializeProject } from '../project';
import { buildMaghribSample } from './buildSample';
import { MAGHRIB_SAMPLE } from './catalog';

it('FR-IN-09 / D-28: 公開の見本は元の全人物・全関係・4型を保持し意味検査を通る', () => {
  const source: unknown = JSON.parse(sourceText);
  const sample = buildMaghribSample(source);
  expect(sample.dataset.nodes).toHaveLength(219);
  expect(sample.dataset.edges).toHaveLength(204);
  expect(sample.dataset.nodeTypes).toHaveLength(4);
  if (!isPlainObject(source) || !Array.isArray(source.files)) throw new Error('fixture');
  const files: unknown[] = source.files;
  const people = files.find((file) => isPlainObject(file) && file.label === 'Persons');
  if (!isPlainObject(people) || !Array.isArray(people.data)) throw new Error('fixture');
  const sourceRows: unknown[] = people.data;
  const ids = new Set<string>();
  for (const node of sample.dataset.nodes) {
    const id = parseNodeId(node.id);
    if (id === undefined) throw new Error('sample ID');
    expect(id.source).toBe('key');
    ids.add(id.text);
    expect(sourceRows.find((row) => isPlainObject(row) && row.Id === id.text)).toMatchObject({
      Label: node.label,
      Type: id.type,
    });
  }
  expect(ids.size).toBe(219);
  expect(sample.dataset.nodes.filter((node) => node.geo?.kind === 'point')).toHaveLength(216);
  expect(sample.dataset.nodes.filter((node) => node.geo?.kind === 'missing')).toHaveLength(3);
  expect(checkDataset(sample.dataset)).toEqual([]);
  const restored = parseProject(sampleText);
  if (!restored.ok) throw new Error(restored.reason);
  expect(restored.warnings).toEqual([]);
  expect(restored.value.dataset).toEqual(sample.dataset);
  expect(restored.value.importSettings).toEqual(sample.importSettings);
  expect(restored.value.view).toEqual(sample.view);
});

it('FR-IN-09 / D-28: 公開ファイルは承認した題名と説明を使い、固定日時で再生成できる', () => {
  const source: unknown = JSON.parse(sourceText);
  const expected: unknown = JSON.parse(
    serializeProject(buildMaghribSample(source), '2026-11-21T00:00:00.000Z'),
  );
  const published: unknown = JSON.parse(sampleText);
  expect(published).toEqual(expected);
  expect(approvedText).toContain(MAGHRIB_SAMPLE.title);
  expect(approvedText.replaceAll('_', '')).toContain(MAGHRIB_SAMPLE.description);
});

function miniSource() {
  return {
    files: [
      {
        label: 'Persons',
        data: [
          { Id: '1', Label: 'محمد', Type: '1', Year: '40', 地名: '', Coordinate: '' },
          { Id: '2', Label: 'أحمد', Type: '2', Year: '', 地名: 'Fes', Coordinate: '34,-5' },
        ],
      },
      { label: 'Relations', data: [{ No: '1', From: 'محمد', To: 'أحمد' }] },
    ],
  };
}

it('FR-IN-09 / D-28: 年40などの原文・空欄・向きを推測で変更しない', () => {
  const result = buildMaghribSample(miniSource());
  const person = result.dataset.nodes[0];
  expect(person?.attrs).toMatchObject({
    Year: { kind: 'date', value: { calendar: 'hijri', label: '40' } },
    Place: { kind: 'missing', reason: 'unrecorded' },
  });
  expect(person?.geo).toEqual({ kind: 'missing', reason: 'unrecorded' });
  expect(result.dataset.edges[0]).toMatchObject({
    source: result.dataset.nodes[0]?.id,
    target: result.dataset.nodes[1]?.id,
    directed: true,
  });
});

it('FR-IN-09 / D-28: 同名や欠けた参照を推測して結ばず、不正な入力を拒否する', () => {
  const same = miniSource();
  const people = same.files[0]?.data;
  if (people === undefined) throw new Error('fixture');
  // テスト用の元表は異なる列を持つ行の共用体なので、型を絞ってから変更する。
  const person = people[1];
  if (person === undefined || !('Label' in person)) throw new Error('fixture');
  person.Label = 'محمد';
  expect(() => buildMaghribSample(same)).toThrow('同名');
  expect(() => buildMaghribSample({ files: [] })).toThrow();
  const missing = miniSource();
  const relation = missing.files[1]?.data[0];
  if (relation === undefined || !('To' in relation)) throw new Error('fixture');
  relation.To = 'does not exist';
  expect(() => buildMaghribSample(missing)).toThrow('参照先');
});
