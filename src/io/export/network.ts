/**
 * GraphML と GEXF に共通の、書き出し用のネットワークの表（FR-OUT-05）。
 *
 * 表示中のグラフ（絞り込み・集計・射影の後の `RelataGraph`）と、元のデータセットから、
 * 「ノードの一覧」「エッジの一覧」「属性の列」を作る。XML への変換は graphml.ts と gexf.ts が行う。
 *
 * 【なぜ】表示中のグラフを出す（元のデータセットの全件ではない）。利用者が画面で見ているものを
 * Gephi などへ渡すためで、射影した二部グラフの一部の型だけの図も、そのまま出せる。
 * 全件の元データは CSV（csv.ts）で出す。
 *
 * 方針（書き出しで情報が減る点）:
 * - 欠損の属性は、値を書かない（列を空にせず、項目そのものを省く）。欠損の理由（記載なし、亡失など）は
 *   書き出せない。GraphML と GEXF には欠損の表現が無く、空文字列にすると「空の文字列という値」と
 *   区別できなくなるため。
 * - 日付は、JDN をグレゴリオ暦（先発。紀元前は天文学的な数え方）の ISO 8601 の文字列にする。
 *   幅のある日付（`FuzzyDate`）は、最も広い範囲を残す: 開始は始点の最も早い日、終了は終点
 *   （終点が無ければ始点）の最も遅い日。確からしさ、元の暦、始点・終点それぞれの幅は
 *   失われる。元の表記は `time_label` 列に残す。ヒジュラ暦の日付も、グレゴリオ暦に換算した日になる。
 * - 同じ 2 点間にまとめたエッジ（`count` > 1）は、重みと件数、関係名（異なるものは `;` で連結）、
 *   期間（最も広い範囲）だけを持つ。個別の属性は、元のエッジが 1 本のときだけ書く。
 */
import type { RelataGraph } from '../../core/graph';
import type {
  AttrValue,
  Dataset,
  FuzzyDate,
  GraphEdge,
  GraphNode,
  TimeValue,
} from '../../core/model';
import { getAttr } from '../../core/model';
import { jdnToGregorian } from '../../core/time';

/** 列の型。GraphML の `attr.type` と GEXF の `type` の、共通の部分集合。 */
export type NetworkColumnType = 'string' | 'double' | 'integer' | 'boolean';
/** 属性の値。 */
export type NetworkValue = string | number | boolean;

/** 属性の列。 */
export interface NetworkColumn {
  /** 書き出しの中での識別子（列の順の番号から作る。利用者の列名は `name` に持つ）。 */
  readonly id: string;
  /** 利用者に見える列名（元の属性のキー、または予約名）。 */
  readonly name: string;
  readonly type: NetworkColumnType;
  readonly target: 'node' | 'edge';
}

/** 書き出すノード。 */
export interface NetworkNode {
  readonly id: string;
  readonly label: string;
  /** 列の識別子 → 値。値の無い列は含めない。 */
  readonly values: ReadonlyMap<string, NetworkValue>;
  /** 期間の開始と終了（ISO 8601）。 */
  readonly start?: string;
  readonly end?: string;
}

/** 書き出すエッジ。 */
export interface NetworkEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly directed: boolean;
  readonly weight: number;
  /** 関係名。 */
  readonly label?: string;
  readonly values: ReadonlyMap<string, NetworkValue>;
  readonly start?: string;
  readonly end?: string;
}

/** 書き出し用のネットワーク全体。 */
export interface NetworkTable {
  readonly title: string;
  /** すべて有向なら `directed`、すべて無向なら `undirected`、混在なら `mixed`。 */
  readonly edgeDefault: 'directed' | 'undirected' | 'mixed';
  readonly nodeColumns: readonly NetworkColumn[];
  readonly edgeColumns: readonly NetworkColumn[];
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  /** 期間を持つノードかエッジがあるか。GEXF の動的グラフ（`mode="dynamic"`）にするかの判断に使う。 */
  readonly hasTime: boolean;
}

/**
 * JDN を ISO 8601 の日付（`YYYY-MM-DD`）にする。
 *
 * 年は天文学的な数え方（0 年が紀元前 1 年）で、ISO 8601 と同じ。負の年は `-0044`、5 桁以上は `+` を付ける。
 *
 * @param jdn - ユリウス通日（整数）
 * @returns ISO 8601 の日付
 * @example
 * jdnToIso(2451545); // '2000-01-01'
 */
export function jdnToIso(jdn: number): string {
  const { year, month, day } = jdnToGregorian(jdn);
  const abs = String(Math.abs(year)).padStart(4, '0');
  const sign = year < 0 ? '-' : abs.length > 4 ? '+' : '';
  return `${sign}${abs}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

// 期間の列から、最も広い範囲と元の表記を求める。期間が 1 つも無ければ undefined。
function unionSpan(times: readonly (TimeValue | undefined)[]): Span | undefined {
  let start = Infinity;
  let end = -Infinity;
  const labels: string[] = [];
  for (const t of times) {
    if (t?.kind !== 'span') continue;
    const e: FuzzyDate | undefined =
      t.end === undefined || !('earliest' in t.end) ? undefined : t.end;
    start = Math.min(start, t.start.earliest);
    end = Math.max(end, (e ?? t.start).latest);
    // 【なぜ】元の表記（「c.1650」「15 Ramaḍān 1050」）は、換算で失われる情報の代わりに残す。
    labels.push(e === undefined ? t.start.label : `${t.start.label} – ${e.label}`);
  }
  return start === Infinity ? undefined : { start, end, label: [...new Set(labels)].join('; ') };
}

// 属性値を書き出す値にする。欠損は undefined（書かない）。
function attrToValue(v: AttrValue | undefined): NetworkValue | undefined {
  if (v === undefined || v.kind === 'missing') return undefined;
  if (v.kind === 'date') {
    const list = 'earliest' in v.value ? [v.value] : v.value;
    // 【なぜ】幅のある日付は ISO 8601 の期間（始点/終点）の形で残す。1 日だけなら日付 1 つ。
    return list
      .map((d) =>
        d.earliest === d.latest
          ? jdnToIso(d.earliest)
          : `${jdnToIso(d.earliest)}/${jdnToIso(d.latest)}`,
      )
      .join(';');
  }
  // 複数値（FR-DM-07）は `;` で連結する。1 値のときは型を保つ。
  return Array.isArray(v.value) ? v.value.map(String).join(';') : (v.value as NetworkValue); // 理由: 配列を除いた残りは Scalar
}

// 値の列から列の型を決める。すべて数なら double、すべて真偽値なら boolean、それ以外は string。
function inferType(values: readonly NetworkValue[]): NetworkColumnType {
  if (values.length > 0 && values.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return 'double';
  if (values.length > 0 && values.every((v) => typeof v === 'boolean')) return 'boolean';
  return 'string';
}

// 列名を、予約名と重ならないようにする。
//
// 利用者の属性のキーが `type` や `weight` のとき、予約の列とぶつかるので、後ろに `_attr` を付ける。
function freeName(name: string, used: Set<string>): string {
  let candidate = name;
  while (used.has(candidate)) candidate += '_attr';
  used.add(candidate);
  return candidate;
}

interface Row {
  readonly values: Map<string, NetworkValue>;
}
const newRow = (): Row => ({ values: new Map() });

/**
 * 属性の列を作り、行に値を入れる。
 *
 * @param prefix - 列の識別子の接頭辞（`n`、`e`）
 * @param target - 対象
 * @param fixed - 予約の列（名前、型、行ごとの値）
 * @param records - 属性を持つ元のレコードと、書き出す行
 * @param schemaKeys - データセットの属性定義の順に並べたキー
 * @returns 列の一覧
 */
function buildColumns(
  prefix: string,
  target: 'node' | 'edge',
  fixed: readonly {
    readonly name: string;
    readonly type: NetworkColumnType;
    readonly rows: readonly (NetworkValue | undefined)[];
  }[],
  records: readonly { readonly attrs: GraphNode['attrs']; readonly row: Row }[],
  schemaKeys: readonly string[],
): NetworkColumn[] {
  const columns: NetworkColumn[] = [];
  const used = new Set<string>();
  const rows = records.map((r) => r.row);
  fixed.forEach((f) => {
    const name = freeName(f.name, used);
    const id = `${prefix}${String(columns.length)}`;
    columns.push({ id, name, type: f.type, target });
    f.rows.forEach((value, i) => {
      if (value !== undefined) rows[i]?.values.set(id, value);
    });
  });
  // 属性: 定義の順、続けて定義に無いキー（警告つきのプロジェクトの未宣言属性。黙って落とさない）。
  const keys = [...new Set([...schemaKeys, ...records.flatMap((r) => Object.keys(r.attrs))])];
  for (const key of keys) {
    const cells = records.map((r) => attrToValue(getAttr(r.attrs, key)));
    const present = cells.filter((c): c is NetworkValue => c !== undefined);
    if (present.length === 0) continue; // 値が 1 つも無い列は書かない。
    const type = inferType(present);
    const id = `${prefix}${String(columns.length)}`;
    columns.push({ id, name: freeName(key, used), type, target });
    cells.forEach((value, i) => {
      if (value !== undefined) rows[i]?.values.set(id, type === 'string' ? String(value) : value);
    });
  }
  return columns;
}

/**
 * 表示中のグラフを、書き出し用の表にする。
 *
 * 計算量: ノード数 V、エッジ数 E、属性の列数 K として O((V + E) K)。
 *
 * @param dataset - 元のデータセット（属性、型の名前、期間を引く）
 * @param graph - 表示中のグラフ（絞り込み・集計・射影の後）
 * @returns 書き出し用の表
 */
export function buildNetworkTable(dataset: Dataset, graph: RelataGraph): NetworkTable {
  const nodeById = new Map<string, GraphNode>(dataset.nodes.map((n) => [n.id, n]));
  const edgeById = new Map<string, GraphEdge>(dataset.edges.map((e) => [e.id, e]));
  const typeLabel = new Map<string, string>(dataset.nodeTypes.map((t) => [t.id, t.label]));

  // --- ノード ---
  const nodeIds = graph.nodes();
  const nodeRecords = nodeIds.map((id) => {
    const node = nodeById.get(id);
    return {
      id,
      node,
      row: newRow(),
      label: graph.getNodeAttribute(id, 'label'),
      type: graph.getNodeAttribute(id, 'type'),
    };
  });
  const nodeSpans = nodeRecords.map((r) => unionSpan([r.node?.time]));
  const nodeColumns = buildColumns(
    'n',
    'node',
    [
      { name: 'type', type: 'string', rows: nodeRecords.map((r) => r.type) },
      { name: 'type_label', type: 'string', rows: nodeRecords.map((r) => typeLabel.get(r.type)) },
      { name: 'certainty', type: 'string', rows: nodeRecords.map((r) => r.node?.certainty) },
      { name: 'time_label', type: 'string', rows: nodeSpans.map((s) => s?.label) },
    ],
    nodeRecords.map((r) => ({ attrs: r.node?.attrs ?? {}, row: r.row })),
    dataset.schema.filter((a) => a.appliesTo === 'node').map((a) => a.key),
  );
  const nodes: NetworkNode[] = nodeRecords.map((r, i) => {
    const span = nodeSpans[i];
    return {
      id: r.id,
      label: r.label,
      values: r.row.values,
      ...(span === undefined ? {} : { start: jdnToIso(span.start), end: jdnToIso(span.end) }),
    };
  });

  // --- エッジ ---
  const edgeKeys = graph.edges();
  const usedIds = new Set<string>();
  const edgeRecords = edgeKeys.map((key, index) => {
    const a = graph.getEdgeAttributes(key);
    const originals = a.edgeIds
      .map((id) => edgeById.get(id))
      .filter((e): e is GraphEdge => e !== undefined);
    const only = a.count === 1 ? originals[0] : undefined;
    // 【なぜ】元のエッジが 1 本なら元の ID を使う（元のデータに戻れる）。まとめたものは連番。重なったら末尾を足す。
    let id = a.count === 1 && a.edgeIds[0] !== undefined ? a.edgeIds[0] : `m${String(index)}`;
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);
    const relations = [
      ...new Set(originals.map((e) => e.relation).filter((r): r is string => r !== undefined)),
    ];
    return {
      id,
      row: newRow(),
      source: graph.source(key),
      target: graph.target(key),
      attrs: a,
      only,
      relation: relations.length === 0 ? undefined : relations.join(';'),
      span: unionSpan(originals.map((e) => e.time)),
      certainty: only?.certainty,
    };
  });
  const edgeColumns = buildColumns(
    'e',
    'edge',
    [
      { name: 'weight', type: 'double', rows: edgeRecords.map((r) => r.attrs.weight) },
      { name: 'count', type: 'integer', rows: edgeRecords.map((r) => r.attrs.count) },
      { name: 'relation', type: 'string', rows: edgeRecords.map((r) => r.relation) },
      { name: 'certainty', type: 'string', rows: edgeRecords.map((r) => r.certainty) },
      { name: 'time_label', type: 'string', rows: edgeRecords.map((r) => r.span?.label) },
      // 射影したエッジの根拠の仲介ノード（FR-GR-04）。
      { name: 'via', type: 'string', rows: edgeRecords.map((r) => r.attrs.via?.join(';')) },
      { name: 'edge_ids', type: 'string', rows: edgeRecords.map((r) => r.attrs.edgeIds.join(';')) },
    ],
    edgeRecords.map((r) => ({ attrs: r.only?.attrs ?? {}, row: r.row })),
    dataset.schema.filter((a) => a.appliesTo === 'edge').map((a) => a.key),
  );
  const edges: NetworkEdge[] = edgeRecords.map((r) => ({
    id: r.id,
    source: r.source,
    target: r.target,
    directed: r.attrs.directed,
    weight: r.attrs.weight,
    ...(r.relation === undefined ? {} : { label: r.relation }),
    values: r.row.values,
    ...(r.span === undefined ? {} : { start: jdnToIso(r.span.start), end: jdnToIso(r.span.end) }),
  }));

  const directedCount = edges.filter((e) => e.directed).length;
  return {
    title: dataset.meta.title,
    // 【なぜ】エッジが無いときは、グラフの型（データセットの graphMode）に従う。
    edgeDefault:
      edges.length === 0
        ? graph.type
        : directedCount === 0
          ? 'undirected'
          : directedCount === edges.length
            ? 'directed'
            : 'mixed',
    nodeColumns,
    edgeColumns,
    nodes,
    edges,
    hasTime: nodes.some((n) => n.start !== undefined) || edges.some((e) => e.start !== undefined),
  };
}
