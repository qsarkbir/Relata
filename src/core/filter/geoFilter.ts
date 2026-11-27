/**
 * 適用中の `geo` フィルタの説明（FR-FL-08、FR-MP-04、D-58）。
 *
 * 説明は文字にせず、構造で返す。文字にするのは ui（例: 「緯度 30〜36°、経度 −10〜0°」。
 * 180° をまたぐときは `crossesAntimeridian` を見て「経度 170°〜−170°（180°をまたぐ）」のように書く）。
 * 時間フィルタの `describeTimeFilter` と同じ作り方。
 */
import { describeGeoBBox, geoSourceTypes, type GeoBBoxDescription } from '../geo';
import type { Dataset, NodeTypeId } from '../model';
import { assertNever } from '../util/assertNever';
import type { FilterDef, MissingPolicy } from './types';

/** 説明に出す座標の出どころ。属性の組なら、キーと（schema にあれば）表示名。 */
export type GeoSourceDescription =
  | { readonly kind: 'geo' }
  | {
      readonly kind: 'attrs';
      readonly lat: string;
      readonly lon: string;
      /** schema の表示名。属性が schema に無ければ `undefined`（キーを出す）。 */
      readonly latLabel: string | undefined;
      readonly lonLabel: string | undefined;
    };

// 【TS】`interface A extends B` は、B の項目をすべて引き継いで A に項目を足す。範囲の説明（`GeoBBoxDescription`）に
//       出どころなどを足す形にして、範囲の部分を重複して書かない。
/** 適用中の `geo` フィルタの説明（文字にする前の構造）。 */
export interface GeoFilterDescription extends GeoBBoxDescription {
  readonly source: GeoSourceDescription;
  /** 座標のないノードを含めるか除くか。 */
  readonly missing: MissingPolicy;
  /**
   * 座標を持つ型（`geoSourceTypes` の結果。`nodeTypes` の順）。この型のノードだけが範囲で絞り込まれ、
   * 他の型は通る。データセットが無ければ空。
   * 【なぜ】どの型を「座標を持つ」と判定したかを、利用者に見せるため。
   */
  readonly coordinateTypes: readonly { readonly id: NodeTypeId; readonly label: string }[];
  /** 座標に関係なく通す型（射影の適用中の仲介の型）。無ければ空。 */
  readonly passTypes: readonly NodeTypeId[];
}

/**
 * `geo` フィルタを、説明用の構造にする。
 *
 * @param def - `geo` フィルタ（`kind: 'geo'`）
 * @param dataset - 属性の表示名を引くためのデータセット（省略すると表示名なし）
 * @returns 説明の構造
 */
// 【TS】`Extract<U, T>` は、共用体 U のうち T に当てはまるものだけを取り出す。ここでは FilterDef のうち
//       `kind: 'geo'` のものだけを受け取る（他の種類を渡すと型エラー）。
export function describeGeoFilter(
  def: Extract<FilterDef, { kind: 'geo' }>,
  dataset: Dataset | undefined,
): GeoFilterDescription {
  const s = def.source;
  let source: GeoSourceDescription;
  switch (s.kind) {
    case 'geo':
      source = { kind: 'geo' };
      break;
    case 'attrs': {
      const label = (key: string): string | undefined =>
        dataset?.schema.find((a) => a.key === key && a.appliesTo === 'node')?.label;
      source = {
        kind: 'attrs',
        lat: s.lat,
        lon: s.lon,
        latLabel: label(s.lat),
        lonLabel: label(s.lon),
      };
      break;
    }
    default:
      return assertNever(s, 'GeoSource');
  }
  return {
    ...describeGeoBBox(def.bbox),
    source,
    missing: def.missing,
    coordinateTypes:
      dataset === undefined
        ? []
        : (() => {
            const covered = geoSourceTypes(dataset, def.source);
            return dataset.nodeTypes
              .filter((t) => covered.has(t.id))
              .map((t) => ({ id: t.id, label: t.label }));
          })(),
    passTypes: def.passTypes ?? [],
  };
}
