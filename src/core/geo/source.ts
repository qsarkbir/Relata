/**
 * 座標の出どころと、ノードの座標の取り出し（D-46、R-25、FR-MP-05、FR-VG-02）。
 *
 * 地図（FR-MP）と、グラフの地理座標の配置（FR-VG-02）が、同じ設定・同じ関数で座標を取り出すための
 * 純粋な関数を置く。出どころは 2 つ:
 * - `geo`: 読み込みで緯度・経度の列を指定したときに入る `GraphNode.geo`（公開サンプルもこの形）。
 * - `attrs`: 利用者が選んだ 2 つの属性（緯度の列、経度の列）。
 *
 * 歴史研究の注意: 古い地名の現在の座標は推定を含む。ここは値を信じて取り出すだけで、
 * 地名の同定はしない。座標が使えないノードは、理由つきで返し、図や地図から黙って消さない。
 */
import {
  getAttr,
  isMissing,
  isPlainObject,
  type Attrs,
  type Dataset,
  type GeoValue,
  type NodeTypeId,
} from '../model';
import { parseDecimal } from '../text/numeric';
import { assertNever } from '../util/assertNever';

// 【TS】判別共用体。`kind` が 'attrs' のときだけ `lat` と `lon`（属性のキー）を持つ。
/**
 * 座標の出どころ。
 *
 * - `geo`: ノードの `geo`（既定）。
 * - `attrs`: 緯度と経度の属性のキー（利用者の列名）。
 */
export type GeoSource =
  { readonly kind: 'geo' } | { readonly kind: 'attrs'; readonly lat: string; readonly lon: string };

/** 既定の座標の出どころ。 */
export const DEFAULT_GEO_SOURCE: GeoSource = { kind: 'geo' };

/** メルカトルで扱える緯度の限界（度）。世界を正方形に収める値。極に近いと発散する。 */
export const MAX_GEO_LAT = 85.0511287798;
/** 経度の限界（度）。 */
export const MAX_GEO_LON = 180;

/** 緯度（度）と経度（度）の組。 */
export interface GeoCoordinate {
  readonly lat: number;
  readonly lon: number;
}

/**
 * 座標が取り出せなかった理由。「地図に載らないノード」の一覧（FR-MP-05）で、利用者に説明する粒度。
 *
 * - `no-column`: その**型**のノードに、座標が 1 つも無い（出どころが `geo` なら、点の `geo` を持つノードがその型に
 *   1 つも無い。`attrs` なら、緯度・経度の属性に欠損でない値を持つノードがその型に 1 つも無い）。「この型には座標の列が無い」
 *   という意味で、値が空なのとは別。地名だけに座標がある人物・地名のネットワークでの、人物がこれに当たる。
 *   型の情報（`coverage`）を渡さない `nodeGeo` では、ノード単体で見て「項目がそのノードに無い」ことを指す。
 * - `missing`: 型としては座標の列があるが、そのノードの値が欠損（記載なし、亡失など。D-18）、または
 *   出どころが `geo` で、そのノードに `geo` が付いていない。
 *   【なぜ】読み込みは、空欄・読めない値・範囲外を区別せず `geo` を付けない（欠損と同じ扱い）ため、
 *   型としては座標があるのに `geo` が無いノードは、画面では「値が無い」と説明する。
 * - `invalid`: 値が数として読めない（文字列、真偽値、日付）、または複数の値を持つ。
 * - `out-of-range`: 数だが、地図で描けない。緯度が ±85.0511° を超える、経度が ±180° を超える。
 *
 * 【なぜ】4 つに分ける。直し方が違うため（列を指定する、値を入れる、表記を直す、地図の範囲外）。
 */
export type GeoNoneReason = 'no-column' | 'missing' | 'invalid' | 'out-of-range';

/** 座標の取り出しの理由の一覧（画面の並びの基準にもなる）。 */
export const GEO_NONE_REASONS = [
  'no-column',
  'missing',
  'invalid',
  'out-of-range',
] as const satisfies readonly GeoNoneReason[];

/** 座標の取り出しの結果。座標があるか、無いなら理由。 */
export type NodeGeoResult =
  | { readonly kind: 'point'; readonly lat: number; readonly lon: number }
  | { readonly kind: 'none'; readonly reason: GeoNoneReason };

// 座標 1 つ（緯度か経度）の取り出しの途中の結果。範囲の検査の前の値。
type Part =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: GeoNoneReason };

// 属性 1 つの値を数にする。要素 1 つの配列は、その要素を使う（既存の extractGeoInputs と同じ規則）。
//
function attrPart(attrs: Attrs, key: string): Part {
  const a = getAttr(attrs, key);
  if (a === undefined) return { ok: false, reason: 'no-column' };
  if (isMissing(a)) return { ok: false, reason: 'missing' };
  // 日付の属性は座標にならない。
  if (a.kind !== 'value') return { ok: false, reason: 'invalid' };
  // 【TS】`Array.isArray` は型ガード。true の分岐では a.value が配列として扱える。
  const v: unknown = Array.isArray(a.value)
    ? a.value.length === 1
      ? a.value[0]
      : undefined
    : a.value;
  return numberPart(v);
}

// 値を数にする。数なら有限のもの、文字列なら 10 進の表記（parseDecimal。アラビア・インド数字も可）。
//
function numberPart(v: unknown): Part {
  if (typeof v === 'number')
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, reason: 'invalid' };
  if (typeof v === 'string') {
    const n = parseDecimal(v);
    return n === null ? { ok: false, reason: 'invalid' } : { ok: true, value: n };
  }
  return { ok: false, reason: 'invalid' };
}

// 理由の強さ。緯度と経度の両方が使えないとき、より「手前の」理由を返す。
// 【TS】`Readonly<Record<K, V>>` は「K のキーを全部そろえた、書き換え不可の表」。理由を足すと、ここも書かせる。
//
const REASON_RANK: Readonly<Record<GeoNoneReason, number>> = {
  'no-column': 0,
  missing: 1,
  invalid: 2,
  'out-of-range': 3,
};

/**
 * 緯度・経度の値が、地図で描ける座標かを検査する。
 *
 * @param lat - 緯度（度）
 * @param lon - 経度（度）
 * @returns 描けるなら座標、描けなければ理由（非有限の数は `invalid`、範囲外は `out-of-range`）
 */
export function checkGeoCoordinate(lat: number, lon: number): NodeGeoResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { kind: 'none', reason: 'invalid' };
  if (Math.abs(lat) > MAX_GEO_LAT || Math.abs(lon) > MAX_GEO_LON)
    return { kind: 'none', reason: 'out-of-range' };
  return { kind: 'point', lat, lon };
}

/**
 * 座標の出どころを持つ型の集合を作る（型単位の判定。D-21 の「キーを持たない」と同じ考え方）。
 *
 * 判定は**データで**行う（schema は使わない）。欠損でない値を 1 つでも持つノードがいる型だけを対象にする。
 * - 出どころが `geo`: 点（`kind: 'point'`）の `geo` を 1 つでも持つノードがいる型。
 * - 出どころが `attrs`: 緯度か経度の属性に、欠損でない値（読めない値・範囲外を含む）を 1 つでも持つノードがいる型。
 *
 * 【なぜ】2 表の読み込みでは、人物の緯度・経度が空欄だと `geo` が欠損（`{ kind: 'missing' }`）になり、
 * schema にも `nodeType` が付かない。「項目がある」で判定すると、座標が 1 つも無い人物の型まで対象になり、
 * 地名だけに座標がある 2 部グラフで人物が全員除かれてエッジが 0 本になる（k-partite の巻き添え。D-21）。
 * 欠損の値しか持たない型は、「この型のノードには座標が 1 つも無い」として対象外にする。
 *
 * 計算量: O(N)（N はノード数）。
 *
 * @param dataset - データセット
 * @param source - 座標の出どころ
 * @returns 出どころを持つ型の ID の集合
 */
export function geoSourceTypes(dataset: Dataset, source: GeoSource): ReadonlySet<NodeTypeId> {
  const types = new Set<NodeTypeId>();
  switch (source.kind) {
    case 'geo':
      for (const n of dataset.nodes) if (n.geo?.kind === 'point') types.add(n.type);
      return types;
    case 'attrs': {
      const hasValue = (attrs: Attrs, key: string): boolean => {
        const a = getAttr(attrs, key);
        return a !== undefined && !isMissing(a);
      };
      for (const n of dataset.nodes)
        if (hasValue(n.attrs, source.lat) || hasValue(n.attrs, source.lon)) types.add(n.type);
      return types;
    }
    default:
      return assertNever(source, 'GeoSource');
  }
}

/**
 * ノード 1 つの座標を、選んだ出どころから取り出す。
 *
 * `attrs` の読み方は `extractGeoInputs`（layout/geo.ts）と同じ: 10 進の数（アラビア・インド数字、
 * ペルシア数字、「٫」、「−」も可。'0x21' は不可）の 1 つの値だけを使い、要素 1 つの配列は可、
 * 複数値・欠損・数でない文字列・真偽値は使えない。緯度か経度のどちらかが使えなければ座標なし。
 * 両方が使えないときの理由は、`no-column` → `missing` → `invalid` → `out-of-range` の順に優先する
 * （手前の理由ほど、直す場所がはっきりしているため）。
 *
 * `coverage`（`geoSourceTypes` の結果）を渡すと、理由を型単位にする: ノードの型が対象外（その型のノードに
 * 座標が 1 つも無い）なら、そのノード自身が欠損の値を持っていても `no-column`。型が対象で、そのノードが
 * 座標なしなら、`missing`（欠損、項目なし）、`invalid`、`out-of-range`。渡さなければ、ノード単体で見て、
 * 項目が無ければ `no-column`（型の情報が無いので、`extractGeoInputs` と同じ見方）。
 *
 * @param node - ノード（`type`、`geo`、`attrs` だけを見る。ID やラベルでは照合しない）
 * @param source - 座標の出どころ
 * @param coverage - 出どころを持つ型の集合（省略可）。渡すときは `node.type` も渡す
 * @returns 座標、または座標なしと理由
 *
 * @example
 * ```ts
 * const coverage = geoSourceTypes(dataset, source);
 * nodeGeo(node, source, coverage);
 * // => { kind: 'point', lat: 33.6, lon: -7.6 } または { kind: 'none', reason: 'missing' }
 * ```
 */
export function nodeGeo(
  node: { readonly type?: NodeTypeId; readonly geo?: GeoValue; readonly attrs: Attrs },
  source: GeoSource,
  coverage?: ReadonlySet<NodeTypeId>,
): NodeGeoResult {
  if (coverage !== undefined && (node.type === undefined || !coverage.has(node.type)))
    return { kind: 'none', reason: 'no-column' };
  const r = nodeGeoOfNode(node, source);
  // 型は出どころを持つので、ノードに項目が無いのは「値が無い」（io は空欄・読めない値・範囲外に geo を付けない）。
  if (coverage !== undefined && r.kind === 'none' && r.reason === 'no-column')
    return { kind: 'none', reason: 'missing' };
  return r;
}

// ノード単体で見た座標の取り出し（型の情報を使わない）。
//
function nodeGeoOfNode(
  node: { readonly geo?: GeoValue; readonly attrs: Attrs },
  source: GeoSource,
): NodeGeoResult {
  switch (source.kind) {
    case 'geo': {
      const g = node.geo;
      if (g === undefined) return { kind: 'none', reason: 'no-column' };
      if (g.kind === 'missing') return { kind: 'none', reason: 'missing' };
      return checkGeoCoordinate(g.lat, g.lon);
    }
    case 'attrs': {
      const lat = attrPart(node.attrs, source.lat);
      const lon = attrPart(node.attrs, source.lon);
      if (!lat.ok && !lon.ok)
        return {
          kind: 'none',
          reason: REASON_RANK[lat.reason] <= REASON_RANK[lon.reason] ? lat.reason : lon.reason,
        };
      if (!lat.ok) return { kind: 'none', reason: lat.reason };
      if (!lon.ok) return { kind: 'none', reason: lon.reason };
      return checkGeoCoordinate(lat.value, lon.value);
    }
    default:
      return assertNever(source, 'GeoSource');
  }
}

/**
 * ノード 1 つの座標を、取り出せたときだけ返す（理由が要らないとき用）。
 *
 * @param node - ノード
 * @param source - 座標の出どころ
 * @returns 座標、取り出せなければ null
 */
export function nodeGeoPoint(
  node: { readonly type?: NodeTypeId; readonly geo?: GeoValue; readonly attrs: Attrs },
  source: GeoSource,
): GeoCoordinate | null {
  const r = nodeGeo(node, source);
  return r.kind === 'point' ? { lat: r.lat, lon: r.lon } : null;
}

/**
 * 外から来た値が座標の出どころかを調べて、組み立て直す。
 *
 * @param x - 任意の値
 * @returns 出どころ。形が正しくなければ null（`attrs` の `lat`、`lon` は空でない文字列が必要）
 */
export function parseGeoSourceValue(x: unknown): GeoSource | null {
  // 【TS】`isPlainObject` は型ガード。true の分岐では x が `Record<string, unknown>` として読める。
  if (!isPlainObject(x)) return null;
  // 【なぜ】自分自身の項目だけを読む（`constructor` などの継承した項目を読まない）。
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const kind = get('kind');
  if (kind === 'geo') return { kind: 'geo' };
  if (kind !== 'attrs') return null;
  const lat = get('lat');
  const lon = get('lon');
  if (typeof lat !== 'string' || lat === '' || typeof lon !== 'string' || lon === '') return null;
  return { kind: 'attrs', lat, lon };
}

/**
 * 2 つの出どころが同じ設定かを比べる。
 *
 * @param a - 出どころ
 * @param b - 出どころ
 * @returns 同じなら true
 */
export function sameGeoSource(a: GeoSource, b: GeoSource): boolean {
  if (a.kind === 'geo') return b.kind === 'geo';
  return b.kind === 'attrs' && a.lat === b.lat && a.lon === b.lon;
}
