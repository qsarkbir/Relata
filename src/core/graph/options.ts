/**
 * グラフの構築の選択肢（FR-GR-01、FR-GR-02、D-22）と、外から読む `parseGraphOptions`。
 */
import { isPlainObject, type ParseResult } from '../model';

/**
 * 重みの選び方。
 *
 * - `'count'`: まとめた元のエッジの件数
 * - `'weight'`: `GraphEdge.weight` の合計（既定）
 * - `{ attr }`: エッジの数値属性 `attr` の合計
 */
// 【TS】文字列リテラルとオブジェクトの共用体。`typeof w === 'string'` で絞り込める。
export type WeightSource = 'count' | 'weight' | { readonly attr: string };

/** グラフの構築の選択肢。 */
export interface GraphOptions {
  readonly weight: WeightSource;
  /** 自己ループ（始点と終点が同じエッジ）を含めるか（FR-GR-02）。 */
  readonly selfLoops: boolean;
}

/** 既定の選択肢。重みは `GraphEdge.weight` の合計、自己ループは含める。 */
export const DEFAULT_GRAPH_OPTIONS: GraphOptions = { weight: 'weight', selfLoops: true };

// 自分自身の項目だけを読む（constructor などの継承した項目を読まない）。
function get(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

/**
 * 外から来た値を GraphOptions に組み立て直す（プロジェクトファイルの読み込みで使う）。
 *
 * 【なぜ】無い項目は既定値で補う（D-24）。あるのに型が違えば失敗にする。
 * 余分な項目は落とす。入力は書き換えず、例外は投げない。
 *
 * @param x - JSON.parse の結果など、中身が分からない値
 * @returns 成功なら選択肢、失敗なら壊れた箇所と理由
 */
export function parseGraphOptions(x: unknown): ParseResult<GraphOptions> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: 'オブジェクトが必要です' };

  const w = get(x, 'weight');
  let weight: WeightSource = DEFAULT_GRAPH_OPTIONS.weight;
  if (w !== undefined) {
    if (w === 'count' || w === 'weight') {
      weight = w;
    } else if (isPlainObject(w)) {
      const attr = get(w, 'attr');
      if (typeof attr !== 'string' || attr.length === 0) {
        return { ok: false, path: 'weight.attr', reason: '空でない文字列が必要です' };
      }
      weight = { attr };
    } else {
      return {
        ok: false,
        path: 'weight',
        reason: "'count'、'weight'、{ attr } のどれかが必要です",
      };
    }
  }

  const s = get(x, 'selfLoops');
  if (s !== undefined && typeof s !== 'boolean') {
    return { ok: false, path: 'selfLoops', reason: '真偽値が必要です' };
  }
  return { ok: true, value: { weight, selfLoops: s ?? DEFAULT_GRAPH_OPTIONS.selfLoops } };
}
