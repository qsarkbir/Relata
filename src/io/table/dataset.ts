/** 2 表から Dataset への変換（FR-IN-03、05〜07）。 */
import type {
  AttrValue,
  AttributeDef,
  Dataset,
  GraphEdge,
  GraphMode,
  GraphNode,
  NodeId,
  TimeValue,
  GeoValue,
  FuzzyDate,
  Certainty,
  Missing,
} from '../../core/model';
import {
  makeAttrs,
  parseCertainty,
  makeNodeIdFromTypeAndKey,
  makeNodeIdFromTypeAndLabel,
  toEdgeId,
  toNodeTypeId,
} from '../../core/model';
import { parseDate } from '../../core/time';
import { compileMissingTokens, matchMissingToken } from '../project/missing';
import type { ColumnOptions } from './columns';
import type { MissingToken } from '../project/types';
import { convertCell, createCellConverter } from './columns';
import type { TableWarning, TextTable } from './text';

/** 属性への対応。列番号は 0 起点なので、同名の列も指定できる。 */
export interface AttributeColumn extends ColumnOptions {
  readonly column: number;
  readonly key: string;
  readonly label: string;
}
/**
 * 特殊列への対応。省略した列は存在しないものとして扱う。
 *
 * `certainty`（D-37、FR-DM-06）は「確からしさ」の列。ノード表ではノードの、エッジ表ではエッジの
 * `certainty` になる。受け付ける表記は `parseCertainty` に従う。
 */
export interface TableMapping {
  readonly fields: Readonly<
    Partial<
      Record<
        | 'id'
        | 'label'
        | 'type'
        | 'source'
        | 'target'
        | 'sourceType'
        | 'targetType'
        | 'directed'
        | 'relation'
        | 'weight'
        | 'lat'
        | 'lon'
        | 'date'
        | 'start'
        | 'end'
        | 'certainty',
        number
      >
    >
  >;
  readonly attributes: readonly AttributeColumn[];
  readonly timeOptions?: ColumnOptions;
  /** 特殊列も含む表全体の欠損記号。列の指定があればそちらを優先する。 */
  readonly missingTokens?: readonly MissingToken[];
  /** start/end を異なる暦で読めるよう、特殊列ごとの設定を持つ。 */
  readonly fieldOptions?: Readonly<
    Partial<Record<'date' | 'start' | 'end' | 'lat' | 'lon', ColumnOptions>>
  >;
}
/** 読み込みの問題。error がある間はデータを公開しない。 */
export interface ImportWarning {
  readonly table: 'node' | 'edge';
  readonly row?: number;
  readonly column?: string;
  readonly code:
    | TableWarning['code']
    | 'invalid-value'
    | 'duplicate-id'
    | 'merged-label'
    | 'unknown-node'
    | 'ambiguous-node'
    | 'invalid-date'
    | 'invalid-certainty'
    | 'invalid-coordinate'
    | 'date-warning';
  readonly severity: 'warning' | 'error';
  readonly message: string;
}
/** 2 表の変換結果。元の表を保持し、失敗した行も修正して再実行できる。 */
export interface TableImportResult {
  readonly dataset: Dataset | null;
  readonly warnings: readonly ImportWarning[];
  readonly tables: { readonly node: TextTable; readonly edge: TextTable };
}

/**
 * ノード表とエッジ表を、列の対応づけに従って変換する。
 *
 * ID は型ごとの名前空間に入れる。型なしのエッジ参照が複数型に当たる場合は拒否する。
 * 不正な行を黙って省かず、1 件でも error があれば dataset=null と元表を返す。
 * 時間計算量は O(セル数 + ノード数 + エッジ数)。
 * @param nodeTable - ノードの表
 * @param edgeTable - エッジの表
 * @param nodeMapping - ノード列の対応
 * @param edgeMapping - エッジ列の対応
 * @param graphMode - グラフの向き
 * @param title - 題名
 * @returns データ、警告、修正用の元表
 */
export function importTables(
  nodeTable: TextTable,
  edgeTable: TextTable,
  nodeMapping: TableMapping,
  edgeMapping: TableMapping,
  graphMode: GraphMode = 'directed',
  title = '',
): TableImportResult {
  const warnings: ImportWarning[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const types = new Map<string, ReturnType<typeof toNodeTypeId>>();
  const nodeIds = new Set<NodeId>();
  const edgeIds = new Set<string>();
  const references = new Map<string, NodeId[]>();
  const typedReferences = new Map<string, NodeId>();
  const schema: AttributeDef[] = [];
  const tables = { node: nodeTable, edge: edgeTable };

  for (const [table, mapping] of [
    [nodeTable, nodeMapping],
    [edgeTable, edgeMapping],
  ] as const) {
    for (const index of [
      ...Object.values(mapping.fields),
      ...mapping.attributes.map((a) => a.column),
    ]) {
      if (!Number.isInteger(index) || index < 0 || index >= table.headers.length)
        throw new RangeError('列の対応が表の範囲外です。');
    }
    const keys = new Set<string>();
    for (const attr of mapping.attributes) {
      if (attr.key === '' || keys.has(attr.key))
        throw new RangeError('属性キーが空または重複しています。');
      keys.add(attr.key);
    }
    if (mapping.fields.end !== undefined && mapping.fields.start === undefined)
      throw new RangeError('end を指定するときは start も指定してください。');
    if (
      mapping.fields.date !== undefined &&
      (mapping.fields.start !== undefined || mapping.fields.end !== undefined)
    )
      throw new RangeError('date と start/end は同時に指定できません。');
    if ((mapping.fields.lat === undefined) !== (mapping.fields.lon === undefined))
      throw new RangeError('緯度と経度は組で指定してください。');
  }
  if (
    nodeMapping.fields.label === undefined ||
    edgeMapping.fields.source === undefined ||
    edgeMapping.fields.target === undefined
  )
    throw new RangeError('label、source、target の列を指定してください。');

  for (const target of ['node', 'edge'] as const) {
    const table = tables[target];
    // 警告のある行を先に集め、行ごとに全警告を走査する二乗時間を避ける。
    const columnCountRows = new Set(
      table.warnings.filter((w) => w.code === 'column-count').map((w) => w.row),
    );
    const mapping = target === 'node' ? nodeMapping : edgeMapping;
    for (const attr of mapping.attributes)
      schema.push({
        key: attr.key,
        label: attr.label,
        appliesTo: target,
        valueType: attr.type,
        ...(attr.separator === undefined ? {} : { multi: { separator: attr.separator } }),
      });
    for (const warning of table.warnings)
      warnings.push({ table: target, ...warning, severity: 'error' });
    // 【なぜ】欠損記号は列ごとに準備し、行数に比例した再コンパイルを避ける。
    const attributeConverters = mapping.attributes.map((attr) =>
      createCellConverter({ missingTokens: mapping.missingTokens ?? [], ...attr }),
    );
    // 【なぜ】ラベル・ID・端点の列が欠損記号（「〔欠〕」など）なら、実在の名前として扱わない。
    // 扱うと、不明の人物がすべて「〔欠〕」という 1 つのノードに合流してしまう（1 表の読み込みと同じ扱い）。
    // 空欄はここでは数えない（空欄は、空のラベルや参照先の無いエッジとして、それぞれ別に報告する）。
    let certaintyTokenWarned = false;
    const compiledMissing = compileMissingTokens(mapping.missingTokens ?? []);
    const isMissingToken = (text: string): boolean =>
      text.trim() !== '' && matchMissingToken(text, compiledMissing) !== undefined;
    for (const [index, row] of table.rows.entries()) {
      const rowNumber = index + 2;
      const warn = (
        code: ImportWarning['code'],
        message: string,
        severity: 'error' | 'warning' = 'error',
        column?: string,
      ) => {
        warnings.push({
          table: target,
          row: rowNumber,
          code,
          message,
          severity,
          ...(column === undefined ? {} : { column }),
        });
      };
      const cell = (field: keyof TableMapping['fields']): string => {
        const column = mapping.fields[field];
        return column === undefined ? '' : (row[column] ?? '');
      };
      if (row.length !== table.headers.length && !columnCountRows.has(rowNumber))
        warn('column-count', 'ヘッダと列数が異なります。');
      const entries: [string, AttrValue][] = [];
      for (const [attributeIndex, attr] of mapping.attributes.entries()) {
        const convert = attributeConverters[attributeIndex];
        if (convert === undefined) throw new RangeError('属性の変換設定がありません。');
        const result = convert(row[attr.column] ?? '');
        entries.push([attr.key, result.value]);
        for (const message of result.warnings)
          warn(
            'invalid-value',
            message,
            result.ok ? 'warning' : 'error',
            table.headers[attr.column],
          );
      }
      const attrs = makeAttrs(entries);
      const optionsFor = (field: 'date' | 'start' | 'end' | 'lat' | 'lon'): ColumnOptions => ({
        type: field === 'lat' || field === 'lon' ? 'number' : 'date',
        missingTokens: mapping.missingTokens ?? [],
        ...(field === 'lat' || field === 'lon' ? {} : mapping.timeOptions),
        ...mapping.fieldOptions?.[field],
      });
      let time: TimeValue | undefined;
      if (mapping.fields.date !== undefined || mapping.fields.start !== undefined) {
        const readDate = (field: 'date' | 'start' | 'end'): FuzzyDate | Missing | undefined => {
          const options = optionsFor(field);
          const reason = matchMissingToken(cell(field), options.missingTokens ?? []);
          if (reason !== undefined) return { kind: 'missing', reason };
          const parsed = parseDate(
            cell(field),
            options.calendar === undefined ? {} : { calendar: options.calendar },
          );
          if (!parsed.ok) {
            warn(
              'invalid-date',
              parsed.reason.message,
              'error',
              mapping.fields[field] === undefined
                ? undefined
                : table.headers[mapping.fields[field]],
            );
            return undefined;
          }
          for (const warning of parsed.warnings) warn('date-warning', warning.message, 'warning');
          return parsed.value;
        };
        const start = readDate(mapping.fields.date !== undefined ? 'date' : 'start');
        const end =
          mapping.fields.date === undefined && mapping.fields.end !== undefined
            ? readDate('end')
            : undefined;
        if (start !== undefined && 'kind' in start) {
          time = start;
          if (end !== undefined && !('kind' in end))
            warn('invalid-date', '始点が欠損で終点だけの期間は扱えません。');
        } else if (start !== undefined) {
          time = { kind: 'span', start, ...(end === undefined ? {} : { end }) };
          if (end !== undefined && !('kind' in end) && end.latest < start.earliest)
            warn('date-warning', '期間の終点が始点より前です。', 'warning');
        }
      }
      const timePart = time === undefined ? {} : { time };
      // 確からしさの列（D-37）。空欄と欠損の記号は「指定なし」として持たない。読めない値は警告にして捨てない
      // （行番号と列名つきで利用者に見せる）。原文を持つ場所が無いので、値は持たず警告だけが残る。
      let certainty: Certainty | undefined;
      if (mapping.fields.certainty !== undefined) {
        const text = cell('certainty');
        const parsed = parseCertainty(text);
        if (isMissingToken(text)) {
          // 【なぜ】「?」などを欠損の記号にも登録していると、どちらの意味か決まらない。欠損を優先し、
          // 確からしさとしては読まない。行ごとに出すと数万行で警告があふれるので、表ごとに 1 回だけ知らせる。
          if (parsed.kind === 'ok' && !certaintyTokenWarned) {
            certaintyTokenWarned = true;
            warn(
              'invalid-certainty',
              `「${text.trim()}」は欠損の記号として登録されているので、確からしさとしては読みません。以降の同じ値の行にも警告は出しません。`,
              'warning',
              table.headers[mapping.fields.certainty],
            );
          }
        } else if (parsed.kind === 'ok') certainty = parsed.value;
        else if (parsed.kind === 'invalid')
          warn(
            'invalid-certainty',
            `確からしさ「${parsed.text}」を読めません。確実／おそらく／可能性あり、certain／probable／possible、?（？、؟）のどれかにしてください。この値は持ちません。`,
            'warning',
            table.headers[mapping.fields.certainty],
          );
      }
      const certaintyPart = certainty === undefined ? {} : { certainty };
      if (target === 'node') {
        let geo: GeoValue | undefined;
        if (mapping.fields.lat !== undefined || mapping.fields.lon !== undefined) {
          const latText = cell('lat');
          const lonText = cell('lon');
          const latOptions = optionsFor('lat');
          const lonOptions = optionsFor('lon');
          const latMissing = matchMissingToken(latText, latOptions.missingTokens ?? []);
          const lonMissing = matchMissingToken(lonText, lonOptions.missingTokens ?? []);
          if (latMissing !== undefined && lonMissing !== undefined && latMissing === lonMissing)
            geo = { kind: 'missing', reason: latMissing };
          else {
            const latResult = convertCell(latText, { ...latOptions, type: 'number' });
            const lonResult = convertCell(lonText, { ...lonOptions, type: 'number' });
            const lat =
              latResult.value.kind === 'value' && typeof latResult.value.value === 'number'
                ? latResult.value.value
                : NaN;
            const lon =
              lonResult.value.kind === 'value' && typeof lonResult.value.value === 'number'
                ? lonResult.value.value
                : NaN;
            if (
              latText.trim() === '' ||
              lonText.trim() === '' ||
              !Number.isFinite(lat) ||
              !Number.isFinite(lon) ||
              Math.abs(lat) > 90 ||
              Math.abs(lon) > 180
            )
              warn('invalid-coordinate', '緯度または経度が不正です。');
            else geo = { kind: 'point', lat, lon };
          }
        }
        const label = cell('label');
        const missingLabel = isMissingToken(label);
        const emptyLabel = label.trim() === '' || missingLabel;
        if (missingLabel) warn('invalid-value', 'ノードのラベルが欠損です。', 'error', 'label');
        else if (emptyLabel) warn('invalid-value', 'ノードのラベルが空です。');
        const typeText = cell('type').trim() || 'default';
        const type = toNodeTypeId(typeText);
        types.set(typeText, type);
        const key = cell('id').trim();
        const generated = mapping.fields.id === undefined;
        const missingId = !generated && isMissingToken(key);
        const emptyId = !generated && (key === '' || missingId);
        if (missingId) warn('invalid-value', '指定した ID 列の値が欠損です。', 'error', 'id');
        else if (emptyId) warn('invalid-value', 'ID 列の値が空です。');
        if (emptyLabel || emptyId) continue;
        const id = generated
          ? makeNodeIdFromTypeAndLabel(type, label)
          : makeNodeIdFromTypeAndKey(type, key);
        if (nodeIds.has(id)) {
          warn(
            generated ? 'merged-label' : 'duplicate-id',
            generated
              ? '同じ型とラベルのノードを合流しました。同名異人には ID 列を指定してください。先の行を保持します。'
              : 'ID が重複しています。',
            generated ? 'warning' : 'error',
          );
          continue;
        }
        nodeIds.add(id);
        const reference = generated ? label.normalize('NFC') : key;
        const matches = references.get(reference) ?? [];
        matches.push(id);
        references.set(reference, matches);
        typedReferences.set(JSON.stringify([typeText, reference]), id);
        nodes.push({
          id,
          type,
          label,
          attrs,
          ...timePart,
          ...certaintyPart,
          ...(geo === undefined ? {} : { geo }),
        });
      } else {
        const resolve = (field: 'source' | 'target'): NodeId | undefined => {
          if (isMissingToken(cell(field))) {
            warn('invalid-value', `${field} の値が欠損です。`, 'error', field);
            return undefined;
          }
          const key =
            nodeMapping.fields.id === undefined ? cell(field).normalize('NFC') : cell(field).trim();
          const typeColumn = field === 'source' ? 'sourceType' : 'targetType';
          const type = cell(typeColumn).trim() || 'default';
          const typed = typedReferences.get(JSON.stringify([type, key]));
          const matches =
            mapping.fields[typeColumn] === undefined
              ? (references.get(key) ?? [])
              : typed === undefined
                ? []
                : [typed];
          if (matches.length !== 1) {
            warn(
              matches.length === 0 ? 'unknown-node' : 'ambiguous-node',
              `${field} の参照先が存在しないか、複数の型に一致します。`,
              'error',
              field,
            );
            return undefined;
          }
          return matches[0];
        };
        const source = resolve('source');
        const destination = resolve('target');
        const idText =
          mapping.fields.id === undefined ? `row-${String(rowNumber)}` : cell('id').trim();
        if (idText === '' || edgeIds.has(idText)) {
          warn('duplicate-id', 'エッジ ID が空または重複しています。');
          continue;
        }
        edgeIds.add(idText);
        let directed = graphMode !== 'undirected';
        if (graphMode === 'mixed' && mapping.fields.directed !== undefined) {
          const parsed = convertCell(cell('directed'), { type: 'boolean' });
          if (
            !parsed.ok ||
            parsed.value.kind !== 'value' ||
            typeof parsed.value.value !== 'boolean'
          )
            warn('invalid-value', 'directed は true/false にしてください。');
          else directed = parsed.value.value;
        }
        let weight = 1;
        if (mapping.fields.weight !== undefined && cell('weight').trim() !== '') {
          const parsed = convertCell(cell('weight'), {
            type: 'number',
            missingTokens: mapping.missingTokens ?? [],
          });
          if (
            !parsed.ok ||
            parsed.value.kind !== 'value' ||
            typeof parsed.value.value !== 'number' ||
            parsed.value.value < 0
          )
            warn('invalid-value', '重みは有限の 0 以上の数値にしてください。');
          else weight = parsed.value.value;
        }
        if (source !== undefined && destination !== undefined)
          edges.push({
            id: toEdgeId(idText),
            source,
            target: destination,
            directed,
            weight,
            attrs,
            ...timePart,
            ...certaintyPart,
            ...(cell('relation') === '' ? {} : { relation: cell('relation') }),
          });
      }
    }
  }
  return {
    dataset: warnings.some((w) => w.severity === 'error')
      ? null
      : {
          graphMode,
          nodes,
          edges,
          nodeTypes: [...types].map(([label, id]) => ({ id, label })),
          schema,
          meta: { title },
        },
    warnings,
    tables,
  };
}
