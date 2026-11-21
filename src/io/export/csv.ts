/** 絞り込み後の CSV 出力（FR-OUT-02、FR-MT-04、R-12）。 */
import type { AttrValue, Dataset, TimeValue } from '../../core/model';
import { getAttr } from '../../core/model';
import type { FilterResult } from '../../core/filter';
import type { MetricsResult } from '../../core/metrics';
import { GLOBAL_METRIC_IDS, NODE_METRIC_IDS } from '../../core/metrics';
import { protectFormula } from '../table/formula';

/** CSVセル。実際の数値は式保護して文字列化せず、数値として出す。 */
export type CsvCell = string | number | boolean;
/** UTF-8 BOM と式保護の選択。どちらも既定は true。 */
export interface CsvOptions {
  readonly bom?: boolean;
  readonly formulaProtection?: boolean;
}
/** 保存名・文字列・Blobを組にしたファイル。 */
export interface CsvFile {
  readonly name: string;
  readonly text: string;
  readonly blob: Blob;
}

/**
 * RFC 4180 の引用規則で、CSV文字列を作る。時間 O(文字数)。
 * @param rows - ヘッダを含む行
 * @param options - BOMと式保護
 * @returns CRLF区切りのCSV
 */
export function encodeCsv(rows: readonly (readonly CsvCell[])[], options: CsvOptions = {}): string {
  const encode = (cell: CsvCell): string => {
    if (typeof cell === 'number' && !Number.isFinite(cell))
      throw new RangeError('有限でない数値はCSVにできません。');
    const value =
      typeof cell === 'string' && options.formulaProtection !== false
        ? protectFormula(cell)
        : String(cell);
    return /[",\r\n]/u.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  };
  return (
    (options.bom === false ? '' : '\ufeff') +
    rows.map((row) => row.map(encode).join(',')).join('\r\n') +
    '\r\n'
  );
}
function file(name: string, rows: readonly (readonly CsvCell[])[], options: CsvOptions): CsvFile {
  const text = encodeCsv(rows, options);
  return { name, text, blob: new Blob([text], { type: 'text/csv;charset=utf-8' }) };
}
function attribute(value: AttrValue | undefined): readonly CsvCell[] {
  if (value === undefined) return ['', '', 'not-applicable', ''];
  if (value.kind === 'missing') return ['', value.reason, 'missing', ''];
  if (value.kind === 'date') return [JSON.stringify(value.value), '', 'date', ''];
  if (
    typeof value.value === 'string' ||
    typeof value.value === 'number' ||
    typeof value.value === 'boolean'
  )
    return [value.value, '', typeof value.value, value.certainty ?? ''];
  return [JSON.stringify(value.value), '', 'multiple', value.certainty ?? ''];
}
function time(value: TimeValue | undefined): readonly CsvCell[] {
  return value === undefined
    ? ['', '', 'not-applicable']
    : value.kind === 'missing'
      ? ['', value.reason, 'missing']
      : [JSON.stringify(value), '', 'span'];
}

/**
 * 全対象のノード・元エッジをCSVへ出す。グラフの集約結果や表の1ページだけにはしない。
 * @param dataset - 元データ
 * @param filtered - 現在のフィルタ結果
 * @param options - BOMと式保護
 * @returns ノード表とエッジ表
 */
export function exportDatasetCsv(
  dataset: Dataset,
  filtered: FilterResult,
  options: CsvOptions = {},
): { readonly nodes: CsvFile; readonly edges: CsvFile } {
  // 【なぜ】警告付きプロジェクトの未宣言属性も黙って落とさない。継承したプロパティは含めない。
  const keysFor = (target: 'node' | 'edge') => {
    const records =
      target === 'node'
        ? dataset.nodes.filter((node) => filtered.nodeIds.has(node.id)).map((node) => node.attrs)
        : dataset.edges.filter((edge) => filtered.edgeIds.has(edge.id)).map((edge) => edge.attrs);
    return [
      ...new Set([
        ...dataset.schema.filter((a) => a.appliesTo === target).map((a) => a.key),
        ...records.flatMap((record) => Object.keys(record)),
      ]),
    ].map((key) => ({ key }));
  };
  const nodeAttrs = keysFor('node');
  const edgeAttrs = keysFor('edge');
  const attrs = (target: 'node' | 'edge') => (target === 'node' ? nodeAttrs : edgeAttrs);
  const headers = (target: 'node' | 'edge') =>
    attrs(target).flatMap((a) => [
      'attr.' + a.key,
      'missing.' + a.key,
      'kind.' + a.key,
      'certainty.' + a.key,
    ]);
  const values = (
    target: 'node' | 'edge',
    record: { readonly attrs: Readonly<Record<string, AttrValue>> },
  ) => attrs(target).flatMap((a) => attribute(getAttr(record.attrs, a.key)));
  const nodes: CsvCell[][] = [
    [
      'id',
      'type',
      'label',
      'lat',
      'lon',
      'geo.missing',
      'time',
      'time.missing',
      'time.kind',
      ...headers('node'),
    ],
  ];
  for (const node of dataset.nodes)
    if (filtered.nodeIds.has(node.id)) {
      nodes.push([
        node.id,
        node.type,
        node.label,
        node.geo?.kind === 'point' ? node.geo.lat : '',
        node.geo?.kind === 'point' ? node.geo.lon : '',
        node.geo?.kind === 'missing' ? node.geo.reason : '',
        ...time(node.time),
        ...values('node', node),
      ]);
    }
  const edges: CsvCell[][] = [
    [
      'id',
      'source',
      'target',
      'directed',
      'relation',
      'weight',
      'time',
      'time.missing',
      'time.kind',
      ...headers('edge'),
    ],
  ];
  for (const edge of dataset.edges)
    if (filtered.edgeIds.has(edge.id))
      edges.push([
        edge.id,
        edge.source,
        edge.target,
        edge.directed,
        edge.relation ?? '',
        edge.weight,
        ...time(edge.time),
        ...values('edge', edge),
      ]);
  return { nodes: file('nodes.csv', nodes, options), edges: file('edges.csv', edges, options) };
}

/** 数値配列を持つ指標列。値の添字は MetricsResult.nodeIds と一致する。 */
interface NumericColumn {
  readonly name: string;
  readonly values: readonly number[];
}
function numericColumns(name: string, value: unknown): NumericColumn[] {
  if (Array.isArray(value) && value.every((item: unknown) => typeof item === 'number')) {
    // 理由: 全要素を直前で数値と確認した、外部入力ではない既知の指標結果。
    return [{ name, values: value }];
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]: [string, unknown]) =>
    numericColumns(name + '.' + key, entry),
  );
}

/**
 * ノード指標と全体指標を別CSVへ出す。失敗や非該当は空値とstatusで区別する。
 * @param dataset - 表示名を持つ元データ
 * @param result - 現在の全計算結果（ページ分割前）
 * @param options - BOMと式保護
 * @returns ノード指標と全体指標のCSV
 */
export function exportMetricsCsv(
  dataset: Dataset,
  result: MetricsResult,
  options: CsvOptions = {},
): { readonly metrics: CsvFile; readonly global: CsvFile } {
  const columns = NODE_METRIC_IDS.flatMap((id) => {
    const outcome = result.node[id];
    return outcome?.ok ? numericColumns(id, outcome.value) : [];
  });
  const labels = new Map(dataset.nodes.map((node) => [String(node.id), node.label]));
  const headers = [
    'id',
    'label',
    ...columns.map((c) => c.name),
    ...NODE_METRIC_IDS.map((id) => id + '.status'),
  ];
  const rows: CsvCell[][] = [headers];
  result.nodeIds.forEach((id, index) => {
    rows.push([
      id,
      labels.get(id) ?? id,
      ...columns.map((column) => {
        const value = column.values[index];
        return value !== undefined && Number.isFinite(value) ? value : '';
      }),
      ...NODE_METRIC_IDS.map((metric) => {
        const outcome = result.node[metric];
        return outcome === undefined ? 'notComputed' : outcome.ok ? 'ok' : outcome.code;
      }),
    ]);
  });
  const global: CsvCell[][] = [['metric', 'value', 'status', 'graphKind', 'notes']];
  for (const id of GLOBAL_METRIC_IDS) {
    const outcome = result.global[id];
    global.push([
      id,
      outcome?.ok && Number.isFinite(outcome.value) ? outcome.value : '',
      outcome === undefined ? 'notComputed' : outcome.ok ? 'ok' : outcome.code,
      result.kind,
      JSON.stringify(result.notes),
    ]);
  }
  return {
    metrics: file('metrics.csv', rows, options),
    global: file('global-metrics.csv', global, options),
  };
}

/**
 * ローカルCSV Blobを保存し、ダウンロード開始後にURLを解放する。
 * @param csv - 保存するCSVファイル
 */
export function downloadCsv(csv: CsvFile): void {
  const url = URL.createObjectURL(csv.blob);
  try {
    const anchor = document.createElement('a');
    try {
      anchor.href = url;
      anchor.download = csv.name;
      document.body.append(anchor);
      anchor.click();
    } finally {
      anchor.remove();
    }
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);
  }
}
