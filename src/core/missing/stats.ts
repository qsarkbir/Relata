/**
 * 欠損の集計（FR-VG-12、R-21、D-42）。
 *
 * 属性ごとに、欠損の件数と割合を理由別に数える。絞り込み後の集合から毎回数え直し
 * （差分で更新しない。共通規約）、全体の値と並べて示せるように、集合は引数で切り替える。
 * 歴史資料では「史料に書かれていない」と「史料が失われた」は別の事情なので、理由を分けて数える。
 */
import type { AttributeDef, Attrs, Dataset, EdgeId, MissingReason, NodeId } from '../model';
import { MISSING_REASONS, getAttr } from '../model';

/** 数える対象の集合。`null` の項目は「全体」。絞り込み後は `FilterResult` の集合をそのまま渡せる。 */
export interface MissingScope {
  readonly nodeIds: ReadonlySet<NodeId> | null;
  readonly edgeIds: ReadonlySet<EdgeId> | null;
}

/** 全体（絞り込まない）の集合。 */
export const WHOLE_SCOPE: MissingScope = { nodeIds: null, edgeIds: null };

/** 理由別の件数。 */
// 【TS】`Readonly<Record<MissingReason, number>>` は、理由の 4 種すべてをキーに持つ辞書。
//       理由を足すと、数え忘れが型エラーになる。
export type ReasonCounts = Readonly<Record<MissingReason, number>>;

/** 1 つの属性の、ある集合での数え上げ。 */
export interface MissingCounts {
  /** その属性が当てはまる要素の数（ノード型を限る属性は、その型のノードだけ）。割合の分母。 */
  readonly total: number;
  /** 値または日付がある要素の数。 */
  readonly present: number;
  /** 欠損の要素の数（理由の合計）。 */
  readonly missing: number;
  /** 理由別の欠損の数。 */
  readonly byReason: ReasonCounts;
  /**
   * その属性のキーを持たない要素の数。欠損とは数えない（キーが無いのは「記録されていない」ではなく
   * 「当てはまらない」ことがあるため。D-19）。`total` には含める。
   */
  readonly absent: number;
}

/** 属性 1 つ分の行。 */
export interface AttrMissingRow {
  readonly key: string;
  readonly label: string;
  readonly target: 'node' | 'edge';
  /** 絞り込み後（引数の集合）の数え上げ。 */
  readonly filtered: MissingCounts;
  /** 全体の数え上げ。 */
  readonly whole: MissingCounts;
}

/**
 * 欠損率。分母が 0 なら null（0 割りを 0% と偽らない）。
 *
 * @param counts - 数え上げ
 * @returns 0 以上 1 以下の割合、または null
 */
export function missingRate(counts: MissingCounts): number | null {
  return counts.total === 0 ? null : counts.missing / counts.total;
}

/**
 * 理由の割合。分母は `total`（その属性が当てはまる要素の数）。
 *
 * @param counts - 数え上げ
 * @param reason - 欠損の理由
 * @returns 割合、または分母が 0 なら null
 */
export function reasonRate(counts: MissingCounts, reason: MissingReason): number | null {
  return counts.total === 0 ? null : counts.byReason[reason] / counts.total;
}

function emptyReasons(): Record<MissingReason, number> {
  return { unrecorded: 0, lost: 0, illegible: 0, 'not-applicable': 0 };
}

/**
 * 1 つの属性定義について、対象の要素を数える。
 *
 * @param def - 属性の定義
 * @param dataset - データセット
 * @param ids - 数える要素の ID。null なら全体
 * @returns 数え上げ
 */
function countOne(
  def: AttributeDef,
  dataset: Dataset,
  ids: ReadonlySet<string> | null,
): MissingCounts {
  const byReason = emptyReasons();
  let total = 0;
  let present = 0;
  let absent = 0;
  const visit = (id: string, attrs: Attrs) => {
    if (ids !== null && !ids.has(id)) return;
    total += 1;
    const v = getAttr(attrs, def.key);
    if (v === undefined) absent += 1;
    else if (v.kind === 'missing') byReason[v.reason] += 1;
    else present += 1;
  };
  if (def.appliesTo === 'node') {
    for (const n of dataset.nodes) {
      if (def.nodeType !== undefined && n.type !== def.nodeType) continue;
      visit(n.id, n.attrs);
    }
  } else {
    for (const e of dataset.edges) visit(e.id, e.attrs);
  }
  let missing = 0;
  for (const r of MISSING_REASONS) missing += byReason[r];
  return { total, present, missing, byReason, absent };
}

/**
 * 属性ごとの欠損を、理由別に数える。
 *
 * 行の順は、データの `schema` の順（ノードの属性、エッジの属性の順ではなく、定義の順のまま）。
 * 計算量は O((N + E) × A)（A は属性の数）。
 *
 * @param dataset - データセット
 * @param scope - 「絞り込み後」の集合。全体は常に併せて数える
 * @returns 属性ごとの行
 */
export function countMissingByAttribute(
  dataset: Dataset,
  scope: MissingScope,
): readonly AttrMissingRow[] {
  return dataset.schema.map((def) => {
    const own = def.appliesTo === 'node' ? scope.nodeIds : scope.edgeIds;
    return {
      key: def.key,
      label: def.label,
      target: def.appliesTo,
      filtered: countOne(def, dataset, own),
      whole: countOne(def, dataset, null),
    };
  });
}

/** 「欠損の表示」で指定した属性が欠損している要素。 */
export interface MissingElements {
  readonly nodes: ReadonlySet<NodeId>;
  readonly edges: ReadonlySet<EdgeId>;
}

/**
 * 指定した属性のどれかが欠損しているノードとエッジを集める（図で破線にする対象）。
 *
 * 【なぜ】キーが無いだけの要素は含めない。欠損は `missing` の値だけ（キーが無いのは「当てはまらない」ことがある）。
 *
 * @param dataset - データセット
 * @param nodeAttrs - ノードで調べる属性のキー
 * @param edgeAttrs - エッジで調べる属性のキー
 * @returns 欠損しているノードの ID とエッジの ID
 */
export function findMissingElements(
  dataset: Dataset,
  nodeAttrs: readonly string[],
  edgeAttrs: readonly string[],
): MissingElements {
  const nodes = new Set<NodeId>();
  const edges = new Set<EdgeId>();
  if (nodeAttrs.length > 0)
    for (const n of dataset.nodes)
      if (nodeAttrs.some((k) => getAttr(n.attrs, k)?.kind === 'missing')) nodes.add(n.id);
  if (edgeAttrs.length > 0)
    for (const e of dataset.edges)
      if (edgeAttrs.some((k) => getAttr(e.attrs, k)?.kind === 'missing')) edges.add(e.id);
  return { nodes, edges };
}
