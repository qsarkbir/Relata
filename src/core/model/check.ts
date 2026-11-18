/**
 * Dataset の不変条件の検査（設計書 §5、§12）。
 *
 * 例外は投げず、問題の一覧を返す。呼び出し側（読み込み処理、画面）が、
 * 一覧を見て「警告として続行する」「読み込みを止める」を決める。
 * ここでは問題に致命的かどうかの区別を付けない（どれを止めるかは呼び出し側の方針による）。
 * ただし、1 件でも返したら、その Dataset は JSON の保存と復元の保証（parseDataset を通ること）の対象外である。
 */
import { assertNever } from '../util/assertNever';
import { getAttr } from './attrs';
import type { Attrs } from './attrs';
import type { AttributeDef, Dataset } from './graph';
import type { EdgeId, NodeId, NodeTypeId } from './ids';
import type { DayNumber, TimeValue } from './time';
import type { GeoValue } from './geo';
import { dateValues, isMissing, scalarValues, type AttrValue, type FuzzyDate } from './values';

/**
 * 問題の持ち主。ノード、エッジ、ノード型、schema の定義（キーで指す）のどれか。
 */
// 【TS】判別共用体。`entity` の値で、`id` の型（NodeId、EdgeId、…）が決まる。
export type IssueOwner =
  | { entity: 'node'; id: NodeId }
  | { entity: 'edge'; id: EdgeId }
  | { entity: 'nodeType'; id: NodeTypeId }
  | { entity: 'schema'; id: string };

/**
 * 不変条件の違反 1 件。`code` で種類を区別し、持ち主 `owner` と、関係する値を持つ。
 *
 * 自己ループ（source と target が同じ）と多重エッジ（同じ組に複数のエッジ）は
 * 歴史データでは普通にあるので、問題として扱わない（FR-DM-08）。
 */
export type DatasetIssue =
  | { code: 'duplicate-node-id'; owner: IssueOwner }
  | { code: 'duplicate-edge-id'; owner: IssueOwner }
  | { code: 'duplicate-node-type-id'; owner: IssueOwner }
  | { code: 'duplicate-schema-key'; owner: IssueOwner; appliesTo: 'node' | 'edge' }
  | { code: 'edge-dangling-endpoint'; owner: IssueOwner; end: 'source' | 'target'; nodeId: NodeId }
  | { code: 'node-unknown-type'; owner: IssueOwner; typeId: NodeTypeId }
  | { code: 'schema-unknown-node-type'; owner: IssueOwner; typeId: NodeTypeId }
  | {
      code: 'graph-mode-mismatch';
      owner: IssueOwner;
      graphMode: 'directed' | 'undirected';
      directed: boolean;
    }
  | {
      code: 'date-range-inverted';
      owner: IssueOwner;
      path: string;
      earliest: DayNumber;
      latest: DayNumber;
    }
  | { code: 'date-not-integer'; owner: IssueOwner; path: string; value: number }
  | {
      code: 'span-inverted';
      owner: IssueOwner;
      path: string;
      startEarliest: DayNumber;
      endLatest: DayNumber;
    }
  | { code: 'geo-out-of-range'; owner: IssueOwner; lat: number; lon: number }
  | { code: 'weight-invalid'; owner: IssueOwner; weight: number }
  | { code: 'non-finite-scalar'; owner: IssueOwner; path: string }
  | { code: 'empty-value'; owner: IssueOwner; path: string }
  | { code: 'attribute-not-in-schema'; owner: IssueOwner; key: string }
  | {
      code: 'attribute-type-mismatch';
      owner: IssueOwner;
      key: string;
      expected: string;
      found: string;
    }
  | { code: 'attribute-wrong-node-type'; owner: IssueOwner; key: string; expected: NodeTypeId }
  | { code: 'attribute-absent'; owner: IssueOwner; key: string };

/**
 * ID の重複を見つける下請け。2 回目以降に出た ID を、出た回数だけ onDuplicate に渡す。
 *
 * @param ids - ID の並び
 * @param onDuplicate - 重複した ID を受け取る関数
 */
// 【TS】`<T extends string>` はジェネリクス。「文字列の部分型なら何でも受ける」という制約つきで、
//       NodeId、EdgeId、NodeTypeId のどれが来ても、その型のまま onDuplicate に渡せる。
//       `Iterable<T>` は配列でも Set でも受けられる、for...of で回せるものの型。
function findDuplicates<T extends string>(ids: Iterable<T>, onDuplicate: (id: T) => void): void {
  const seen = new Set<T>();
  for (const id of ids) {
    if (seen.has(id)) onDuplicate(id);
    else seen.add(id);
  }
}

// 【TS】`ReadonlyMap` は「読み出し専用の Map」（`ReadonlySet` の Map 版）。関数に渡しても
//       中身を書き換えられないことを型で約束する。
/** 持ち主の種類ごとの、schema の定義の表（キー → 定義）。 */
type DefMap = ReadonlyMap<string, AttributeDef>;

/**
 * Dataset の不変条件を検査し、問題の一覧を返す。
 *
 * 検査する項目: ID の重複（ノード、エッジ、ノード型、schema のキー）、存在しないノードを指すエッジ、
 * 存在しない型のノード、graphMode とエッジの directed の食い違い、
 * 日付の earliest > latest と整数でない日、期間の start が end より後、
 * 範囲外または非有限の座標、負または非有限の重み、有限でない数値、空の値、
 * schema にない属性キー、schema の型と合わない値、存在しないノード型を指す schema、
 * 型を限った属性を別の型のノードが持つこと、当てはまる属性のキーが無いこと。
 *
 * 計算量: O(ノード数 + エッジ数 + 属性の数)。ID の集合と schema の表を 1 回作り、
 * 以降は各ノード、各エッジ、各属性を 1 回ずつ見る。「当てはまる属性の数」は型ごとに先に数えておき、
 * 足りないときだけ定義を順に調べる（報告する問題の数に比例する）。
 *
 * @param ds - 検査する Dataset（変更しない）
 * @returns 問題の一覧。問題が無ければ空配列
 *
 * @example
 * ```ts
 * const issues = checkDataset(ds);
 * if (issues.length > 0) console.warn(issues.map((i) => i.code));
 * ```
 */
export function checkDataset(ds: Dataset): DatasetIssue[] {
  const issues: DatasetIssue[] = [];

  // ノード型と、ID の集合
  findDuplicates(
    ds.nodeTypes.map((t) => t.id),
    (id) => issues.push({ code: 'duplicate-node-type-id', owner: { entity: 'nodeType', id } }),
  );
  const typeIds = new Set<NodeTypeId>(ds.nodeTypes.map((t) => t.id));
  findDuplicates(
    ds.nodes.map((n) => n.id),
    (id) => issues.push({ code: 'duplicate-node-id', owner: { entity: 'node', id } }),
  );
  const nodeIds = new Set<NodeId>(ds.nodes.map((n) => n.id));
  findDuplicates(
    ds.edges.map((e) => e.id),
    (id) => issues.push({ code: 'duplicate-edge-id', owner: { entity: 'edge', id } }),
  );

  // schema は、持ち主の種類（node / edge）ごとに「キー → 定義」の表にする。
  // 【なぜ】Map を使う。キーは利用者の列名なので、素のオブジェクトだと `constructor` などで誤る（D-19）。
  const nodeDefs = new Map<string, AttributeDef>();
  const edgeDefs = new Map<string, AttributeDef>();
  // 型ごとの「当てはまるノード属性の数」を数える準備（型を限らない属性は全型に当てはまる）
  let generalNodeDefs = 0;
  const typedNodeDefs = new Map<NodeTypeId, number>();
  for (const def of ds.schema) {
    const defs = def.appliesTo === 'node' ? nodeDefs : edgeDefs;
    const owner: IssueOwner = { entity: 'schema', id: def.key };
    if (defs.has(def.key)) {
      issues.push({ code: 'duplicate-schema-key', owner, appliesTo: def.appliesTo });
      continue; // 重複した定義は数えない（先に出たものを正とする）
    }
    defs.set(def.key, def);
    if (def.nodeType !== undefined && !typeIds.has(def.nodeType)) {
      issues.push({ code: 'schema-unknown-node-type', owner, typeId: def.nodeType });
    }
    if (def.appliesTo === 'node') {
      if (def.nodeType === undefined) generalNodeDefs += 1;
      else typedNodeDefs.set(def.nodeType, (typedNodeDefs.get(def.nodeType) ?? 0) + 1);
    }
  }

  for (const node of ds.nodes) {
    const owner: IssueOwner = { entity: 'node', id: node.id };
    if (!typeIds.has(node.type)) {
      issues.push({ code: 'node-unknown-type', owner, typeId: node.type });
    }
    checkGeo(owner, node.geo, issues);
    checkTime(owner, node.time, issues);
    const present = checkAttrs(owner, node.attrs, nodeDefs, node.type, issues);
    // 当てはまる属性の数に足りなければ、どのキーが無いかを調べる（キーが無い ＝ 当てはまらない、または違反）
    const expected = generalNodeDefs + (typedNodeDefs.get(node.type) ?? 0);
    if (present < expected) {
      for (const def of nodeDefs.values()) {
        const applies = def.nodeType === undefined || def.nodeType === node.type;
        if (applies && getAttr(node.attrs, def.key) === undefined) {
          issues.push({ code: 'attribute-absent', owner, key: def.key });
        }
      }
    }
  }

  const edgeExpected = edgeDefs.size;
  for (const edge of ds.edges) {
    const owner: IssueOwner = { entity: 'edge', id: edge.id };
    // 【なぜ】自己ループ（source === target）と多重エッジは、ここで何も報告しない（FR-DM-08）。
    //       往復の取引や、同じ二者間の複数の関係は、歴史データでは普通にある。
    if (!nodeIds.has(edge.source)) {
      issues.push({ code: 'edge-dangling-endpoint', owner, end: 'source', nodeId: edge.source });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({ code: 'edge-dangling-endpoint', owner, end: 'target', nodeId: edge.target });
    }
    if (
      (ds.graphMode === 'directed' && !edge.directed) ||
      (ds.graphMode === 'undirected' && edge.directed)
    ) {
      issues.push({
        code: 'graph-mode-mismatch',
        owner,
        graphMode: ds.graphMode,
        directed: edge.directed,
      });
    }
    // 【なぜ】`!(有限 && 0 以上)` の形で書く。NaN は比較がすべて false になるので、
    //       「負なら不正」と書くと NaN を見逃す。
    if (!(Number.isFinite(edge.weight) && edge.weight >= 0)) {
      issues.push({ code: 'weight-invalid', owner, weight: edge.weight });
    }
    checkTime(owner, edge.time, issues);
    const present = checkAttrs(owner, edge.attrs, edgeDefs, undefined, issues);
    if (present < edgeExpected) {
      for (const def of edgeDefs.values()) {
        if (getAttr(edge.attrs, def.key) === undefined) {
          issues.push({ code: 'attribute-absent', owner, key: def.key });
        }
      }
    }
  }

  return issues;
}

/**
 * 地点の範囲を検査する。
 *
 * @param owner - 持ち主（ノード）
 * @param geo - 検査する地点。undefined（列が無い）と欠損は問題にしない
 * @param issues - 問題の追加先
 */
function checkGeo(owner: IssueOwner, geo: GeoValue | undefined, issues: DatasetIssue[]): void {
  if (geo === undefined || geo.kind === 'missing') return;
  const ok =
    Number.isFinite(geo.lat) &&
    Number.isFinite(geo.lon) &&
    geo.lat >= -90 &&
    geo.lat <= 90 &&
    geo.lon >= -180 &&
    geo.lon <= 180;
  if (!ok) issues.push({ code: 'geo-out-of-range', owner, lat: geo.lat, lon: geo.lon });
}

/**
 * 日付 1 つを検査する（日が安全な整数か、earliest <= latest か）。
 *
 * @param owner - 持ち主
 * @param path - 問題の場所を示す経路（例: `time.start`）
 * @param d - 検査する日付
 * @param issues - 問題の追加先
 */
function checkFuzzy(owner: IssueOwner, path: string, d: FuzzyDate, issues: DatasetIssue[]): void {
  let integral = true;
  for (const field of ['earliest', 'latest'] as const) {
    if (!Number.isSafeInteger(d[field])) {
      integral = false;
      issues.push({ code: 'date-not-integer', owner, path: `${path}.${field}`, value: d[field] });
    }
  }
  // 整数でないもの（NaN を含む）は上で報告済みなので、大小の比較は整数どうしだけで行う。
  if (integral && d.earliest > d.latest) {
    issues.push({
      code: 'date-range-inverted',
      owner,
      path,
      earliest: d.earliest,
      latest: d.latest,
    });
  }
}

/**
 * `time`（期間）を検査する。
 *
 * @param owner - 持ち主
 * @param time - 検査する期間。undefined と欠損は問題にしない
 * @param issues - 問題の追加先
 */
function checkTime(owner: IssueOwner, time: TimeValue | undefined, issues: DatasetIssue[]): void {
  if (time === undefined || time.kind === 'missing') return;
  checkFuzzy(owner, 'time.start', time.start, issues);
  // end が無い（1 点の日付）か、Missing（終わりが分からない）なら、逆転は判定できない。
  if (time.end === undefined || isMissing(time.end)) return;
  checkFuzzy(owner, 'time.end', time.end, issues);
  // 【なぜ】幅のある日付どうしなので、「確実に逆転している」場合だけを報告する。
  //       start の最も早い日が end の最も遅い日より後なら、どう解釈しても start は end より後である。
  //       幅が重なる（例: c.1650 から c.1650 まで）場合は、史料として自然なので報告しない。
  if (time.start.earliest > time.end.latest) {
    issues.push({
      code: 'span-inverted',
      owner,
      path: 'time',
      startEarliest: time.start.earliest,
      endLatest: time.end.latest,
    });
  }
}

/**
 * 属性の値の種類が、schema の valueType に合うかの説明を返す。
 *
 * @param def - 属性の定義
 * @param value - 値
 * @returns 合わなければ「期待する形」と「見つかった形」。合えば undefined
 */
function typeMismatch(
  def: AttributeDef,
  value: AttrValue,
): { expected: string; found: string } | undefined {
  if (value.kind === 'missing') return undefined; // 欠損はどの型の属性にも入れてよい
  const multi = def.multi !== undefined;
  if (def.valueType === 'date') {
    if (value.kind !== 'date') return { expected: 'date', found: value.kind };
    if (!multi && !('earliest' in value.value)) return { expected: 'date', found: 'array' };
    return undefined;
  }
  if (value.kind !== 'value') return { expected: def.valueType, found: value.kind };
  if (!multi && typeof value.value === 'object') {
    return { expected: def.valueType, found: 'array' };
  }
  // number、boolean は同名の typeof。string と category は string の値を持つ。
  const wanted = def.valueType === 'category' ? 'string' : def.valueType;
  for (const s of scalarValues(value)) {
    if (typeof s !== wanted) return { expected: def.valueType, found: typeof s };
  }
  return undefined;
}

/**
 * 属性の表を検査する。
 *
 * @param owner - 持ち主
 * @param attrs - 属性の表
 * @param defs - 持ち主の種類の schema の表
 * @param nodeType - 持ち主がノードならその型（エッジなら undefined）
 * @param issues - 問題の追加先
 * @returns 持ち主に「当てはまる」定義の属性を実際に持っている数
 */
function checkAttrs(
  owner: IssueOwner,
  attrs: Attrs,
  defs: DefMap,
  nodeType: NodeTypeId | undefined,
  issues: DatasetIssue[],
): number {
  let present = 0;
  // 【なぜ】Object.entries は自分自身の項目だけを返す。値の取り出しは getAttr を通さない
  //       （すでに列挙した項目で、継承の問題は起きない）。
  for (const [key, value] of Object.entries(attrs)) {
    const def = defs.get(key);
    if (def === undefined) {
      issues.push({ code: 'attribute-not-in-schema', owner, key });
      continue;
    }
    if (def.nodeType !== undefined && nodeType !== undefined && def.nodeType !== nodeType) {
      issues.push({ code: 'attribute-wrong-node-type', owner, key, expected: def.nodeType });
      continue;
    }
    present += 1;
    const mismatch = typeMismatch(def, value);
    if (mismatch !== undefined) {
      issues.push({ code: 'attribute-type-mismatch', owner, key, ...mismatch });
    }
    checkValue(owner, `attrs.${key}`, value, issues);
  }
  return present;
}

/**
 * 属性の値の中身（空の値、有限でない数、日付）を検査する。
 *
 * @param owner - 持ち主
 * @param path - 経路
 * @param value - 値
 * @param issues - 問題の追加先
 */
function checkValue(
  owner: IssueOwner,
  path: string,
  value: AttrValue,
  issues: DatasetIssue[],
): void {
  switch (value.kind) {
    case 'missing':
      return;
    case 'value': {
      const scalars = scalarValues(value);
      // 空の配列と空文字は値として持たない（Missing で表す。filter-audit #10）
      if (typeof value.value === 'object' && scalars.length === 0) {
        issues.push({ code: 'empty-value', owner, path });
      }
      scalars.forEach((s, i) => {
        const p = `${path}.value[${String(i)}]`;
        if (s === '') issues.push({ code: 'empty-value', owner, path: p });
        if (typeof s === 'number' && !Number.isFinite(s)) {
          issues.push({ code: 'non-finite-scalar', owner, path: p });
        }
      });
      return;
    }
    case 'date': {
      const dates = dateValues(value);
      if (dates.length === 0) issues.push({ code: 'empty-value', owner, path });
      dates.forEach((d, i) => {
        checkFuzzy(owner, `${path}[${String(i)}]`, d, issues);
      });
      return;
    }
    default:
      assertNever(value, 'AttrValue');
  }
}
