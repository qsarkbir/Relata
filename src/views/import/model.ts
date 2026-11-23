/** 読み込みウィザードの列対応を、io の公開 API に渡す（FR-IN-03〜07）。 */
import type { CalendarId, Dataset, GraphMode, ValueType } from '../../core/model';
import {
  inferColumnType,
  importSingleTable,
  importTables,
  isPossibleSuffixColumn,
  toColumnRef,
} from '../../io/table';
import type { AttributeColumn, TableMapping, TableWarning, TextTable } from '../../io/table';
import type { ColumnCalendar, ColumnRef, ImportSettings, MissingToken } from '../../io/project';

/** 表の構造。 */
export type ImportMode = 'single' | 'pair';
/** 入力の表の対象。 */
export type TableTarget = 'single' | 'node' | 'edge';
/** 特殊列のキー。表示名は別の翻訳表に置く。 */
export const FIELD_ROLES = [
  'id',
  'label',
  'type',
  'source',
  'target',
  'sourceType',
  'targetType',
  'directed',
  'relation',
  'weight',
  'lat',
  'lon',
  'date',
  'start',
  'end',
  'certainty',
] as const;
type FieldRole = (typeof FIELD_ROLES)[number];
/** 列を使う場所。 */
export type ColumnRole =
  | FieldRole
  | 'ignore'
  | 'attr'
  | 'sourceId'
  | 'targetId'
  | 'sourceAttr'
  | 'targetAttr'
  | 'edgeAttr';
/** 編集中の列。元のセルはこの設定で上書きしない。 */
export interface ColumnDraft {
  readonly role: ColumnRole;
  readonly key: string;
  readonly label: string;
  readonly type: ValueType;
  readonly calendar: CalendarId;
  readonly separator: string;
  /** 属性の値の末尾の ? を「可能性あり」と読む（D-37）。既定は無効。日付の列と属性以外の列では効かない。 */
  readonly possibleSuffix: boolean;
}
/** 編集中の表と読み込み時の情報。 */
export interface ImportDraft {
  readonly table: TextTable;
  readonly columns: readonly ColumnDraft[];
  readonly name: string;
  readonly decodeWarnings?: readonly TableWarning[];
  readonly encoding?: string;
}
/** 画面で表示する統一された警告。 */
export interface WizardWarning {
  readonly table: string;
  readonly row?: number;
  readonly column?: string;
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
}
/** 確認画面の結果。現在のプロジェクトにはまだ反映しない。 */
export interface ImportPreview {
  readonly dataset: Dataset | null;
  readonly warnings: readonly WizardWarning[];
  readonly settings: ImportSettings;
}

/**
 * 特殊列は用途が型を決める。属性列は利用者の指定をそのまま使う。
 * @param role - 列の用途
 * @param inferred - 推定または指定された型
 * @returns 実際に使う型
 */
export function columnType(role: ColumnRole, inferred: ValueType): ValueType {
  if (role === 'date' || role === 'start' || role === 'end') return 'date';
  if (role === 'weight' || role === 'lat' || role === 'lon') return 'number';
  if (role === 'directed') return 'boolean';
  return role === 'attr' ||
    role === 'sourceAttr' ||
    role === 'targetAttr' ||
    role === 'edgeAttr' ||
    role === 'ignore'
    ? inferred
    : 'string';
}
const nodeRoles: readonly ColumnRole[] = [
  'ignore',
  'attr',
  'id',
  'label',
  'type',
  'lat',
  'lon',
  'start',
  'end',
  'certainty',
];
const edgeRoles: readonly ColumnRole[] = [
  'ignore',
  'attr',
  'id',
  'source',
  'target',
  'sourceType',
  'targetType',
  'directed',
  'relation',
  'weight',
  'date',
  'start',
  'end',
  'certainty',
];
const singleRoles: readonly ColumnRole[] = [
  'ignore',
  'source',
  'target',
  'sourceId',
  'targetId',
  'sourceAttr',
  'targetAttr',
  'edgeAttr',
  'id',
  'directed',
  'relation',
  'weight',
  'date',
  'start',
  'end',
  'certainty',
];
/**
 * 対象の表で使える列の用途を返す。
 * @param target - 表の対象
 * @returns 用途の一覧
 */
export function columnRoles(target: TableTarget): readonly ColumnRole[] {
  return target === 'node' ? nodeRoles : target === 'edge' ? edgeRoles : singleRoles;
}
/**
 * 見出しから既定の列用途と、全セルを検査した型の提案を作る。
 * @param table - 元表
 * @param target - 表の対象
 * @param name - ファイル名または貼り付けの題名
 * @param encoding - 実際に復号した文字コード
 * @returns 編集用の表
 */
export function draftTable(
  table: TextTable,
  target: TableTarget,
  name: string,
  encoding?: string,
): ImportDraft {
  const seen = new Set<string>();
  const columns = table.headers.map((header, index): ColumnDraft => {
    let key = header || 'column-' + String(index + 1);
    while (seen.has(key)) key += ' [' + String(index + 1) + ']';
    seen.add(key);
    const normalized = header.trim().toLowerCase();
    const found = columnRoles(target).find((role) => role.toLowerCase() === normalized);
    const role =
      found ??
      (target === 'single'
        ? normalized === 'from'
          ? 'source'
          : normalized === 'to'
            ? 'target'
            : 'edgeAttr'
        : 'attr');
    return {
      role,
      key,
      label: header || key,
      type: columnType(role, inferColumnType(table.rows.map((row) => row[index] ?? ''))),
      calendar: 'gregorian',
      separator: '',
      possibleSuffix: false,
    };
  });
  return { table, columns, name, ...(encoding === undefined ? {} : { encoding }) };
}

const ATTRIBUTE_ROLES: readonly ColumnRole[] = ['attr', 'sourceAttr', 'targetAttr', 'edgeAttr'];
/**
 * 「末尾の ? を可能性ありと読む」を選べる列か。役割が属性で、型が日付でないものだけ（選択の有無は見ない）。
 *
 * 【なぜ】画面（選択欄を出すか）と変換・保存が同じ判定を通る。日付の列は、日付の解析が `?` を
 * 自分で扱うので対象にしない（io の仕様）。
 * @param column - 編集中の列
 * @returns 選べるなら true
 */
export function canUsePossibleSuffix(column: ColumnDraft): boolean {
  return ATTRIBUTE_ROLES.includes(column.role) && column.type !== 'date';
}
/**
 * 「末尾の ? を可能性ありと読む」が実際に効く列か（選べて、選んでいる）。
 * @param column - 編集中の列
 * @returns 効くなら true
 */
export function isSuffixActive(column: ColumnDraft): boolean {
  return column.possibleSuffix && canUsePossibleSuffix(column);
}
/**
 * 保存した読み込みの設定から、列の「末尾の ? を可能性ありと読む」の選択を再現する。
 *
 * 保存した設定からウィザードを再現する画面ができるまでは、保存と変換の往復をテストで確かめるための入口。
 * 列は key で照合する。利用者が key を書き換えた列と、列名が変わったファイルは再現の対象外
 * （その列は無効になる）。
 * @param draft - 編集中の表
 * @param refs - `ImportSettings.possibleSuffixColumns`
 * @param table - 2 表のときの表の区別。1 表なら省略
 * @returns 選択を反映した表
 */
export function restorePossibleSuffix(
  draft: ImportDraft,
  refs: readonly ColumnRef[] | undefined,
  table?: 'node' | 'edge',
): ImportDraft {
  return {
    ...draft,
    columns: draft.columns.map((column) => ({
      ...column,
      possibleSuffix: isPossibleSuffixColumn(refs, column.key, table),
    })),
  };
}

function attributes(
  draft: ImportDraft,
  role: ColumnRole,
  missingTokens: readonly MissingToken[],
): AttributeColumn[] {
  return draft.columns.flatMap((column, index) =>
    column.role !== role
      ? []
      : [
          {
            column: index,
            key: column.key,
            label: column.label,
            type: column.type,
            calendar: column.calendar,
            missingTokens,
            ...(column.separator === '' ? {} : { separator: column.separator }),
            ...(isSuffixActive(column) ? { possibleSuffix: true } : {}),
          },
        ],
  );
}
function tableMapping(draft: ImportDraft, missingTokens: readonly MissingToken[]): TableMapping {
  const fields: Partial<Record<FieldRole, number>> = {};
  const fieldOptions: Partial<Record<'date' | 'start' | 'end' | 'lat' | 'lon', AttributeColumn>> =
    {};
  for (const [index, column] of draft.columns.entries()) {
    const role = FIELD_ROLES.find((field) => field === column.role);
    if (role === undefined) continue;
    if (fields[role] !== undefined) throw new RangeError('duplicate-role: ' + role);
    fields[role] = index;
    if (role === 'date' || role === 'start' || role === 'end' || role === 'lat' || role === 'lon') {
      fieldOptions[role] = {
        column: index,
        key: column.key,
        label: column.label,
        type: column.type,
        calendar: column.calendar,
        missingTokens,
      };
    }
  }
  return {
    fields,
    fieldOptions,
    missingTokens,
    attributes: attributes(draft, 'attr', missingTokens),
  };
}
function roleIndex(draft: ImportDraft, role: ColumnRole, required: boolean): number | undefined {
  const matches = draft.columns.flatMap((column, index) => (column.role === role ? [index] : []));
  if (matches.length > 1) throw new RangeError('duplicate-role: ' + role);
  if (required && matches.length === 0) throw new RangeError('required-role: ' + role);
  return matches[0];
}
/**
 * 元表を変換し、確定前のデータと全警告を返す。
 * @param mode - 1表または2表
 * @param first - 1表またはノード表
 * @param second - エッジ表
 * @param sourceType - 1表の始点型
 * @param targetType - 1表の終点型
 * @param graphMode - グラフの方向
 * @param missingTokens - 欠損の記号
 * @param title - 題名
 * @returns 確認画面用の結果。エラー行は元表に残り、dataset は null
 */
export function previewImport(
  mode: ImportMode,
  first: ImportDraft,
  second: ImportDraft | null,
  sourceType: string,
  targetType: string,
  graphMode: GraphMode,
  missingTokens: readonly MissingToken[],
  title: string,
): ImportPreview {
  // 【なぜ】列名（列の key）で持つ。2 表では、どちらの表の列かを table で区別する（D-24 補足）。
  //   以前は「表の番号:列の番号:key」の文字列にしていて、同梱サンプルの列名の形と食い違っていた。
  const calendars = [first, ...(second === null ? [] : [second])].flatMap((draft, tableIndex) =>
    draft.columns.flatMap((column): ColumnCalendar[] =>
      column.type === 'date'
        ? [
            {
              column: column.key,
              ...(mode === 'pair' && { table: tableIndex === 0 ? 'node' : 'edge' }),
              calendar: column.calendar,
            },
          ]
        : [],
    ),
  );
  const suffixes = [first, ...(second === null ? [] : [second])].flatMap((draft, tableIndex) =>
    draft.columns.flatMap((column): ColumnRef[] =>
      isSuffixActive(column)
        ? [
            toColumnRef(
              column.key,
              mode === 'pair' ? (tableIndex === 0 ? 'node' : 'edge') : undefined,
            ),
          ]
        : [],
    ),
  );
  const settings: ImportSettings = {
    missingTokens,
    columnCalendars: calendars,
    // 【なぜ】選択が無いときは項目を持たない（既定は無効。空の配列を足さず、保存の形を変えない）。
    ...(suffixes.length > 0 && { possibleSuffixColumns: suffixes }),
    ...(first.encoding === undefined ? {} : { encoding: first.encoding }),
  };
  const decodeWarnings: WizardWarning[] = [first, ...(second === null ? [] : [second])].flatMap(
    (draft, index) =>
      (draft.decodeWarnings ?? []).map((warning) => ({
        ...warning,
        table: mode === 'single' ? 'single' : index === 0 ? 'node' : 'edge',
        severity: 'warning',
      })),
  );
  if (mode === 'pair') {
    if (second === null) throw new RangeError('required-table');
    const result = importTables(
      first.table,
      second.table,
      tableMapping(first, missingTokens),
      tableMapping(second, missingTokens),
      graphMode,
      title,
    );
    return { dataset: result.dataset, warnings: [...decodeWarnings, ...result.warnings], settings };
  }
  const sourceColumn = roleIndex(first, 'source', true);
  const targetColumn = roleIndex(first, 'target', true);
  if (sourceColumn === undefined || targetColumn === undefined)
    throw new RangeError('required-role');
  const sourceId = roleIndex(first, 'sourceId', false);
  const targetId = roleIndex(first, 'targetId', false);
  // 【TS】再利用する2表の設定から、1表で端点を作るため不要なキーを除く。
  const mapping = tableMapping(
    {
      ...first,
      columns: first.columns.map((column) => ({
        ...column,
        role: column.role === 'source' || column.role === 'target' ? 'ignore' : column.role,
      })),
    },
    missingTokens,
  );
  const result = importSingleTable(
    first.table,
    {
      source: {
        column: sourceColumn,
        type: sourceType,
        ...(sourceId === undefined ? {} : { idColumn: sourceId }),
        attributes: attributes(first, 'sourceAttr', missingTokens),
      },
      target: {
        column: targetColumn,
        type: targetType,
        ...(targetId === undefined ? {} : { idColumn: targetId }),
        attributes: attributes(first, 'targetAttr', missingTokens),
      },
      edge: {
        fields: mapping.fields,
        fieldOptions: mapping.fieldOptions,
        missingTokens,
        attributes: attributes(first, 'edgeAttr', missingTokens),
      },
      missingTokens,
    },
    graphMode,
    title,
  );
  return { dataset: result.dataset, warnings: [...decodeWarnings, ...result.warnings], settings };
}
