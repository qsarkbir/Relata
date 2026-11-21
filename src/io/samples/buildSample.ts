/** 公開を承認された見本だけを、再生成可能な Relata の形式へ変換する。一般の旧版読込はフェーズ4。 */
import { isPlainObject } from '../../core/model';
import { DEFAULT_FILTER_STATE } from '../../core/filter';
import { importTables } from '../table';
import type { TextTable } from '../table';
import type { ProjectParts } from '../project';
import { MAGHRIB_SAMPLE } from './catalog';

function rowsOf(project: unknown, name: string): Readonly<Record<string, string>>[] {
  if (!isPlainObject(project) || !Array.isArray(project.files))
    throw new TypeError('見本に files がありません。');
  const files: unknown[] = project.files;
  const file = files.find((entry) => isPlainObject(entry) && entry.label === name);
  if (!isPlainObject(file) || !Array.isArray(file.data))
    throw new TypeError(`見本に ${name} がありません。`);
  const rows: unknown[] = file.data;
  return rows.map((row) => {
    if (!isPlainObject(row)) throw new TypeError('見本の行が不正です。');
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string') throw new TypeError(`見本の ${key} が文字列ではありません。`);
      Object.defineProperty(result, key, { value, enumerable: true });
    }
    return result;
  });
}

/**
 * 承認済みの Palladio 見本を、人物の元IDを保って変換する。
 *
 * 【なぜ】関係表はラベル参照なので、元表で一意なラベルだけをIDへ結ぶ。
 * 同名があるときに推測して関係を付け替えない。原文の年・型番号・座標も補正しない。
 * @param source - 承認された maghrib-20231106.json の JSON
 * @returns 全人物・全関係を含むプロジェクト。壊れた値や曖昧な参照は例外
 */
export function buildMaghribSample(source: unknown): ProjectParts {
  const people = rowsOf(source, 'Persons');
  const relations = rowsOf(source, 'Relations');
  const byLabel = new Map<string, string>();
  const required = (row: Readonly<Record<string, string>>, key: string): string => {
    const value = row[key];
    if (value === undefined) throw new TypeError(`見本に ${key} がありません。`);
    return value;
  };
  const nodeTable: TextTable = {
    headers: ['Id', 'Label', 'Type', 'Year', 'Place', 'lat', 'lon'],
    warnings: [],
    rows: people.map((person) => {
      const id = required(person, 'Id');
      const label = required(person, 'Label');
      if (byLabel.has(label)) throw new RangeError('見本の同名ノードの参照が曖昧です。');
      byLabel.set(label, id);
      const coordinate = required(person, 'Coordinate');
      const parts = coordinate === '' ? ['', ''] : coordinate.split(',');
      if (parts.length !== 2) throw new RangeError('見本の座標が不正です。');
      return [
        id,
        label,
        required(person, 'Type'),
        required(person, 'Year'),
        required(person, '地名'),
        parts[0] ?? '',
        parts[1] ?? '',
      ];
    }),
  };
  const edgeTable: TextTable = {
    headers: ['No', 'source', 'target'],
    warnings: [],
    rows: relations.map((relation) => {
      const source = byLabel.get(required(relation, 'From'));
      const target = byLabel.get(required(relation, 'To'));
      if (source === undefined || target === undefined)
        throw new RangeError('見本の関係の参照先がありません。');
      return [required(relation, 'No'), source, target];
    }),
  };
  const result = importTables(
    nodeTable,
    edgeTable,
    {
      fields: { id: 0, label: 1, type: 2, lat: 5, lon: 6 },
      attributes: [
        { column: 3, key: 'Year', label: 'Year (AH)', type: 'date', calendar: 'hijri' },
        { column: 4, key: 'Place', label: 'Place', type: 'category' },
      ],
    },
    { fields: { id: 0, source: 1, target: 2 }, attributes: [] },
    'directed',
    MAGHRIB_SAMPLE.title,
  );
  if (result.dataset === null || result.warnings.length > 0)
    throw new RangeError(`見本の変換に問題があります: ${JSON.stringify(result.warnings)}`);
  return {
    dataset: {
      ...result.dataset,
      nodeTypes: result.dataset.nodeTypes.map((type) => ({ ...type, label: `Type ${type.label}` })),
      meta: { title: MAGHRIB_SAMPLE.title, source: MAGHRIB_SAMPLE.description },
    },
    importSettings: {
      missingTokens: [],
      encoding: 'utf-8',
      columnCalendars: [{ column: 'Year', calendar: 'hijri' }],
    },
    view: { filter: DEFAULT_FILTER_STATE },
  };
}
