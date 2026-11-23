/**
 * 時間の再生の状態と、その更新の関数（FR-TM-02、FR-TM-03、D-38、R-17）。
 *
 * 再生は「表示だけ」を変える。ここにあるのは、時刻（JDN の整数）、方式、窓の幅、速度、再生中かどうかと、
 * それを進める純粋な関数だけで、フィルタ、件数、指標には触れない。時計（`requestAnimationFrame`）は
 * `src/app/` の 1 か所に置き、そこから `tickTime` を呼ぶ（設計書 §9.2、D-17）。
 *
 * 【なぜ】時刻の範囲と 1 コマの幅は、年表の軸と区切りに合わせる。年表のカーソルとグラフの薄い表示が
 * 同じ区切りの上で動き、コマ送りは「次の区切りの末日」へ進む。区切りは選んだ暦の年の整数倍
 * （西暦なら 1500〜1509 年、ヒジュラ暦なら 900〜909 AH。`bins.ts`）なので、暦の違いも吸収される。
 *
 * 【歴史の事情】速度と窓の幅は「年」で指定する。ヒジュラ暦の 1 年は約 354 日で西暦より約 11 日短いので、
 * 日数への換算は区切りを数える暦の平均の年の長さ（{@link meanYearDays}）で行う。
 */
import type { CalendarId, DayNumber } from '../model';
import type { DayRange } from './calendars';

// 【TS】`as const` で配列を読み取り専用のリテラルの組にし、`(typeof X)[number]` で和集合の型にする（bins.ts と同じ書き方）。
/** 表示の方式の一覧。累積は「時刻より後」を、移動窓は「窓の外」を薄くする（D-38）。 */
export const TIME_MODES = ['cumulative', 'window'] as const;
/** 表示の方式。 */
export type TimeMode = (typeof TIME_MODES)[number];

/** 再生の速度（1 秒に進む年数）の一覧。 */
export const TIME_SPEEDS = [1, 5, 10, 25, 50, 100] as const;
/** 再生の速度（年/秒）。 */
export type TimeSpeed = (typeof TIME_SPEEDS)[number];

/** 移動窓の幅（年）の一覧。 */
export const TIME_WINDOW_YEARS = [1, 5, 10, 25, 50, 100] as const;
/** 移動窓の幅（年）。 */
export type TimeWindowYears = (typeof TIME_WINDOW_YEARS)[number];

/**
 * 保存する時間の設定（`view.time`）。再生中かどうかは含まない（保存しない一時的な状態）。
 */
export interface TimeSettings {
  /**
   * 現在の時刻（JDN の整数）。null は「時刻を決めていない」で、グラフは何も薄くしない。
   * 【なぜ】既定で薄くすると、再生を使わない利用者の図が変わってしまう。null を「再生の前」の状態にする。
   */
  readonly at: DayNumber | null;
  readonly mode: TimeMode;
  readonly windowYears: TimeWindowYears;
  readonly speed: TimeSpeed;
}

/** 時間の状態（保存する設定 + 再生中か）。 */
export interface TimeState extends TimeSettings {
  readonly playing: boolean;
}

/** 未設定のときの時間の設定。 */
export const DEFAULT_TIME_SETTINGS: TimeSettings = {
  at: null,
  mode: 'cumulative',
  windowYears: 10,
  speed: 10,
};

/**
 * 値が表示の方式かを判定する型ガード。
 *
 * @param v - 判定する値（保存ファイルから読んだ値など）
 * @returns 方式なら true
 */
export function isTimeMode(v: unknown): v is TimeMode {
  return TIME_MODES.some((m) => m === v);
}

/**
 * 値が再生の速度の選択肢かを判定する型ガード。
 *
 * @param v - 判定する値
 * @returns 選択肢なら true
 */
export function isTimeSpeed(v: unknown): v is TimeSpeed {
  return TIME_SPEEDS.some((s) => s === v);
}

/**
 * 値が移動窓の幅の選択肢かを判定する型ガード。
 *
 * @param v - 判定する値
 * @returns 選択肢なら true
 */
export function isTimeWindowYears(v: unknown): v is TimeWindowYears {
  return TIME_WINDOW_YEARS.some((w) => w === v);
}

/**
 * 保存する設定が既定と同じ内容かを返す（既定のままなら保存しない。D-24）。
 *
 * @param s - 時間の設定
 * @returns 既定と同じなら true
 */
export function isDefaultTimeSettings(s: TimeSettings): boolean {
  return (
    s.at === DEFAULT_TIME_SETTINGS.at &&
    s.mode === DEFAULT_TIME_SETTINGS.mode &&
    s.windowYears === DEFAULT_TIME_SETTINGS.windowYears &&
    s.speed === DEFAULT_TIME_SETTINGS.speed
  );
}

/**
 * 時刻の動く範囲と、コマ送りの区切り。年表の軸（区切りの並び）から作る。
 */
export interface TimeAxis {
  /** 区切りを数える暦（年の長さの換算に使う）。 */
  readonly calendar: CalendarId;
  /** 切れ目なく並んだ区切り（先頭が最も古い）。1 つ以上。 */
  readonly bins: readonly DayRange[];
  /** 時刻の最小（先頭の区切りの初日）。 */
  readonly min: DayNumber;
  /** 時刻の最大（末尾の区切りの末日）。 */
  readonly max: DayNumber;
}

/**
 * 年表の区切りから、時刻の軸を作る。
 *
 * @param calendar - 区切りを数える暦
 * @param bins - 区切りの日の幅（古い順。年表の `TimelineBin` でも渡せる）
 * @returns 軸。区切りが無ければ null（再生できない）
 */
export function makeTimeAxis(calendar: CalendarId, bins: readonly DayRange[]): TimeAxis | null {
  const first = bins[0];
  const last = bins[bins.length - 1];
  if (first === undefined || last === undefined) return null;
  // 【なぜ】TimelineBin など、余計な項目を持つ値が渡されても軸の中身が膨らまないよう、2 つの日だけ写す。
  return {
    calendar,
    bins: bins.map((b) => ({ earliest: b.earliest, latest: b.latest })),
    min: first.earliest,
    max: last.latest,
  };
}

/**
 * 暦の平均の年の長さ（日）。速度と窓の幅を日数にするために使う。
 *
 * 西暦は 365.2425 日（400 年に 97 回の閏年）、ヒジュラ暦は 30 年周期で 11 回の閏年を置く
 * 表のヒジュラ暦なので 10631 / 30 日（約 354.37 日）。
 *
 * @param calendar - 暦
 * @returns 平均の年の長さ
 */
export function meanYearDays(calendar: CalendarId): number {
  return calendar === 'hijri' ? 10631 / 30 : 365.2425;
}

/**
 * 時刻を軸の範囲に収め、整数にする。
 *
 * @param at - 時刻
 * @param axis - 軸
 * @returns 範囲内の整数
 */
export function clampTime(at: number, axis: TimeAxis): DayNumber {
  return Math.min(axis.max, Math.max(axis.min, Math.round(at)));
}

/**
 * 時刻を軸の上の位置へ移す（年表のカーソルや、つまみの操作）。再生は止めない。
 *
 * @param state - 今の状態
 * @param at - 新しい時刻
 * @param axis - 軸
 * @returns 新しい状態
 */
export function seekTime(state: TimeState, at: number, axis: TimeAxis): TimeState {
  return { ...state, at: clampTime(at, axis) };
}

/**
 * 再生を始める。時刻が無い、または終わりに着いているときは、先頭から始める。
 *
 * @param state - 今の状態
 * @param axis - 軸。null（年表を描けない）なら何もしない
 * @returns 新しい状態
 */
export function startPlayback(state: TimeState, axis: TimeAxis | null): TimeState {
  if (axis === null) return state;
  const restart = state.at === null || state.at >= axis.max;
  return {
    ...state,
    at: restart ? axis.min : clampTime(state.at, axis),
    playing: true,
  };
}

/**
 * 再生を止める（時刻は残す）。
 *
 * @param state - 今の状態
 * @returns 新しい状態
 */
export function pausePlayback(state: TimeState): TimeState {
  return state.playing ? { ...state, playing: false } : state;
}

/**
 * 時刻を解除する（グラフの薄い表示をやめる）。再生も止まる。
 *
 * @param state - 今の状態
 * @returns 新しい状態
 */
export function clearTime(state: TimeState): TimeState {
  return state.at === null && !state.playing ? state : { ...state, at: null, playing: false };
}

/**
 * 経過した時間だけ時刻を進める。終わりに着いたら、そこで止まる（繰り返さない）。
 *
 * 1 回に 1 日以上は進める。速度が遅くコマの間隔が短いとき、整数に丸めて 0 日になり、止まって見えるのを避ける。
 *
 * @param state - 今の状態
 * @param dtMs - 前の呼び出しからの経過時間（ミリ秒）。0 以下や有限でない値は無視する
 * @param axis - 軸。null なら何もしない
 * @returns 新しい状態
 */
export function tickTime(state: TimeState, dtMs: number, axis: TimeAxis | null): TimeState {
  if (!state.playing || axis === null || !(dtMs > 0) || !Number.isFinite(dtMs)) return state;
  const start = state.at ?? axis.min;
  const days = Math.max(1, Math.round((dtMs / 1000) * state.speed * meanYearDays(axis.calendar)));
  const next = start + days;
  if (next >= axis.max) return { ...state, at: axis.max, playing: false };
  return { ...state, at: next };
}

/**
 * 1 コマ（区切り 1 つ）ぶん前後へ動かす。再生中なら止める（手で動かす操作を優先する）。
 *
 * 進む先は、今の時刻より後で最も近い区切りの末日。戻る先は、今の時刻より前で最も近い区切りの末日。
 * 時刻が無いときは、進むなら先頭の区切りの末日、戻るなら先頭の区切りの末日から始める。
 * 端では動かない。
 *
 * @param state - 今の状態
 * @param direction - 1 は次、-1 は前
 * @param axis - 軸。null なら何もしない
 * @returns 新しい状態
 */
export function stepTime(state: TimeState, direction: 1 | -1, axis: TimeAxis | null): TimeState {
  if (axis === null) return state;
  const ends = axis.bins.map((b) => b.latest);
  const first = ends[0] ?? axis.max;
  let at: number;
  if (state.at === null) {
    at = first;
  } else if (direction === 1) {
    const cur = state.at;
    at = ends.find((e) => e > cur) ?? axis.max;
  } else {
    const cur = state.at;
    // 【TS】ES2022 には `findLast` が無いので、後ろから探す。
    at = first;
    for (const e of ends) if (e < cur) at = e;
  }
  return { ...state, at: clampTime(at, axis), playing: false };
}

/**
 * 時刻が入る区切りの番号を返す（つまみの位置に使う）。
 *
 * @param at - 時刻
 * @param axis - 軸
 * @returns 0 以上の番号。先頭より前なら 0、末尾より後なら最後
 */
export function binIndexOfTime(at: number, axis: TimeAxis): number {
  let index = 0;
  axis.bins.forEach((b, i) => {
    if (b.earliest <= at) index = i;
  });
  return index;
}

/**
 * 表示の方式を変える。
 *
 * @param state - 今の状態
 * @param mode - 新しい方式
 * @returns 新しい状態
 */
export function setTimeMode(state: TimeState, mode: TimeMode): TimeState {
  return state.mode === mode ? state : { ...state, mode };
}

/**
 * 再生の速度を変える。再生中でも続けて動く。
 *
 * @param state - 今の状態
 * @param speed - 新しい速度（年/秒）
 * @returns 新しい状態
 */
export function setTimeSpeed(state: TimeState, speed: TimeSpeed): TimeState {
  return state.speed === speed ? state : { ...state, speed };
}

/**
 * 移動窓の幅を変える。
 *
 * @param state - 今の状態
 * @param windowYears - 新しい幅（年）
 * @returns 新しい状態
 */
export function setTimeWindowYears(state: TimeState, windowYears: TimeWindowYears): TimeState {
  return state.windowYears === windowYears ? state : { ...state, windowYears };
}

/**
 * 薄くしない（見せる）日の範囲。両端を含む。
 */
export interface TimeWindow {
  /** 範囲の始まり。累積では -∞（時刻より前はすべて見せる）。 */
  readonly from: number;
  /** 範囲の終わり（現在の時刻）。 */
  readonly to: number;
}

/**
 * 今の状態で「見せる」日の範囲を返す。
 *
 * 累積は (-∞, 時刻]。移動窓は [時刻 - 窓の幅 + 1 日, 時刻]（窓の幅は平均の年の長さで日数にする）。
 *
 * @param state - 今の状態
 * @param calendar - 年の長さの換算に使う暦（軸の暦）
 * @returns 範囲。時刻が無ければ null（何も薄くしない）
 */
export function timeWindowOf(
  state: Pick<TimeSettings, 'at' | 'mode' | 'windowYears'>,
  calendar: CalendarId,
): TimeWindow | null {
  if (state.at === null) return null;
  if (state.mode === 'cumulative') return { from: Number.NEGATIVE_INFINITY, to: state.at };
  const days = Math.max(1, Math.round(state.windowYears * meanYearDays(calendar)));
  return { from: state.at - days + 1, to: state.at };
}
