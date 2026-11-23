/**
 * 年表の保存可能な設定（FR-TM-01、D-35、D-42、R-23）。
 *
 * 日付の出どころと区切りの幅だけを持つ。ドラッグ中の範囲、カーソルの位置などの一時的な状態は
 * 保存しない。T2-04 の「時期ごとの欠損率」も、同じ設定を読んで年表と同じ区切りで数える。
 */
import type { ParseResult } from '../model';
import { isPlainObject } from '../model';
import type { TimeSource } from '../filter';
import { DEFAULT_TIME_BIN_WIDTH, isTimeBinWidth } from '../time';
import type { TimeBinWidth } from '../time';

/** 年表の設定。 */
export interface TimelineSettings {
  /** 年表が数える対象。 */
  readonly target: 'node' | 'edge';
  /** 区切りの幅（年）。 */
  readonly width: TimeBinWidth;
  /**
   * ノードを数えるときの日付の出どころ。null は「まだ選んでいない」で、データから決める
   * （要素の期間があればそれ、なければ最初の日付の属性）。
   * 【なぜ】null と選んだ値を区別する。データを読み替えたときに、前のデータの属性名を引きずらないため。
   */
  readonly node: TimeSource | null;
  /** エッジを数えるときの日付の出どころ。 */
  readonly edge: TimeSource | null;
}

/** 未設定のときの年表の設定。 */
export const DEFAULT_TIMELINE: TimelineSettings = {
  target: 'node',
  width: DEFAULT_TIME_BIN_WIDTH,
  node: null,
  edge: null,
};

// 【TS】`unknown` を受けて、型ガードで絞ってから使う。読めない値は null（既定）にする。
function parseSource(x: unknown): TimeSource | null {
  if (!isPlainObject(x)) return null;
  if (x.kind === 'span') return { kind: 'span' };
  if (x.kind === 'attr' && typeof x.attr === 'string' && x.attr !== '' && x.attr.length <= 1000)
    return { kind: 'attr', attr: x.attr };
  return null;
}

/**
 * JSON から年表の設定を組み立てる。無い項目と、読めない項目は既定で補う。
 *
 * 【なぜ】任意の項目なので、1 つの壊れた値のために、データを含むファイル全体を開けなくしない（D-24）。
 * オブジェクトでないときだけ失敗にする（呼ぶ側が警告にして既定へ戻す）。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた箇所
 */
export function parseTimeline(x: unknown): ParseResult<TimelineSettings> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '年表の設定が不正です' };
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const width = get('width');
  return {
    ok: true,
    value: {
      target: get('target') === 'edge' ? 'edge' : 'node',
      width: isTimeBinWidth(width) ? width : DEFAULT_TIMELINE.width,
      node: parseSource(get('node')),
      edge: parseSource(get('edge')),
    },
  };
}
