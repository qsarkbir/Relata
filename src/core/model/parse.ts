/**
 * 外から来た値（`unknown`）を検査して Dataset に組み立て直す（parse, don't validate）。
 *
 * プロジェクトファイルの読み込み（T1-08）で、JSON.parse の結果を使う。
 * 入力をそのまま Dataset とみなさず、必要な項目だけを読み取って新しいオブジェクトを作る。
 * そのため、余分な項目は落ち、`__proto__` のような危険な項目も引き継がない。
 * 失敗したら、最初に見つかった壊れた箇所を `path`（例: `nodes[3].attrs.born.value[1].earliest`）で返す。
 *
 * ここで見るのは構造（必須の項目、種類の値、数値の型）だけ。不変条件は `checkDataset` で見る。
 * 【なぜ】座標と重みは「number であること」までしか見ない。範囲外や負の値は構造としては
 * 正しいので通し、`checkDataset` が ID つきで報告する。日の値は、JDN が整数でなければ
 * 意味を成さないので、安全な整数であることを構造として要求する。
 * `checkDataset` が問題を返さない Dataset は、JSON を往復しても必ずここを通る（自動保存から戻れる）。
 */
import { makeAttrs, type Attrs } from './attrs';
import type { GeoPoint } from './geo';
import {
  GRAPH_MODES,
  NODE_SHAPES,
  VALUE_TYPES,
  type AttributeDef,
  type Dataset,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from './graph';
import { toEdgeId, toNodeId, toNodeTypeId } from './ids';
import { CALENDAR_IDS, type CalendarId, type TimeSpan } from './time';
import {
  isCertainty,
  isMissingReason,
  type AttrValue,
  type FuzzyDate,
  type Missing,
  type Scalar,
} from './values';

/** 解析の結果。成功なら組み立てた値、失敗なら壊れた箇所と理由。 */
// 【TS】判別共用体。`ok` が true か false かで、持つ項目が決まる。
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly path: string; readonly reason: string };

// 失敗の結果を作る。
//
function fail(path: string, reason: string): { ok: false; path: string; reason: string } {
  return { ok: false, path, reason };
}

// 成功の結果を作る。
//
function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// オブジェクトの項目の経路を延ばす（`a` + `b` → `a.b`。根は空文字）。
//
function child(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

// 配列の要素の経路を作る（`a` + 2 → `a[2]`）。
//
function at(path: string, index: number): string {
  return `${path}[${String(index)}]`;
}

/**
 * 配列でない普通のオブジェクトかを判定する。
 *
 * @param x - 判定する値
 * @returns オブジェクトなら true
 */
// 【TS】`x is Record<string, unknown>` は「中身は未検査だが、文字列キーで引けるオブジェクト」
//       という型ガード。unknown のままではプロパティを読めないので、まずここで絞り込む。
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// オブジェクトから、自分自身の項目だけを読む。
// @param o - オブジェクト
// @param key - 項目名
// @returns 値。無ければ undefined
//
function get(o: Record<string, unknown>, key: string): unknown {
  // 【なぜ】継承した項目（constructor など）を読まないよう、hasOwn で確かめる。
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

// オブジェクトを要求する。
//
function needObject(x: unknown, path: string): ParseResult<Record<string, unknown>> {
  return isPlainObject(x) ? ok(x) : fail(path, 'オブジェクトが必要です');
}

// 文字列を要求する。`nonEmpty` なら空文字も拒否する。
//
function needString(x: unknown, path: string, nonEmpty = false): ParseResult<string> {
  if (typeof x !== 'string') return fail(path, '文字列が必要です');
  if (nonEmpty && x.length === 0) return fail(path, '空文字は使えません');
  return ok(x);
}

// number（NaN を含みうる）を要求する。範囲は checkDataset が見る。
//
function needNumber(x: unknown, path: string): ParseResult<number> {
  return typeof x === 'number' ? ok(x) : fail(path, '数値が必要です');
}

// 安全な整数（日の値）を要求する。
//
function needDay(x: unknown, path: string): ParseResult<number> {
  return typeof x === 'number' && Number.isSafeInteger(x)
    ? ok(x)
    : fail(path, '安全な整数が必要です');
}

// 配列を要求する。
//
function needArray(x: unknown, path: string): ParseResult<readonly unknown[]> {
  return Array.isArray(x) ? ok(x as readonly unknown[]) : fail(path, '配列が必要です'); // 理由: isArray は any[] を返すので、unknown の配列に狭める
}

/**
 * 配列の各要素を parseItem で組み立てる。最初に失敗した要素で止める。
 *
 * @param x - 配列のはずの値
 * @param path - 経路
 * @param parseItem - 要素の組み立て関数
 * @returns 組み立てた配列
 */
// 【TS】`<T>` はジェネリクス。要素の型 T を呼び出しごとに決める（NodeType の配列、GraphNode の配列など）。
function parseArray<T>(
  x: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => ParseResult<T>,
): ParseResult<T[]> {
  const arr = needArray(x, path);
  if (!arr.ok) return arr;
  const out: T[] = [];
  for (const [i, item] of arr.value.entries()) {
    const r = parseItem(item, at(path, i));
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

// 列挙の値（文字列の一覧のどれか）を要求する。
// @param x - 検査する値
// @param path - 経路
// @param allowed - 許す値の一覧
// @returns 一覧のどれかなら成功
//
function needOneOf<T extends string>(
  x: unknown,
  path: string,
  allowed: readonly T[],
): ParseResult<T> {
  const found = allowed.find((a) => a === x);
  return found === undefined
    ? fail(path, `次のどれかが必要です: ${allowed.join(', ')}`)
    : ok(found);
}

// 欠損を組み立てる。
//
function parseMissing(x: unknown, path: string): ParseResult<Missing> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  if (get(o.value, 'kind') !== 'missing') return fail(child(path, 'kind'), "'missing' が必要です");
  const reason = get(o.value, 'reason');
  if (!isMissingReason(reason)) return fail(child(path, 'reason'), '欠損の理由が正しくありません');
  return ok({ kind: 'missing', reason });
}

// FuzzyDate を組み立てる。
//
function parseFuzzyDate(x: unknown, path: string): ParseResult<FuzzyDate> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const earliest = needDay(get(o.value, 'earliest'), child(path, 'earliest'));
  if (!earliest.ok) return earliest;
  const latest = needDay(get(o.value, 'latest'), child(path, 'latest'));
  if (!latest.ok) return latest;
  const certainty = get(o.value, 'certainty');
  if (!isCertainty(certainty))
    return fail(child(path, 'certainty'), '確からしさが正しくありません');
  const calendar = needOneOf<CalendarId>(
    get(o.value, 'calendar'),
    child(path, 'calendar'),
    CALENDAR_IDS,
  );
  if (!calendar.ok) return calendar;
  const label = needString(get(o.value, 'label'), child(path, 'label'));
  if (!label.ok) return label;
  return ok({
    earliest: earliest.value,
    latest: latest.value,
    certainty,
    calendar: calendar.value,
    label: label.value,
  });
}

// 期間か欠損を組み立てる（`time` の値）。
//
function parseTimeValue(x: unknown, path: string): ParseResult<TimeSpan | Missing> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  if (get(o.value, 'kind') === 'missing') return parseMissing(x, path);
  if (get(o.value, 'kind') !== 'span')
    return fail(child(path, 'kind'), "'span' か 'missing' が必要です");
  const start = parseFuzzyDate(get(o.value, 'start'), child(path, 'start'));
  if (!start.ok) return start;
  const endRaw = get(o.value, 'end');
  if (endRaw === undefined) return ok({ kind: 'span', start: start.value });
  const endPath = child(path, 'end');
  // 欠損なら Missing、そうでなければ FuzzyDate として読む
  const end =
    isPlainObject(endRaw) && get(endRaw, 'kind') === 'missing'
      ? parseMissing(endRaw, endPath)
      : parseFuzzyDate(endRaw, endPath);
  if (!end.ok) return end;
  return ok({ kind: 'span', start: start.value, end: end.value });
}

// 地点か欠損を組み立てる（`geo` の値）。
//
function parseGeoValue(x: unknown, path: string): ParseResult<GeoPoint | Missing> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  if (get(o.value, 'kind') === 'missing') return parseMissing(x, path);
  if (get(o.value, 'kind') !== 'point')
    return fail(child(path, 'kind'), "'point' か 'missing' が必要です");
  const lat = needNumber(get(o.value, 'lat'), child(path, 'lat'));
  if (!lat.ok) return lat;
  const lon = needNumber(get(o.value, 'lon'), child(path, 'lon'));
  if (!lon.ok) return lon;
  return ok({ kind: 'point', lat: lat.value, lon: lon.value });
}

// Scalar（文字列、有限の数、真偽値）を組み立てる。
//
function parseScalar(x: unknown, path: string): ParseResult<Scalar> {
  if (typeof x === 'string' || typeof x === 'boolean') return ok(x);
  if (typeof x === 'number' && Number.isFinite(x)) return ok(x);
  return fail(path, '文字列、有限の数、真偽値のどれかが必要です');
}

// AttrValue を組み立てる。
//
function parseAttrValue(x: unknown, path: string): ParseResult<AttrValue> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const kind = get(o.value, 'kind');
  switch (kind) {
    case 'missing':
      return parseMissing(x, path);
    case 'value': {
      const raw = get(o.value, 'value');
      const vp = child(path, 'value');
      const value = Array.isArray(raw) ? parseArray(raw, vp, parseScalar) : parseScalar(raw, vp);
      if (!value.ok) return value;
      const certainty = get(o.value, 'certainty');
      if (certainty === undefined) return ok({ kind: 'value', value: value.value });
      if (!isCertainty(certainty))
        return fail(child(path, 'certainty'), '確からしさが正しくありません');
      return ok({ kind: 'value', value: value.value, certainty });
    }
    case 'date': {
      const raw = get(o.value, 'value');
      const vp = child(path, 'value');
      const value = Array.isArray(raw)
        ? parseArray(raw, vp, parseFuzzyDate)
        : parseFuzzyDate(raw, vp);
      if (!value.ok) return value;
      return ok({ kind: 'date', value: value.value });
    }
    default:
      return fail(child(path, 'kind'), "'value'、'date'、'missing' のどれかが必要です");
  }
}

// 属性の表を組み立てる。列名は何でもよい（`__proto__` も、普通の列名として引き継ぐ）。
//
function parseAttrs(x: unknown, path: string): ParseResult<Attrs> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const entries: (readonly [string, AttrValue])[] = [];
  for (const [key, raw] of Object.entries(o.value)) {
    const r = parseAttrValue(raw, child(path, key));
    if (!r.ok) return r;
    entries.push([key, r.value]);
  }
  return ok(makeAttrs(entries));
}

// 値が undefined（項目が無い）でなければ parse で読み、無ければ undefined を成功として返す。
//
function optional<T>(
  x: unknown,
  path: string,
  parse: (x: unknown, path: string) => ParseResult<T>,
): ParseResult<T | undefined> {
  return x === undefined ? ok(undefined) : parse(x, path);
}

// NodeType を組み立てる。
//
function parseNodeType(x: unknown, path: string): ParseResult<NodeType> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const id = needString(get(o.value, 'id'), child(path, 'id'), true);
  if (!id.ok) return id;
  const label = needString(get(o.value, 'label'), child(path, 'label'));
  if (!label.ok) return label;
  const color = optional(get(o.value, 'color'), child(path, 'color'), needString);
  if (!color.ok) return color;
  const shape = optional(get(o.value, 'shape'), child(path, 'shape'), (v, p) =>
    needOneOf(v, p, NODE_SHAPES),
  );
  if (!shape.ok) return shape;
  return ok({
    id: toNodeTypeId(id.value),
    label: label.value,
    ...(color.value !== undefined && { color: color.value }),
    ...(shape.value !== undefined && { shape: shape.value }),
  });
}

// GraphNode を組み立てる。
//
function parseNode(x: unknown, path: string): ParseResult<GraphNode> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const id = needString(get(o.value, 'id'), child(path, 'id'), true);
  if (!id.ok) return id;
  const type = needString(get(o.value, 'type'), child(path, 'type'), true);
  if (!type.ok) return type;
  const label = needString(get(o.value, 'label'), child(path, 'label'));
  if (!label.ok) return label;
  const attrs = parseAttrs(get(o.value, 'attrs'), child(path, 'attrs'));
  if (!attrs.ok) return attrs;
  const geo = optional(get(o.value, 'geo'), child(path, 'geo'), parseGeoValue);
  if (!geo.ok) return geo;
  const time = optional(get(o.value, 'time'), child(path, 'time'), parseTimeValue);
  if (!time.ok) return time;
  return ok({
    id: toNodeId(id.value),
    type: toNodeTypeId(type.value),
    label: label.value,
    attrs: attrs.value,
    ...(geo.value !== undefined && { geo: geo.value }),
    ...(time.value !== undefined && { time: time.value }),
  });
}

// GraphEdge を組み立てる。
//
function parseEdge(x: unknown, path: string): ParseResult<GraphEdge> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const id = needString(get(o.value, 'id'), child(path, 'id'), true);
  if (!id.ok) return id;
  const source = needString(get(o.value, 'source'), child(path, 'source'), true);
  if (!source.ok) return source;
  const target = needString(get(o.value, 'target'), child(path, 'target'), true);
  if (!target.ok) return target;
  const directed = get(o.value, 'directed');
  if (typeof directed !== 'boolean') return fail(child(path, 'directed'), '真偽値が必要です');
  const relation = optional(get(o.value, 'relation'), child(path, 'relation'), needString);
  if (!relation.ok) return relation;
  const weight = needNumber(get(o.value, 'weight'), child(path, 'weight'));
  if (!weight.ok) return weight;
  const time = optional(get(o.value, 'time'), child(path, 'time'), parseTimeValue);
  if (!time.ok) return time;
  const attrs = parseAttrs(get(o.value, 'attrs'), child(path, 'attrs'));
  if (!attrs.ok) return attrs;
  return ok({
    id: toEdgeId(id.value),
    source: toNodeId(source.value),
    target: toNodeId(target.value),
    directed,
    ...(relation.value !== undefined && { relation: relation.value }),
    weight: weight.value,
    ...(time.value !== undefined && { time: time.value }),
    attrs: attrs.value,
  });
}

// AttributeDef を組み立てる。
//
function parseAttributeDef(x: unknown, path: string): ParseResult<AttributeDef> {
  const o = needObject(x, path);
  if (!o.ok) return o;
  const key = needString(get(o.value, 'key'), child(path, 'key'));
  if (!key.ok) return key;
  const label = needString(get(o.value, 'label'), child(path, 'label'));
  if (!label.ok) return label;
  const appliesTo = needOneOf(get(o.value, 'appliesTo'), child(path, 'appliesTo'), [
    'node',
    'edge',
  ] as const);
  if (!appliesTo.ok) return appliesTo;
  const nodeType = optional(get(o.value, 'nodeType'), child(path, 'nodeType'), (v, p) =>
    needString(v, p, true),
  );
  if (!nodeType.ok) return nodeType;
  const valueType = needOneOf(get(o.value, 'valueType'), child(path, 'valueType'), VALUE_TYPES);
  if (!valueType.ok) return valueType;
  const multi = optional(get(o.value, 'multi'), child(path, 'multi'), (v, p) => {
    const m = needObject(v, p);
    if (!m.ok) return m;
    const sep = needString(get(m.value, 'separator'), child(p, 'separator'));
    return sep.ok ? ok({ separator: sep.value }) : sep;
  });
  if (!multi.ok) return multi;
  return ok({
    key: key.value,
    label: label.value,
    appliesTo: appliesTo.value,
    ...(nodeType.value !== undefined && { nodeType: toNodeTypeId(nodeType.value) }),
    valueType: valueType.value,
    ...(multi.value !== undefined && { multi: multi.value }),
  });
}

/**
 * 外から来た値を検査して、新しい Dataset に組み立てる。
 *
 * 入力は書き換えない。余分な項目は落ちる。計算量は O(入力の大きさ)。
 *
 * @param x - 検査する値（JSON.parse の結果など）
 * @returns 成功なら組み立てた Dataset、失敗なら最初に見つかった壊れた箇所（`path`）と理由
 *
 * @example
 * ```ts
 * const parsed = parseDataset(JSON.parse(text));
 * if (!parsed.ok) throw new Error(`${parsed.path}: ${parsed.reason}`);
 * const issues = checkDataset(parsed.value); // 構造の次に不変条件を見る
 * ```
 */
export function parseDataset(x: unknown): ParseResult<Dataset> {
  const o = needObject(x, '');
  if (!o.ok) return o;
  const graphMode = needOneOf(get(o.value, 'graphMode'), 'graphMode', GRAPH_MODES);
  if (!graphMode.ok) return graphMode;
  const nodeTypes = parseArray(get(o.value, 'nodeTypes'), 'nodeTypes', parseNodeType);
  if (!nodeTypes.ok) return nodeTypes;
  const nodes = parseArray(get(o.value, 'nodes'), 'nodes', parseNode);
  if (!nodes.ok) return nodes;
  const edges = parseArray(get(o.value, 'edges'), 'edges', parseEdge);
  if (!edges.ok) return edges;
  const schema = parseArray(get(o.value, 'schema'), 'schema', parseAttributeDef);
  if (!schema.ok) return schema;
  const meta = needObject(get(o.value, 'meta'), 'meta');
  if (!meta.ok) return meta;
  const title = needString(get(meta.value, 'title'), 'meta.title');
  if (!title.ok) return title;
  const source = optional(get(meta.value, 'source'), 'meta.source', needString);
  if (!source.ok) return source;
  return ok({
    graphMode: graphMode.value,
    nodeTypes: nodeTypes.value,
    nodes: nodes.value,
    edges: edges.value,
    schema: schema.value,
    meta: { title: title.value, ...(source.value !== undefined && { source: source.value }) },
  });
}

/**
 * 外から来た値が Dataset の構造を満たすかを判定する（`parseDataset(x).ok` の薄い包み）。
 *
 * 型ガードとして使えるが、値を組み立て直さない。余分な項目を落としたいときは `parseDataset` を使う。
 *
 * @param x - 判定する値
 * @returns 構造を満たすなら true
 */
export function isDataset(x: unknown): x is Dataset {
  return parseDataset(x).ok;
}

/**
 * FuzzyDate の構造を満たすかを判定する（日数は安全な整数）。
 *
 * @param x - 判定する値
 * @returns FuzzyDate なら true
 */
export function isFuzzyDate(x: unknown): x is FuzzyDate {
  return parseFuzzyDate(x, '').ok;
}

/**
 * AttrValue の構造を満たすかを判定する。
 *
 * @param x - 判定する値
 * @returns AttrValue なら true
 */
export function isAttrValue(x: unknown): x is AttrValue {
  return parseAttrValue(x, '').ok;
}

/**
 * TimeSpan の構造を満たすかを判定する。
 *
 * @param x - 判定する値
 * @returns TimeSpan なら true
 */
export function isTimeSpan(x: unknown): x is TimeSpan {
  const r = parseTimeValue(x, '');
  return r.ok && r.value.kind === 'span';
}

/**
 * GeoPoint の構造を満たすかを判定する（範囲は見ない。見るのは checkDataset）。
 *
 * @param x - 判定する値
 * @returns GeoPoint なら true
 */
export function isGeoPoint(x: unknown): x is GeoPoint {
  const r = parseGeoValue(x, '');
  return r.ok && r.value.kind === 'point';
}
