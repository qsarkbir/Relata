/**
 * 表ビューの行と列を作る純粋な関数（FR-TB-01、FR-TB-02）。
 *
 * 表の部品（views）に、絞り込み・並べ替え・値の整形を書かないため、ここに集める。
 * 表は「射影の前の元のデータ」を、絞り込み後の集合で見せる（D-39）。
 */
import type { FilterResult } from '../core/filter';
import type {
  Certainty,
  Dataset,
  GraphEdge,
  GraphNode,
  MissingReason,
  TimeValue,
} from '../core/model';
import { attrValues, getAttr, isMissing } from '../core/model';
import type { AttrValue, Attrs } from '../core/model';
import type { SortDirection, TableSort, TableTarget } from '../core/project';
import { matchKey } from '../core/text';
import type { Locale, MessageKey } from '../i18n';

/** 表の 1 つの値。 */
// 【TS】判別共用体。`kind` で、持つ項目が決まる。
export type CellItem =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  /** 日付と期間。`text` は入力どおりの表記（暦の換算は表示の暦の切り替えで別に扱う）。 */
  | { readonly kind: 'date'; readonly text: string; readonly certainty?: Certainty };

/** 表の 1 つのセル。 */
export type TableCell =
  /**
   * 欠損。`reason` が null のときは、理由が分からない（その行にはこの属性が無い、など）。
   * 【なぜ】「史料に書かれていない」と「失われた」は別の事情なので、理由を持つ（FR-DM-04）。
   */
  | { readonly kind: 'missing'; readonly reason: MissingReason | null }
  /** 1 つ以上の値。複数値（FR-DM-07）は items が複数になる。 */
  | {
      readonly kind: 'values';
      readonly items: readonly CellItem[];
      readonly certainty?: Certainty;
    };

/** 表の 1 行になりうるもの。 */
export type TableItem = GraphNode | GraphEdge;

/** 列の見出し。組み込みの列は辞書のキー、データの属性は利用者の付けた名前。 */
export type ColumnHeader =
  | { readonly kind: 'message'; readonly key: MessageKey }
  | { readonly kind: 'attr'; readonly title: string };

/** 並べ替えの鍵。null は欠損（どの向きでも末尾に置く）。 */
type SortKey = string | number | null;

/** 表の列 1 つ。 */
export interface TableColumn {
  /** 列のキー。組み込みは `id` など、属性は `attr:` + 属性のキー。 */
  readonly key: string;
  readonly header: ColumnHeader;
  /** 数の列は右（行末）に寄せる。 */
  readonly numeric: boolean;
  /** 利用者が列を選ばないときに出すか。 */
  readonly defaultVisible: boolean;
  /** 行からセルを作る。 */
  readonly cell: (row: TableItem) => TableCell;
  /** 行から並べ替えの鍵を作る。 */
  readonly sortKey: (row: TableItem) => SortKey;
}

/**
 * 属性の列のキー。組み込みの列と衝突しないよう、接頭辞を付ける。
 *
 * @param attrKey - 属性のキー
 * @returns 列のキー
 */
export function attrColumnKey(attrKey: string): string {
  return `attr:${attrKey}`;
}

const ABSENT: TableCell = { kind: 'missing', reason: null };

function text(value: string): TableCell {
  return { kind: 'values', items: [{ kind: 'text', text: value }] };
}

function certaintyRank(c: Certainty | undefined): number | null {
  return c === 'certain' ? 3 : c === 'probable' ? 2 : c === 'possible' ? 1 : null;
}

function timeCell(time: TimeValue | undefined): TableCell {
  if (time === undefined) return ABSENT;
  if (isMissing(time)) return { kind: 'missing', reason: time.reason };
  const start = time.start;
  const end = time.end;
  const endText = end === undefined ? '' : isMissing(end) ? '' : end.label;
  // 【なぜ】終わりが分からない期間（「1650 年から」）は、終わりの無い書き方にする（D-19）。
  //   1 点の日付は始点だけを出す。
  const label =
    end === undefined
      ? start.label
      : endText === ''
        ? `${start.label} –`
        : `${start.label} – ${endText}`;
  return { kind: 'values', items: [{ kind: 'date', text: label, certainty: start.certainty }] };
}

function timeKey(time: TimeValue | undefined): SortKey {
  if (time === undefined || isMissing(time)) return null;
  return time.start.earliest;
}

function certaintyCell(c: Certainty | undefined): TableCell {
  return c === undefined ? ABSENT : text(c);
}

function attrCell(attrs: Attrs, key: string): TableCell {
  const v = getAttr(attrs, key);
  if (v === undefined) return ABSENT;
  return valueCell(v);
}

function valueCell(v: AttrValue): TableCell {
  switch (v.kind) {
    case 'missing':
      return { kind: 'missing', reason: v.reason };
    case 'date': {
      const dates = attrValues(v);
      return {
        kind: 'values',
        items: dates.map((d): CellItem =>
          typeof d === 'object'
            ? { kind: 'date', text: d.label, certainty: d.certainty }
            : { kind: 'text', text: String(d) },
        ),
      };
    }
    case 'value': {
      const items = attrValues(v).map((x): CellItem => {
        if (typeof x === 'number') return { kind: 'number', value: x };
        if (typeof x === 'boolean') return { kind: 'boolean', value: x };
        if (typeof x === 'string') return { kind: 'text', text: x };
        return { kind: 'date', text: x.label };
      });
      return {
        kind: 'values',
        items,
        ...(v.certainty === undefined ? {} : { certainty: v.certainty }),
      };
    }
    default: {
      const never: never = v;
      return never;
    }
  }
}

function attrKey(attrs: Attrs, key: string): SortKey {
  const v = getAttr(attrs, key);
  if (v === undefined || v.kind === 'missing') return null;
  // 【なぜ】複数値は最初の値で並べる。どの値で並べるかを利用者に選ばせるのは、今は過剰なため。
  const first = attrValues(v)[0];
  if (first === undefined) return null;
  if (typeof first === 'number') return first;
  if (typeof first === 'boolean') return first ? 1 : 0;
  if (typeof first === 'string') return first;
  return first.earliest;
}

/** 行の型 R に絞った列の定義。`as` で行の型を決め打ちせず、型ガードで絞ってから使うための形。 */
interface ColumnDef<R extends TableItem> {
  readonly key: string;
  readonly header: ColumnHeader;
  readonly numeric: boolean;
  readonly defaultVisible: boolean;
  readonly cell: (row: R) => TableCell;
  readonly sortKey: (row: R) => SortKey;
}

// 【TS】型ガード `row is R`。true のとき、row を R として扱える（`as` の決め打ちをしない）。
const isEdgeRow = (row: TableItem): row is GraphEdge => 'source' in row;
const isNodeRow = (row: TableItem): row is GraphNode => !isEdgeRow(row);

// 【なぜ】列は対象の表の行にだけ使うが、型の上では TableItem を受ける。違う種類の行が来たら
//   例外にせず「当てはまらない」セルと並べ替えの欠損にする（壊れた表示より安全）。
function adapt<R extends TableItem>(
  def: ColumnDef<R>,
  guard: (row: TableItem) => row is R,
): TableColumn {
  return {
    ...def,
    cell: (row) => (guard(row) ? def.cell(row) : ABSENT),
    sortKey: (row) => (guard(row) ? def.sortKey(row) : null),
  };
}

const columnCache = new WeakMap<Dataset, Map<TableTarget, readonly TableColumn[]>>();

/**
 * 表の列の一覧を返す。同じデータセットと対象なら、同じ配列を返す（使い回し）。
 *
 * 列は、組み込みの列（ID、ラベルなど）のあとに、データの属性の列が続く。
 * 既定で出す列は、空でない列だけ（時期や確からしさが 1 件も無いデータで、空の列を並べない）。
 *
 * @param dataset - データセット
 * @param target - ノード表かエッジ表か
 * @returns 列の一覧
 */
export function getTableColumns(dataset: Dataset, target: TableTarget): readonly TableColumn[] {
  let byTarget = columnCache.get(dataset);
  if (byTarget === undefined) {
    byTarget = new Map();
    columnCache.set(dataset, byTarget);
  }
  let columns = byTarget.get(target);
  if (columns === undefined) {
    columns = target === 'node' ? buildNodeColumns(dataset) : buildEdgeColumns(dataset);
    byTarget.set(target, columns);
  }
  return columns;
}

function attrColumns(
  dataset: Dataset,
  target: TableTarget,
  attrsOf: (row: TableItem) => Attrs,
  items: readonly TableItem[],
): TableColumn[] {
  const result: TableColumn[] = [];
  for (const def of dataset.schema) {
    if (def.appliesTo !== target) continue;
    const key = def.key;
    result.push({
      key: attrColumnKey(key),
      header: { kind: 'attr', title: def.label },
      numeric: def.valueType === 'number',
      defaultVisible: items.some((row) => getAttr(attrsOf(row), key) !== undefined),
      cell: (row) => attrCell(attrsOf(row), key),
      sortKey: (row) => attrKey(attrsOf(row), key),
    });
  }
  return result;
}

function buildNodeColumns(dataset: Dataset): readonly TableColumn[] {
  const typeLabel = new Map(dataset.nodeTypes.map((t) => [t.id, t.label]));
  const hasTime = dataset.nodes.some((n) => n.time !== undefined);
  const hasCertainty = dataset.nodes.some((n) => n.certainty !== undefined);
  const defs: ColumnDef<GraphNode>[] = [
    {
      key: 'label',
      header: { kind: 'message', key: 'table.col.label' },
      numeric: false,
      defaultVisible: true,
      cell: (r: GraphNode) => text(r.label),
      sortKey: (r: GraphNode) => r.label,
    },
    {
      key: 'id',
      header: { kind: 'message', key: 'table.col.id' },
      numeric: false,
      defaultVisible: true,
      cell: (r: GraphNode) => text(r.id),
      sortKey: (r: GraphNode) => r.id,
    },
    {
      key: 'type',
      header: { kind: 'message', key: 'table.col.type' },
      numeric: false,
      defaultVisible: true,
      cell: (r: GraphNode) => text(typeLabel.get(r.type) ?? r.type),
      sortKey: (r: GraphNode) => typeLabel.get(r.type) ?? r.type,
    },
    {
      key: 'time',
      header: { kind: 'message', key: 'table.col.time' },
      numeric: false,
      defaultVisible: hasTime,
      cell: (r: GraphNode) => timeCell(r.time),
      sortKey: (r: GraphNode) => timeKey(r.time),
    },
    {
      key: 'certainty',
      header: { kind: 'message', key: 'table.col.certainty' },
      numeric: false,
      defaultVisible: hasCertainty,
      cell: (r: GraphNode) => certaintyCell(r.certainty),
      sortKey: (r: GraphNode) => certaintyRank(r.certainty),
    },
  ];
  return [
    ...defs.map((d) => adapt(d, isNodeRow)),
    ...attrColumns(dataset, 'node', (r) => r.attrs, dataset.nodes),
  ];
}

function buildEdgeColumns(dataset: Dataset): readonly TableColumn[] {
  // 【なぜ】端のノードは ID ではなくラベルで出す（利用者が読むのはラベル）。ID の列も選べる。
  //   ノードは ID で引く（ラベルで照合しない。CLAUDE.md）。
  const labelOf = new Map<string, string>(dataset.nodes.map((n) => [n.id, n.label]));
  // 辺の端が Dataset に無いとき（壊れたデータの警告つき読み込み）は ID をそのまま出す。
  const label = (id: string): string => labelOf.get(id) ?? id;
  const hasRelation = dataset.edges.some((e) => e.relation !== undefined);
  const hasTime = dataset.edges.some((e) => e.time !== undefined);
  const hasCertainty = dataset.edges.some((e) => e.certainty !== undefined);
  const defs: ColumnDef<GraphEdge>[] = [
    {
      key: 'sourceLabel',
      header: { kind: 'message', key: 'table.col.source' },
      numeric: false,
      defaultVisible: true,
      cell: (r: GraphEdge) => text(label(r.source)),
      sortKey: (r: GraphEdge) => label(r.source),
    },
    {
      key: 'targetLabel',
      header: { kind: 'message', key: 'table.col.target' },
      numeric: false,
      defaultVisible: true,
      cell: (r: GraphEdge) => text(label(r.target)),
      sortKey: (r: GraphEdge) => label(r.target),
    },
    {
      key: 'relation',
      header: { kind: 'message', key: 'table.col.relation' },
      numeric: false,
      defaultVisible: hasRelation,
      cell: (r: GraphEdge) => {
        const rel = r.relation;
        return rel === undefined ? ABSENT : text(rel);
      },
      sortKey: (r: GraphEdge) => r.relation ?? null,
    },
    {
      key: 'weight',
      header: { kind: 'message', key: 'table.col.weight' },
      numeric: true,
      defaultVisible: true,
      cell: (r: GraphEdge) => ({ kind: 'values', items: [{ kind: 'number', value: r.weight }] }),
      sortKey: (r: GraphEdge) => r.weight,
    },
    {
      key: 'directed',
      header: { kind: 'message', key: 'table.col.directed' },
      numeric: false,
      defaultVisible: dataset.graphMode === 'mixed',
      cell: (r: GraphEdge) => ({ kind: 'values', items: [{ kind: 'boolean', value: r.directed }] }),
      sortKey: (r: GraphEdge) => (r.directed ? 1 : 0),
    },
    {
      key: 'time',
      header: { kind: 'message', key: 'table.col.time' },
      numeric: false,
      defaultVisible: hasTime,
      cell: (r: GraphEdge) => timeCell(r.time),
      sortKey: (r: GraphEdge) => timeKey(r.time),
    },
    {
      key: 'certainty',
      header: { kind: 'message', key: 'table.col.certainty' },
      numeric: false,
      defaultVisible: hasCertainty,
      cell: (r: GraphEdge) => certaintyCell(r.certainty),
      sortKey: (r: GraphEdge) => certaintyRank(r.certainty),
    },
    {
      key: 'id',
      header: { kind: 'message', key: 'table.col.id' },
      numeric: false,
      defaultVisible: true,
      cell: (r: GraphEdge) => text(r.id),
      sortKey: (r: GraphEdge) => r.id,
    },
    {
      key: 'sourceId',
      header: { kind: 'message', key: 'table.col.sourceId' },
      numeric: false,
      defaultVisible: false,
      cell: (r: GraphEdge) => text(r.source),
      sortKey: (r: GraphEdge) => r.source,
    },
    {
      key: 'targetId',
      header: { kind: 'message', key: 'table.col.targetId' },
      numeric: false,
      defaultVisible: false,
      cell: (r: GraphEdge) => text(r.target),
      sortKey: (r: GraphEdge) => r.target,
    },
  ];
  return [
    ...defs.map((d) => adapt(d, isEdgeRow)),
    ...attrColumns(dataset, 'edge', (r) => r.attrs, dataset.edges),
  ];
}

/**
 * 利用者の選択を、実在する列に直す。
 *
 * 保存した列のキーが今のデータに無いとき（別のデータに置き換えた、属性が消えた）は黙って外す。
 * 選択が無い（null）ときは、既定で出す列を返す。
 *
 * @param columns - 列の一覧
 * @param chosen - 利用者が選んだ列のキー（表示する順）。null なら既定
 * @returns 表示する列
 */
export function visibleColumns(
  columns: readonly TableColumn[],
  chosen: readonly string[] | null,
): readonly TableColumn[] {
  if (chosen === null) return columns.filter((c) => c.defaultVisible);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return chosen.flatMap((key) => {
    const c = byKey.get(key);
    return c === undefined ? [] : [c];
  });
}

const collators = new Map<string, Intl.Collator>();

// 【なぜ】numeric で「p2」が「p10」より前に来る。`tie` が true の collator は、照合キーが同じ
//   ときの第 2 の鍵で、元の表記の違い（大文字小文字、アラビア文字の記号の有無）で順を決める。
function collatorFor(locale: Locale, tie: boolean): Intl.Collator {
  const id = `${locale}:${String(tie)}`;
  let c = collators.get(id);
  if (c === undefined) {
    c = new Intl.Collator(locale, tie ? { numeric: true } : { numeric: true, sensitivity: 'base' });
    collators.set(id, c);
  }
  return c;
}

/** 並べ替えの行 1 件。鍵は行ごとに 1 回だけ作る。 */
interface Keyed {
  readonly row: TableItem;
  readonly key: SortKey;
  /** 文字列の鍵の照合キー（`core/text`。表記の揺れを無視する）。数や欠損のときは null。 */
  readonly match: string | null;
}

// 第 1 の鍵は照合キー（ʿ や記号、アラビア文字の表記の揺れを除いた形。元の表記は書き換えない。
// 設計書 §5.2）、第 2 の鍵は元の表記の Collator。数は数として比べる。
function compareKeyed(a: Keyed, b: Keyed, locale: Locale): number {
  const x = a.key;
  const y = b.key;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  const primary = collatorFor(locale, false).compare(a.match ?? String(x), b.match ?? String(y));
  return primary !== 0 ? primary : collatorFor(locale, true).compare(String(x), String(y));
}

/** 絞り込み後の行を、並べ替えて返す。同じ入力なら同じ配列を返す。 */
const rowCache = new WeakMap<FilterResult, Map<string, readonly TableItem[]>>();

/**
 * 絞り込み後の行を、並べ替えて返す。
 *
 * 行は元のデータ（射影の前）から、絞り込みの結果に含まれるものだけを取る（D-39）。
 * 欠損は、並べ替えの向きによらず末尾に置く。同じ値の行は、元のデータの順を保つ。
 * 計算量は O(n log n)。同じ引数なら結果を使い回す（ページを送るたびに並べ直さない）。
 *
 * @param dataset - データセット
 * @param result - 絞り込みの結果
 * @param target - ノード表かエッジ表か
 * @param sort - 並べ替え。null か、実在しない列ならデータの順
 * @param locale - 文字の比較に使う言語
 * @returns 表に出す行
 */
export function getTableRows(
  dataset: Dataset,
  result: FilterResult,
  target: TableTarget,
  sort: TableSort | null,
  locale: Locale,
): readonly TableItem[] {
  const column =
    sort === null ? undefined : getTableColumns(dataset, target).find((c) => c.key === sort.column);
  const direction: SortDirection = sort?.direction ?? 'asc';
  const cacheKey = JSON.stringify([target, column?.key ?? null, direction, locale]);
  let byKey = rowCache.get(result);
  if (byKey === undefined) {
    byKey = new Map();
    rowCache.set(result, byKey);
  }
  const cached = byKey.get(cacheKey);
  // 【なぜ】データセットが違えば、同じ FilterResult は来ない（結果は dataset ごとに作る）。
  if (cached !== undefined) return cached;
  const rows: readonly TableItem[] =
    target === 'node'
      ? dataset.nodes.filter((n) => result.nodeIds.has(n.id))
      : dataset.edges.filter((e) => result.edgeIds.has(e.id));
  let sorted: readonly TableItem[] = rows;
  if (column !== undefined) {
    // 鍵と照合キーは行ごとに 1 回だけ作る（比較のたびに作らない）。
    const keyed: Keyed[] = rows.map((row) => {
      const key = column.sortKey(row);
      return { row, key, match: typeof key === 'string' ? matchKey(key) : null };
    });
    const sign = direction === 'asc' ? 1 : -1;
    // 【TS】Array.prototype.sort は安定（ES2019 から）。同じ鍵の行は元の順を保つ。
    keyed.sort((x, y) => {
      if (x.key === null || y.key === null) {
        if (x.key === y.key) return 0;
        return x.key === null ? 1 : -1; // 欠損は向きによらず末尾
      }
      return sign * compareKeyed(x, y, locale);
    });
    sorted = keyed.map((k) => k.row);
  }
  byKey.set(cacheKey, sorted);
  return sorted;
}

/**
 * 選択に含まれる最初の行の位置を返す（「選択した行へ移る」と、ページの自動移動に使う）。
 *
 * @param rows - 並べ替えた行
 * @param isSelected - その行が選択されているか
 * @returns 最初の選択行の位置。無ければ -1
 */
export function firstSelectedIndex(
  rows: readonly TableItem[],
  isSelected: (row: TableItem) => boolean,
): number {
  return rows.findIndex(isSelected);
}

/** 1 ページの行数。数千行でも描く行を一定に保つ（NFR-04）。 */
export const TABLE_PAGE_SIZE = 50;

/**
 * ページ数を返す。0 行でも 1 ページとする。
 *
 * @param rowCount - 行数
 * @returns ページ数（1 以上）
 */
export function pageCount(rowCount: number): number {
  return Math.max(1, Math.ceil(rowCount / TABLE_PAGE_SIZE));
}
