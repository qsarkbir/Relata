/**
 * フィルタの適用（FR-FL-01〜06、FR-FL-09、設計書 §6.2、D-21）。
 *
 * 【なぜ】結果は毎回、データセット全体から計算し直す。差分で更新しない
 * （filter-audit #1、#5: 差分の加減算がずれて、消えるべきエッジが残った旧版の不具合を防ぐ）。
 *
 * 計算量: ノード数 V、エッジ数 E、フィルタ数 F に対して O(F·(V+E))。
 * テキストの照合キーは、1 つのフィルタにつき検索語の分を 1 回だけ作り、
 * 要素ごとには文字列の照合キーを作る（文字列の長さに比例）。
 */
import { assertNever } from '../util/assertNever';
import {
  dateValues,
  getAttr,
  isMissing,
  scalarValues,
  type Attrs,
  type Certainty,
  type Dataset,
  type EdgeId,
  type NodeId,
  type NodeTypeId,
  type TimeValue,
} from '../model';
import { LOOSE_MATCH, STRICT_MATCH, matchKey, type MatchOptions } from '../text';
import { categoryKeyId, categoryKeysOf } from './keys';
import type {
  CertaintyKey,
  FilterDef,
  FilterId,
  FilterState,
  MissingPolicy,
  Target,
} from './types';

/** 表示件数と全体の件数（FR-FL-09 の「絞り込み後 / 全体」の表示に使う）。 */
export interface FilterCounts {
  readonly nodes: { readonly shown: number; readonly total: number };
  readonly edges: { readonly shown: number; readonly total: number };
}

/** フィルタを適用した結果。 */
// 【TS】プロパティの `readonly` は「作った後に代入し直せない」印。`ReadonlySet<T>` と
//       `ReadonlyMap<K, V>` は、add や set などの変更の操作を持たない Set と Map の型。
//       中身は同じ Set/Map だが、型の上で「受け取った側は書き換えない」と約束できる。
export interface FilterResult {
  /** 表示するノードの ID。 */
  readonly nodeIds: ReadonlySet<NodeId>;
  /** 表示するエッジの ID。 */
  readonly edgeIds: ReadonlySet<EdgeId>;
  /**
   * フィルタごとの「欠損のために除いた件数」（FR-FL-06）。
   * 数値の範囲と時間の範囲のフィルタ（欠損を除外する設定のもの）だけが 0 より大きくなる。
   * 他のフィルタが除いたかどうかとは無関係に、対象の全要素で数える（D-21 (7)）。
   * 状態に含まれるすべてのフィルタに項目がある（欠損に関係しないフィルタは 0）。
   */
  readonly missingExcluded: ReadonlyMap<FilterId, number>;
  /** 絞り込み後と全体の件数（FR-FL-09）。 */
  readonly counts: FilterCounts;
}

/**
 * 要素（ノードまたはエッジ）を、フィルタが見る項目だけにそろえたもの。
 * ノードとエッジで同じ判定の関数を使い回すため。
 */
export interface Subject {
  /** ノードならノード ID（エッジは undefined）。`nodeSet` のフィルタが見る。 */
  readonly nodeId: NodeId | undefined;
  /** 確からしさ（無ければ undefined = 指定なし）。 */
  readonly certainty: Certainty | undefined;
  /** ノードならラベル、エッジなら relation（無ければ undefined）。テキスト検索の対象。 */
  readonly primaryText: string | undefined;
  readonly attrs: Attrs;
  readonly time: TimeValue | undefined;
  /** ノードの型（エッジは undefined）。 */
  readonly typeId: NodeTypeId | undefined;
}

// 【TS】文字列リテラルの共用体型（'pass' | 'fail' | …）は、書ける値を列挙に限る。
//       綴りの間違いはコンパイル時にエラーになる。
// 1 つのフィルタが 1 つの要素に下す判定。
// 'missing-excluded' は「欠損の値で、欠損を除外する設定のため通さない」場合（件数を数える）。
type Verdict = 'pass' | 'fail' | 'missing-excluded';

/** コンパイル済みのフィルタ。対象と、要素に判定を下す関数を持つ。 */
export interface Compiled {
  readonly id: FilterId;
  readonly target: Target;
  readonly test: (s: Subject) => Verdict;
}

// 時間フィルタの定義の型（kind が 'time' のもの）。
// 【TS】`Extract<U, T>` は共用体 U から T に当てはまるものだけを取り出す。
type TimeDef = Extract<FilterDef, { kind: 'time' }>;

// 欠損の扱いの設定を判定にする。
//
function missingVerdict(policy: MissingPolicy): Verdict {
  switch (policy) {
    case 'include':
      return 'pass';
    case 'exclude':
      return 'missing-excluded';
    default:
      return assertNever(policy, 'MissingPolicy');
  }
}

// 真偽を判定にする。
//
function verdict(passed: boolean): Verdict {
  return passed ? 'pass' : 'fail';
}

// 照合の強さを、照合キーの設定にする。
//
function matchOptionsOf(matching: 'loose' | 'strict'): MatchOptions {
  return matching === 'loose' ? LOOSE_MATCH : STRICT_MATCH;
}

/**
 * フィルタの定義を、要素に当てはめる関数にする。
 *
 * 【なぜ】包含の Set や検索語の照合キーなど、要素ごとに作り直すと無駄な準備を、
 * フィルタごとに 1 回だけ行うため。
 *
 * @param def - フィルタの定義
 * @returns 対象と判定の関数
 */
function compile(def: FilterDef): Compiled {
  // 【TS】`def.kind` で分岐すると、各 case の中では def がその種類の型に絞り込まれる
  //       （category なら include、range なら min/max が使える）。網羅できていなければ
  //       末尾の assertNever がコンパイルエラーにする。
  switch (def.kind) {
    case 'category': {
      // 【なぜ】カテゴリの比較は String(値) の完全一致（D-21）。照合キーは使わない。
      const wanted = new Set(def.include.map(categoryKeyId));
      return {
        id: def.id,
        target: def.target,
        test: (s) => {
          const a = getAttr(s.attrs, def.attr);
          // 【なぜ】キーを持たない要素（その型に当てはまらない属性）はそのまま通す（D-21 (2)）。
          //   k-partite で、地名の属性で絞ったときに人物が巻き添えで消えないようにする。
          if (a === undefined) return 'pass';
          return verdict(categoryKeysOf(a).some((k) => wanted.has(categoryKeyId(k))));
        },
      };
    }
    case 'range':
      return {
        id: def.id,
        target: def.target,
        test: (s) => {
          const a = getAttr(s.attrs, def.attr);
          if (a === undefined) return 'pass';
          if (isMissing(a)) return missingVerdict(def.missing);
          // 【なぜ】min > max（逆転）の範囲は何も通さない。両端を入れ替えて救うと、利用者の
          //   意図と違う絞り込みになるため。欠損の扱いだけは missing の指定に従う（D-21 (6)）。
          if (def.min !== undefined && def.max !== undefined && def.min > def.max) return 'fail';
          // 数値でない値（文字列、真偽値、日付）は条件に合わない（D-21 (3)）。複数値はどれか 1 つ。
          if (a.kind === 'date') return 'fail';
          return verdict(
            scalarValues(a).some(
              (v) =>
                typeof v === 'number' &&
                Number.isFinite(v) &&
                (def.min === undefined || v >= def.min) &&
                (def.max === undefined || v <= def.max),
            ),
          );
        },
      };
    case 'time':
      return {
        id: def.id,
        target: def.target,
        test: (s) => {
          // 【TS】`def.source.kind` で分岐すれば `def.source` も絞り込まれ、'attr' の case では
          //   `def.source.attr` が使える（入れ子の判別共用体）。
          // 【なぜ】変数に取る。assertNever に絞り込み後の値（never）を渡す形にでき、case ごとに
          //   `def.source` と書く繰り返しも避けられるため。
          const source = def.source;
          switch (source.kind) {
            case 'span':
              return testSpan(def, s.time);
            case 'attr': {
              const a = getAttr(s.attrs, source.attr);
              // 【なぜ】キーを持たない要素（その型に当てはまらない属性）は通す（D-35。category と同じ）。
              if (a === undefined) return 'pass';
              if (isMissing(a)) return missingVerdict(def.missing);
              // 日付でない値（文字列、数値など）は条件に合わない（range が日付を通さないのと対称）。
              if (a.kind !== 'date') return 'fail';
              if (def.from > def.to) return 'fail';
              // 【なぜ】複数値の日付は、どれか 1 つが条件に合えば通す（カテゴリの複数値と同じ。D-35）。
              return verdict(dateValues(a).some((d) => spanMatches(def, d.earliest, d.latest)));
            }
            default:
              return assertNever(source, 'TimeSource');
          }
        },
      };
    case 'text': {
      const options = matchOptionsOf(def.matching);
      const needle = matchKey(def.query, options);
      return {
        id: def.id,
        target: def.target,
        test: (s) => {
          // 空の検索語は全件を通す（D-21 (1)）。
          if (needle === '') return 'pass';
          const hit = (text: string): boolean => matchKey(text, options).includes(needle);
          if (s.primaryText !== undefined && hit(s.primaryText)) return 'pass';
          // 文字列の属性値だけを見る。数値や日付、欠損は検索の対象にしない。
          // 【なぜ】Object.values は自分自身の項目だけを返す（`__proto__` という列名も含む）。
          for (const a of Object.values(s.attrs)) {
            if (a.kind !== 'value') continue;
            for (const v of scalarValues(a)) {
              if (typeof v === 'string' && hit(v)) return 'pass';
            }
          }
          return 'fail';
        },
      };
    }
    case 'nodeType': {
      const types = new Set<string>(def.include);
      return {
        id: def.id,
        target: 'node',
        // 【なぜ】include が空なら、どの型も通さない（カテゴリと同じ。D-21 (2)）。
        test: (s) => verdict(s.typeId !== undefined && types.has(s.typeId)),
      };
    }
    case 'nodeSet': {
      const ids = new Set<string>(def.include);
      return {
        id: def.id,
        target: 'node',
        // 【なぜ】include が空なら何も通さない（nodeType と同じ）。ID で照合し、ラベルは見ない。
        test: (s) => verdict(s.nodeId !== undefined && ids.has(s.nodeId)),
      };
    }
    case 'certainty': {
      const wanted = new Set<CertaintyKey>(def.include);
      return {
        id: def.id,
        target: def.target,
        test: (s) => verdict(wanted.has(certaintyKeyOf(s.certainty))),
      };
    }
    default:
      return assertNever(def, 'FilterDef');
  }
}

/**
 * 確からしさ（無いこともある）を、フィルタの項目にする。
 *
 * @param c - 要素の確からしさ。無ければ undefined
 * @returns 項目（無ければ 'unspecified'）
 */
export function certaintyKeyOf(c: Certainty | undefined): CertaintyKey {
  return c ?? 'unspecified';
}

// 時間フィルタの `span` の出どころ（要素の time）の判定。
//
function testSpan(def: TimeDef, time: TimeValue | undefined): Verdict {
  // 項目が無い（時期の列が無いデータ）要素は通す。Missing は設定に従う（D-21 (4)、D-18）。
  if (time === undefined) return 'pass';
  if (time.kind === 'missing') return missingVerdict(def.missing);
  // 逆転した範囲（from > to）は何も通さない（範囲フィルタと同じ。D-21 (6)）。
  if (def.from > def.to) return 'fail';
  // 期間は [始点の earliest, 終点の latest]。終点が無ければ 1 点の日付なので始点の latest。
  // 終わりが分からない（Missing）なら終わりを無限とみなす。
  const end =
    time.end === undefined
      ? time.start.latest
      : isMissing(time.end)
        ? Number.POSITIVE_INFINITY
        : time.end.latest;
  return verdict(spanMatches(def, time.start.earliest, end));
}

// 【なぜ】幅のある年代（「c.1650」など）は、最も早い日と最も遅い日の幅の端まで取る。
//   「重なる」は幅のどこかが範囲に入ればよく、「収まる」は幅が全部入る必要がある。
//
function spanMatches(def: TimeDef, start: number, end: number): boolean {
  switch (def.match) {
    case 'overlaps':
      return start <= def.to && end >= def.from;
    case 'within':
      return start >= def.from && end <= def.to;
    default:
      return assertNever(def.match, 'TimeMatch');
  }
}

/** 全要素の Subject。`dataset.nodes` / `dataset.edges` と同じ並び。 */
export interface Subjects {
  readonly nodes: readonly Subject[];
  readonly edges: readonly Subject[];
}

// データセットの全要素を Subject にする。
//
function buildSubjects(dataset: Dataset): Subjects {
  return {
    nodes: dataset.nodes.map((n) => ({
      nodeId: n.id,
      certainty: n.certainty,
      primaryText: n.label,
      attrs: n.attrs,
      time: n.time,
      typeId: n.type,
    })),
    edges: dataset.edges.map((e) => ({
      nodeId: undefined,
      certainty: e.certainty,
      primaryText: e.relation,
      attrs: e.attrs,
      time: e.time,
      typeId: undefined,
    })),
  };
}

/** 表示集合（手順 1〜4 の結果）と、その計算に使ったもの。 */
export interface Visible {
  readonly nodeIds: ReadonlySet<NodeId>;
  readonly edgeIds: ReadonlySet<EdgeId>;
  /** 手順 5 で使い回す、コンパイル済みのフィルタ。 */
  readonly compiled: readonly Compiled[];
  readonly subjects: Subjects;
}

/**
 * 手順 1〜4 を行って、表示するノードとエッジを求める（件数の計算は含まない）。
 *
 * 【なぜ】フィルタの出どころは `filters` の 1 つだけにする。状態の一部の設定（規則）だけを
 * 別に受け取るので、「状態のフィルタ」と「渡したフィルタ」が食い違う余地が無い。
 *
 * @param dataset - データセット
 * @param rules - エッジの規則と孤立ノードの設定
 * @param filters - 当てはめるフィルタ
 * @returns 表示集合と、コンパイル済みのフィルタ、要素の Subject
 */
export function computeVisible(
  dataset: Dataset,
  // 【TS】`Pick<T, 'a' | 'b'>` は、型 T から指定した項目だけを取り出した型。
  rules: Pick<FilterState, 'edgeRule' | 'showIsolated'>,
  filters: readonly FilterDef[],
): Visible {
  const subjects = buildSubjects(dataset);
  const compiled = filters.map(compile);
  const nodeTests = compiled.filter((c) => c.target === 'node');
  const edgeTests = compiled.filter((c) => c.target === 'edge');

  // 手順 1: ノード用フィルタをすべて当てはめる → 通過ノード集合 N
  const passedNodes = new Set<NodeId>();
  const existingNodes = new Set<NodeId>();
  dataset.nodes.forEach((n, i) => {
    existingNodes.add(n.id);
    const s = subjects.nodes[i];
    if (s !== undefined && nodeTests.every((c) => c.test(s) === 'pass')) passedNodes.add(n.id);
  });

  // 手順 2〜3: エッジ用フィルタを当てはめ（E'）、さらに edgeRule を満たすものを残す（E）
  const edgeIds = new Set<EdgeId>();
  const endpoints = new Set<NodeId>();
  dataset.edges.forEach((e, i) => {
    const s = subjects.edges[i];
    if (s === undefined || !edgeTests.every((c) => c.test(s) === 'pass')) return;
    const sourceOk = passedNodes.has(e.source);
    const targetOk = passedNodes.has(e.target);
    const ruleOk = rules.edgeRule === 'both-ends' ? sourceOk && targetOk : sourceOk || targetOk;
    if (!ruleOk) return;
    edgeIds.add(e.id);
    // 【なぜ】片端の規則では、フィルタで除かれたノードも端点として表示する（D-21 (5)）。
    //   端点が無いエッジが宙に浮かないようにするため。データに無い ID は足さない。
    if (existingNodes.has(e.source)) endpoints.add(e.source);
    if (existingNodes.has(e.target)) endpoints.add(e.target);
  });

  // 手順 4: showIsolated が false なら、E に一度も現れないノードを除く。
  //   N のうち E に現れるもの ∪ 端点 ＝ 端点（両端の規則では端点 ⊆ N）。
  //   true なら、N のすべてと端点を表示する。
  const nodeIds = rules.showIsolated ? new Set([...passedNodes, ...endpoints]) : endpoints;
  return { nodeIds, edgeIds, compiled, subjects };
}

/**
 * 指定のフィルタを通った要素（手順 1、2 の段階）を、データセットの並びと同じ順の真偽で返す。
 * エッジの規則と孤立ノードの除去（手順 3、4）は行わない。ファセットの件数（FR-FL-07）が使う。
 *
 * 計算量: O(F·(V+E))（対象の要素だけを見るので、実際は O(F·N)）。
 *
 * @param dataset - データセット
 * @param filters - 当てはめるフィルタ
 * @param target - 調べる対象
 * @returns `dataset.nodes` または `dataset.edges` と同じ並びの、通過したかどうか
 */
export function passingFlags(
  dataset: Dataset,
  filters: readonly FilterDef[],
  target: Target,
): boolean[] {
  const tests = filters.map(compile).filter((c) => c.target === target);
  const subjects = buildSubjects(dataset);
  const targets = target === 'node' ? subjects.nodes : subjects.edges;
  return targets.map((s) => tests.every((c) => c.test(s) === 'pass'));
}

/**
 * フィルタを適用する（設計書 §6.2 の手順 1〜5）。
 *
 * 1. ノード用フィルタを全ノードに当てはめ、通過ノード集合 N を作る。
 * 2. エッジ用フィルタを全エッジに当てはめ、候補エッジ集合 E' を作る。
 * 3. E' のうち `edgeRule` を満たすものを、表示エッジ集合 E とする。
 * 4. `showIsolated` が false なら、E に現れないノードを除く。
 * 5. 範囲と時間のフィルタについて、欠損で除いた件数を数える（他のフィルタは 0）。
 *
 * 入力は書き換えない。属性のキーを持たない型のノードは、カテゴリ・範囲のフィルタを通る
 * （k-partite。D-21 (2)）。出どころが `attr` の時間フィルタも、キーを持たない要素を通す（D-35）。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @returns 表示ノードと表示エッジの ID、欠損で除いた件数、全体の件数
 */
export function applyFilters(dataset: Dataset, state: FilterState): FilterResult {
  const { nodeIds, edgeIds, compiled, subjects } = computeVisible(dataset, state, state.filters);

  // 手順 5: 欠損で除いた件数。他のフィルタの結果とは無関係に、対象の全要素で数える（D-21 (7)）。
  // 【なぜ】欠損の扱いを持つのは range と time だけなので、他の種類は評価せず 0 を入れる。
  const missingExcluded = new Map<FilterId, number>();
  state.filters.forEach((def, i) => {
    const c = compiled[i];
    if (c === undefined || (def.kind !== 'range' && def.kind !== 'time')) {
      missingExcluded.set(def.id, 0);
      return;
    }
    const targets = c.target === 'node' ? subjects.nodes : subjects.edges;
    missingExcluded.set(def.id, targets.filter((s) => c.test(s) === 'missing-excluded').length);
  });

  return {
    nodeIds,
    edgeIds,
    missingExcluded,
    counts: {
      nodes: { shown: nodeIds.size, total: dataset.nodes.length },
      edges: { shown: edgeIds.size, total: dataset.edges.length },
    },
  };
}
