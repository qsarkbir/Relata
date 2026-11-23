/**
 * 時間の再生の保存可能な設定（FR-TM-02、D-44）の読み込み。
 *
 * 時刻、方式、窓の幅、速度だけを `view.time` に保存する。再生中かどうかは保存しない
 * （開いた直後に勝手に動き出さないため）。
 */
import type { ParseResult } from '../model';
import { isPlainObject } from '../model';
import { DEFAULT_TIME_SETTINGS, isTimeMode, isTimeSpeed, isTimeWindowYears } from '../time';
import type { TimeSettings } from '../time';

/** 時刻として受け入れる JDN の大きさの上限（約 27 万年。壊れた値で年表の計算が暴れないように）。 */
const MAX_ABS_DAY = 100_000_000;

/**
 * JSON から時間の設定を組み立てる。無い項目と、読めない項目は既定で補う。
 *
 * 【なぜ】任意の項目なので、1 つの壊れた値のために、データを含むファイル全体を開けなくしない（D-24）。
 * 時刻は「大きさが妥当な整数」だけを受け入れ、小数、文字列、NaN などは「時刻なし」（null）にする。
 * オブジェクトでないときだけ失敗にする（呼ぶ側が警告にして既定へ戻す）。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた箇所
 */
export function parseTimeSettings(x: unknown): ParseResult<TimeSettings> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '時間の設定が不正です' };
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const at = get('at');
  const mode = get('mode');
  const windowYears = get('windowYears');
  const speed = get('speed');
  return {
    ok: true,
    value: {
      at:
        typeof at === 'number' && Number.isSafeInteger(at) && Math.abs(at) <= MAX_ABS_DAY
          ? at
          : null,
      mode: isTimeMode(mode) ? mode : DEFAULT_TIME_SETTINGS.mode,
      windowYears: isTimeWindowYears(windowYears) ? windowYears : DEFAULT_TIME_SETTINGS.windowYears,
      speed: isTimeSpeed(speed) ? speed : DEFAULT_TIME_SETTINGS.speed,
    },
  };
}
