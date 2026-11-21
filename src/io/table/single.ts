/** Palladio 式 1 表を Dataset にする（FR-IN-04、要件 §6.3）。 */
import type {
  AttrValue,
  AttributeDef,
  Dataset,
  GraphNode,
  GraphMode,
  NodeId,
  NodeTypeId,
} from '../../core/model';
import {
  makeAttrs,
  makeNodeIdFromTypeAndKey,
  makeNodeIdFromTypeAndLabel,
  toNodeTypeId,
} from '../../core/model';
import type { MissingToken } from '../project/types';
import { compileMissingTokens, matchMissingToken } from '../project/missing';
import { convertCell } from './columns';
import {
  importTables,
  type AttributeColumn,
  type ImportWarning,
  type TableMapping,
} from './dataset';
import type { TextTable } from './text';

/** 始点または終点のラベル・型・任意の ID と属性列の指定。 */
export interface SingleTableEndpoint {
  readonly column: number;
  readonly idColumn?: number;
  readonly type: string;
  readonly typeLabel?: string;
  readonly attributes: readonly AttributeColumn[];
}
/** エッジの特殊列。source/target は端点から作るため利用者は指定しない。 */
// 【TS】Pick<T,K> は既存の型から必要なキーだけ、Omit<T,K> は不要なキー以外を取り出す。
export interface SingleTableEdge extends Omit<TableMapping, 'fields'> {
  readonly fields: Pick<
    TableMapping['fields'],
    'id' | 'directed' | 'relation' | 'weight' | 'date' | 'start' | 'end'
  >;
}
/** 1 表の対応。残余列の利用先を明示し、型は各属性列で指定する。 */
export interface SingleTableMapping {
  readonly source: SingleTableEndpoint;
  readonly target: SingleTableEndpoint;
  readonly edge?: SingleTableEdge;
  readonly missingTokens?: readonly MissingToken[];
}
/** 1 表の問題。生成した一時表の行番号ではなく、入力のレコード番号を返す。 */
export interface SingleTableWarning extends Omit<ImportWarning, 'table' | 'code'> {
  readonly table: 'single';
  readonly code: ImportWarning['code'] | 'attribute-conflict' | 'label-conflict' | 'generated-ids';
}
/** 変換結果。問題がある場合も元表は保持し、修正して再試行できる。 */
export interface SingleTableResult {
  readonly dataset: Dataset | null;
  readonly warnings: readonly SingleTableWarning[];
  readonly table: TextTable;
}

interface PendingNode {
  readonly id: NodeId;
  readonly type: NodeTypeId;
  readonly label: string;
  readonly attrs: Map<string, AttrValue>;
}

/**
 * Palladio 式の 1 表からノード・エッジ・属性を作る。
 *
 * 手順: (1) 型と列の対応を検査する。(2) 各行の両端を ID または NFC ラベルでまとめる。
 * (3) 属性を変換し、既存ノードとの競合を警告する。(4) T1-06 の変換でエッジを読み、
 * 一時参照を元の NodeId に戻す。Map の照合は平均 O(1)、全体は O(セル数＋出力属性数)。
 * 【歴史の事情】同名異人を区別するため ID 列を指定できる。照合キーによる綴りの統一はしない。
 * @param table - 解析済みの元表
 * @param mapping - 両端とエッジの列の対応
 * @param graphMode - グラフの向き
 * @param title - 題名
 * @returns Dataset、警告、元表。error があれば dataset は null
 */
export function importSingleTable(
  table: TextTable,
  mapping: SingleTableMapping,
  graphMode: GraphMode = 'directed',
  title = '',
): SingleTableResult {
  const warnings: SingleTableWarning[] = [];
  const pending = new Map<NodeId, PendingNode>();
  const types = new Map<NodeTypeId, string>();
  const schemaByType = new Map<NodeTypeId, Map<string, AttributeDef>>();
  const attributeOwners = new Map<string, NodeTypeId>();
  const globalMissing = mapping.missingTokens ?? [];
  const endpoints = [mapping.source, mapping.target];
  const columnCountRows = new Set(
    table.warnings
      .filter((warning) => warning.code === 'column-count')
      .map((warning) => warning.row),
  );
  const checkColumn = (column: number): void => {
    if (!Number.isInteger(column) || column < 0 || column >= table.headers.length)
      throw new RangeError('列の対応が表の範囲外です。');
  };
  for (const column of Object.values(mapping.edge?.fields ?? {})) checkColumn(column);
  for (const attr of mapping.edge?.attributes ?? []) {
    checkColumn(attr.column);
    convertCell('', { missingTokens: mapping.edge?.missingTokens ?? globalMissing, ...attr });
  }
  if (compileMissingTokens(globalMissing).problems.length > 0)
    throw new RangeError('欠損の記号に空欄または重複があります。');
  for (const endpoint of endpoints) {
    checkColumn(endpoint.column);
    if (endpoint.idColumn !== undefined) checkColumn(endpoint.idColumn);
    const typeText = endpoint.type.trim();
    if (typeText === '') throw new RangeError('ノード型の ID は空にできません。');
    const type = toNodeTypeId(typeText);
    const typeLabel = endpoint.typeLabel ?? typeText;
    if (types.has(type) && types.get(type) !== typeLabel)
      throw new RangeError('同じノード型の表示名が一致しません。');
    types.set(type, typeLabel);
    const definitions = schemaByType.get(type) ?? new Map<string, AttributeDef>();
    const keys = new Set<string>();
    for (const attr of endpoint.attributes) {
      checkColumn(attr.column);
      if (attr.key === '' || keys.has(attr.key))
        throw new RangeError('属性キーが空または重複しています。');
      keys.add(attr.key);
      // 【なぜ】Dataset の属性キーは appliesTo ごとに一意。同じキーを異型の nodeType 定義に分けられない。
      const owner = attributeOwners.get(attr.key);
      if (owner !== undefined && owner !== type)
        throw new RangeError('異なるノード型の属性には異なるキーを指定してください: ' + attr.key);
      attributeOwners.set(attr.key, type);
      // 空表でも欠損記号と区切りの誤りを見逃さない。
      convertCell('', { missingTokens: globalMissing, ...attr });
      const definition: AttributeDef = {
        key: attr.key,
        label: attr.label,
        appliesTo: 'node',
        nodeType: type,
        valueType: attr.type,
        ...(attr.separator === undefined ? {} : { multi: { separator: attr.separator } }),
      };
      const existing = definitions.get(attr.key);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(definition))
        throw new RangeError('同じ型・属性キーの定義が一致しません。');
      definitions.set(attr.key, definition);
    }
    schemaByType.set(type, definitions);
  }
  const addEndpoint = (
    endpoint: SingleTableEndpoint,
    row: readonly string[],
    record: number,
  ): NodeId | undefined => {
    const label = row[endpoint.column] ?? '';
    const warn = (
      code: SingleTableWarning['code'],
      message: string,
      column: number,
      severity: 'warning' | 'error' = 'warning',
    ): void => {
      warnings.push({
        table: 'single',
        row: record,
        column: table.headers[column],
        code,
        severity,
        message,
      });
    };
    const values = endpoint.attributes.map((attr) => {
      const result = convertCell(row[attr.column] ?? '', { missingTokens: globalMissing, ...attr });
      for (const message of result.warnings)
        warn('invalid-value', message, attr.column, result.ok ? 'warning' : 'error');
      return { attr, value: result.value };
    });
    if (matchMissingToken(label, globalMissing) !== undefined) {
      warn('invalid-value', '端点のラベルが欠損です。', endpoint.column, 'error');
      return undefined;
    }
    const type = toNodeTypeId(endpoint.type.trim());
    const rawId = endpoint.idColumn === undefined ? undefined : (row[endpoint.idColumn] ?? '');
    if (rawId !== undefined && matchMissingToken(rawId, globalMissing) !== undefined) {
      warn(
        'invalid-value',
        '指定した ID 列の値が欠損です。',
        endpoint.idColumn ?? endpoint.column,
        'error',
      );
      return undefined;
    }
    const id =
      rawId === undefined
        ? makeNodeIdFromTypeAndLabel(type, label)
        : makeNodeIdFromTypeAndKey(type, rawId.trim());
    let node = pending.get(id);
    if (node === undefined) {
      node = { id, type, label, attrs: new Map() };
      pending.set(id, node);
    } else if (node.label.normalize('NFC') !== label.normalize('NFC'))
      warn(
        'label-conflict',
        '同じ ID に異なるラベルがあります。最初のラベルを保持しました。',
        endpoint.column,
      );
    for (const { attr, value } of values) {
      const existing = node.attrs.get(attr.key);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value))
        warn(
          'attribute-conflict',
          '同じノードの属性値が一致しません。最初の値を保持しました。元表で各行を確認してください。',
          attr.column,
        );
      else if (existing === undefined) node.attrs.set(attr.key, value);
    }
    return id;
  };
  const edgeRows: string[][] = [];
  for (const [index, row] of table.rows.entries()) {
    const source = addEndpoint(mapping.source, row, index + 2);
    const target = addEndpoint(mapping.target, row, index + 2);
    // 【なぜ】不正な列数を一時表の列のずれで隠さない。元表の警告はそのまま戻す。
    const original = Array.from({ length: table.headers.length }, (_, i) => row[i] ?? '');
    edgeRows.push([...original, source ?? '', target ?? '']);
    if (row.length !== table.headers.length && !columnCountRows.has(index + 2))
      warnings.push({
        table: 'single',
        row: index + 2,
        code: 'column-count',
        severity: 'error',
        message: 'ヘッダと列数が異なります。元表を保持しました。',
      });
  }
  if (table.rows.length > 0 && endpoints.some((endpoint) => endpoint.idColumn === undefined))
    warnings.push({
      table: 'single',
      code: 'generated-ids',
      severity: 'warning',
      message:
        'ID 列のない端点は型とラベル（NFC のみ）で照合しました。同名異人には ID 列を指定してください。',
    });
  const nodes: GraphNode[] = [...pending.values()].map((node) => {
    const entries: [string, AttrValue][] = [...(schemaByType.get(node.type)?.keys() ?? [])].map(
      (key) => [key, node.attrs.get(key) ?? { kind: 'missing', reason: 'unrecorded' }],
    );
    return { id: node.id, type: node.type, label: node.label, attrs: makeAttrs(entries) };
  });
  // 一時表には連番のキーを使う。ラベル由来 ID の末尾空白を、2 表 API の ID trim で失わないため。
  const temporaryKeys = new Map<string, string>(
    nodes.map((node, index) => [node.id, String(index)]),
  );
  const temporaryNodes: TextTable = {
    headers: ['id', 'label'],
    rows: nodes.map((node, index) => [String(index), node.label]),
    warnings: [],
  };
  const temporaryEdges: TextTable = {
    headers: [...table.headers, '__source', '__target'],
    rows: edgeRows.map((row) => [
      ...row.slice(0, table.headers.length),
      temporaryKeys.get(row[table.headers.length] ?? '') ?? '',
      temporaryKeys.get(row[table.headers.length + 1] ?? '') ?? '',
    ]),
    warnings: table.warnings,
  };
  const edgeMapping: TableMapping = {
    missingTokens: globalMissing,
    ...(mapping.edge ?? { attributes: [], fields: {} }),
    fields: {
      ...mapping.edge?.fields,
      source: table.headers.length,
      target: table.headers.length + 1,
    },
  };
  const converted = importTables(
    temporaryNodes,
    temporaryEdges,
    { fields: { id: 0, label: 1 }, attributes: [] },
    edgeMapping,
    graphMode,
    title,
  );
  for (const warning of converted.warnings) warnings.push({ ...warning, table: 'single' });
  if (converted.dataset === null || warnings.some((warning) => warning.severity === 'error'))
    return { dataset: null, warnings, table };
  const originalIds = new Map(converted.dataset.nodes.map((node, i) => [node.id, nodes[i]?.id]));
  const edges = converted.dataset.edges.map((edge) => {
    const source = originalIds.get(edge.source);
    const target = originalIds.get(edge.target);
    if (source === undefined || target === undefined)
      throw new Error('内部のノード参照を復元できません。');
    return { ...edge, source, target };
  });
  return {
    dataset: {
      ...converted.dataset,
      nodeTypes: [...types].map(([id, label]) => ({ id, label })),
      nodes,
      edges,
      schema: [...schemaByType.values()]
        .flatMap((definitions) => [...definitions.values()])
        .concat(converted.dataset.schema),
    },
    warnings,
    table,
  };
}
