/**
 * 「欠損の表示」の設定（FR-VG-12）。どの属性が欠損している要素を破線にするか。
 * `view.graph` に任意の項目として保存する（D-24。無ければ既定値）。
 */
import { isPlainObject } from '../model';

/** 欠損を破線で示す属性のキー。ノードとエッジで別に持つ。 */
export interface MissingDisplay {
  readonly nodeAttrs: readonly string[];
  readonly edgeAttrs: readonly string[];
}

/** 既定は、どの属性も破線にしない。 */
export const DEFAULT_MISSING_DISPLAY: MissingDisplay = { nodeAttrs: [], edgeAttrs: [] };

function keys(x: unknown): readonly string[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  for (const k of x) {
    // 【なぜ】壊れた要素だけ捨てる。1 つの属性名のために、プロジェクト全体を開けなくしない。
    if (typeof k === 'string' && k !== '' && k.length <= 1000) seen.add(k);
    if (seen.size >= 10000) break;
  }
  return [...seen];
}

/**
 * JSON から「欠損の表示」の設定を作る。項目が無い、または壊れていれば既定で補う。
 * v0.1 のファイルや、この項目の無いファイルでも開けるようにするため。
 *
 * @param x - 任意の入力
 * @returns 設定
 */
export function parseMissingDisplay(x: unknown): MissingDisplay {
  if (!isPlainObject(x)) return DEFAULT_MISSING_DISPLAY;
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  return { nodeAttrs: keys(get('nodeAttrs')), edgeAttrs: keys(get('edgeAttrs')) };
}
