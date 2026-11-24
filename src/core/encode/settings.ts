/**
 * 見た目への割り当ての設定（FR-VG-03、04、08）。JSON にできる値だけで作る。
 */
// 【TS】`import type` と、名前の前の `type` は「型だけを import する」印。実行時には消える（verbatimModuleSyntax）。
import { isPlainObject, NODE_SHAPES, type NodeShape, type ParseResult } from '../model';
import { SCALE_KINDS, type ScaleKind } from './scale';

// 【TS】判別共用体。`kind` の値で、持つ項目（attr か metric か）が決まる。
/** ノードの大きさの元。`attr` は数値属性のキー、`metric` は指標の名前。 */
export type NodeSizeSource =
  | { readonly kind: 'constant' }
  | { readonly kind: 'attr'; readonly attr: string }
  | { readonly kind: 'metric'; readonly metric: string };

/** ノードの大きさ。min と max は半径（px）。平方根では、min が 0 のときに限り面積が値に比例する。min > 0 では値 0 も最小の大きさで描かれる。 */
export interface NodeSizeEncoding {
  readonly source: NodeSizeSource;
  readonly scale: ScaleKind;
  readonly min: number;
  readonly max: number;
}

/** ノードの色。型・属性はカテゴリの色、指標は連続値の色。 */
export type NodeColorEncoding =
  | { readonly kind: 'nodeType' }
  | { readonly kind: 'attr'; readonly attr: string }
  | { readonly kind: 'metric'; readonly metric: string };

/** ノードの形。 */
export type NodeShapeEncoding =
  { readonly kind: 'nodeType' } | { readonly kind: 'constant'; readonly shape: NodeShape };

/** エッジの太さ（px）。 */
export interface EdgeWidthEncoding {
  readonly source: { readonly kind: 'constant' } | { readonly kind: 'weight' };
  readonly scale: ScaleKind;
  readonly min: number;
  readonly max: number;
}

/** 見た目への割り当て全体。 */
export interface EncodingSettings {
  readonly nodeSize: NodeSizeEncoding;
  readonly nodeColor: NodeColorEncoding;
  readonly nodeShape: NodeShapeEncoding;
  readonly edgeWidth: EdgeWidthEncoding;
}

// 【TS】`oneOf` などの型付きの定数: 注釈 `: EncodingSettings` で型に合うか検査する。
/** 既定の割り当て。大きさと太さは平方根（D-08）。 */
export const DEFAULT_ENCODING: EncodingSettings = {
  nodeSize: { source: { kind: 'constant' }, scale: 'sqrt', min: 2.5, max: 10 },
  nodeColor: { kind: 'nodeType' },
  nodeShape: { kind: 'nodeType' },
  edgeWidth: { source: { kind: 'weight' }, scale: 'sqrt', min: 0.5, max: 2.5 },
};

interface Fail {
  ok: false;
  path: string;
  reason: string;
}
const fail = (path: string, reason: string): Fail => ({ ok: false, path, reason });
const join = (p: string, k: string): string => (p === '' ? k : `${p}.${k}`);
const own = (o: Record<string, unknown>, k: string): unknown =>
  Object.hasOwn(o, k) ? o[k] : undefined;

// 一覧のどれかの文字列を要求する。
// 【TS】`list: readonly T[]` の `readonly` は「この関数は配列を書き換えない」という約束。
//       `as const` の一覧のように読み取り専用の配列も渡せる。
// 【TS】`<T extends string>` は T が文字列リテラルの和集合であることを要求するジェネリクス。
function oneOf<T extends string>(x: unknown, path: string, list: readonly T[]): ParseResult<T> {
  const hit = list.find((v) => v === x);
  return hit !== undefined
    ? { ok: true, value: hit }
    : fail(path, `次のどれかが必要です: ${list.join(', ')}`);
}

function nonEmptyString(x: unknown, path: string): ParseResult<string> {
  return typeof x === 'string' && x.length > 0
    ? { ok: true, value: x }
    : fail(path, '空でない文字列が必要です');
}

// scale、min、max を読む。無ければ既定値。min > max や負の値は失敗。
function parseRange(
  o: Record<string, unknown>,
  path: string,
  def: { scale: ScaleKind; min: number; max: number },
): ParseResult<{ scale: ScaleKind; min: number; max: number }> {
  const scaleRaw = own(o, 'scale');
  const scale =
    scaleRaw === undefined
      ? // 【TS】`as const` は値のリテラルの型を保つ（ok が boolean でなく true になり、ParseResult に合う）。
        ({ ok: true, value: def.scale } as const)
      : oneOf(scaleRaw, join(path, 'scale'), SCALE_KINDS);
  if (!scale.ok) return scale;
  const nums: number[] = [];
  for (const key of ['min', 'max'] as const) {
    const raw = own(o, key);
    if (raw === undefined) nums.push(def[key]);
    else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) nums.push(raw);
    else return fail(join(path, key), '0 以上の有限な数値が必要です');
  }
  const [min = def.min, max = def.max] = nums;
  if (min > max) return fail(join(path, 'min'), 'min は max 以下にしてください');
  return { ok: true, value: { scale: scale.value, min, max } };
}

// ノードの大きさの元を読む。
// 【TS】`['a', 'b'] as const`（タプルの as const）は 'a' | 'b' の読み取り専用タプルになる。
//       oneOf の T がその和集合に決まり、`k.value` の分岐が型で絞り込まれる。
function parseSizeSource(o: Record<string, unknown>, path: string): ParseResult<NodeSizeSource> {
  const k = oneOf(own(o, 'kind'), join(path, 'kind'), ['constant', 'attr', 'metric'] as const);
  if (!k.ok) return k;
  if (k.value === 'constant') return { ok: true, value: { kind: 'constant' } };
  if (k.value === 'attr') {
    const s = nonEmptyString(own(o, 'attr'), join(path, 'attr'));
    return s.ok ? { ok: true, value: { kind: 'attr', attr: s.value } } : s;
  }
  const s = nonEmptyString(own(o, 'metric'), join(path, 'metric'));
  return s.ok ? { ok: true, value: { kind: 'metric', metric: s.value } } : s;
}

// ノードの色を読む。
function parseColor(o: Record<string, unknown>, path: string): ParseResult<NodeColorEncoding> {
  const k = oneOf(own(o, 'kind'), join(path, 'kind'), ['nodeType', 'attr', 'metric'] as const);
  if (!k.ok) return k;
  if (k.value === 'nodeType') return { ok: true, value: { kind: 'nodeType' } };
  if (k.value === 'attr') {
    const s = nonEmptyString(own(o, 'attr'), join(path, 'attr'));
    return s.ok ? { ok: true, value: { kind: 'attr', attr: s.value } } : s;
  }
  const s = nonEmptyString(own(o, 'metric'), join(path, 'metric'));
  return s.ok ? { ok: true, value: { kind: 'metric', metric: s.value } } : s;
}

function sub(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): ParseResult<Record<string, unknown> | undefined> {
  const raw = own(parent, key);
  if (raw === undefined) return { ok: true, value: undefined };
  return isPlainObject(raw)
    ? { ok: true, value: raw }
    : fail(join(path, key), 'オブジェクトが必要です');
}

/**
 * 外から来た値（`unknown`）を検査して EncodingSettings に組み立て直す（`parseFilterState` と同じ流儀）。
 *
 * 無い項目は既定値で補う（D-24）。あるのに型が違う、min が max より大きい、は壊れた箇所を
 * `path` つきで失敗にする。余分な項目は落とす。
 *
 * @param x - JSON.parse の結果など
 * @returns 成功なら設定、失敗なら壊れた箇所と理由
 */
export function parseEncodingSettings(x: unknown): ParseResult<EncodingSettings> {
  if (!isPlainObject(x)) return fail('', 'オブジェクトが必要です');
  const D = DEFAULT_ENCODING;

  // nodeSize
  const sizeO = sub(x, 'nodeSize', '');
  if (!sizeO.ok) return sizeO;
  let nodeSize = D.nodeSize;
  if (sizeO.value) {
    const src = sub(sizeO.value, 'source', 'nodeSize');
    if (!src.ok) return src;
    let source: NodeSizeSource = D.nodeSize.source;
    if (src.value) {
      const p = parseSizeSource(src.value, 'nodeSize.source');
      if (!p.ok) return p;
      source = p.value;
    }
    const r = parseRange(sizeO.value, 'nodeSize', D.nodeSize);
    if (!r.ok) return r;
    nodeSize = { source, ...r.value };
  }

  // nodeColor
  const colO = sub(x, 'nodeColor', '');
  if (!colO.ok) return colO;
  let nodeColor = D.nodeColor;
  if (colO.value) {
    const p = parseColor(colO.value, 'nodeColor');
    if (!p.ok) return p;
    nodeColor = p.value;
  }

  // nodeShape
  const shO = sub(x, 'nodeShape', '');
  if (!shO.ok) return shO;
  let nodeShape = D.nodeShape;
  if (shO.value) {
    const k = oneOf(own(shO.value, 'kind'), 'nodeShape.kind', ['nodeType', 'constant'] as const);
    if (!k.ok) return k;
    if (k.value === 'nodeType') nodeShape = { kind: 'nodeType' };
    else {
      const s = oneOf(own(shO.value, 'shape'), 'nodeShape.shape', NODE_SHAPES);
      if (!s.ok) return s;
      nodeShape = { kind: 'constant', shape: s.value };
    }
  }

  // edgeWidth
  const ewO = sub(x, 'edgeWidth', '');
  if (!ewO.ok) return ewO;
  let edgeWidth = D.edgeWidth;
  if (ewO.value) {
    const src = sub(ewO.value, 'source', 'edgeWidth');
    if (!src.ok) return src;
    // 【TS】`EdgeWidthEncoding['source']` は「型の項目の型」を取り出す添字アクセス型。
    let source: EdgeWidthEncoding['source'] = D.edgeWidth.source;
    if (src.value) {
      const k = oneOf(own(src.value, 'kind'), 'edgeWidth.source.kind', [
        'constant',
        'weight',
      ] as const);
      if (!k.ok) return k;
      source = { kind: k.value };
    }
    const r = parseRange(ewO.value, 'edgeWidth', D.edgeWidth);
    if (!r.ok) return r;
    edgeWidth = { source, ...r.value };
  }

  return { ok: true, value: { nodeSize, nodeColor, nodeShape, edgeWidth } };
}
