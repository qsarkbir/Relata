import { timeWindowOf } from '../../core/time';
import type { CalendarId } from '../../core/model';
import { useTime } from '../hooks';
import { dayBoundary } from './timelineLayout';

/** {@link TimeCursor} の props。 */
interface CursorProps {
  /** 年表の区切り（古い順、切れ目なし）。 */
  readonly bins: readonly { readonly earliest: number; readonly latest: number }[];
  /** 区切り 1 つの幅（px）。 */
  readonly barW: number;
  /** 描画の領域の高さ（px）。 */
  readonly plotH: number;
  /** 区切りを数える暦（移動窓の日数への換算に使う）。 */
  readonly calendar: CalendarId;
}

/**
 * 年表の上の、再生の時刻のカーソルと移動窓の帯（FR-TM-02、FR-TM-03）。SVG の `<g>` を返す。
 *
 * 時刻は timeStore の値をそのまま読む（年表は時計も写しも持たない）ので、グラフと連動する。
 * カーソルは実線と上の三角で示し、色だけに頼らない。位置は、区切りの割合で求める（日数の違いを
 * ピクセルに持ち込まない）。カーソルは「その日の終わり」、窓の帯は「窓の最初の日の始まり」から
 * 「その日の終わり」まで。
 *
 * 【なぜ】時刻は再生中に毎コマ変わる。年表全体（集計、棒、選択）を巻き込まないよう、この部品だけが購読する。
 *
 * @param props - 区切り、大きさ、暦
 * @returns カーソル。時刻が無ければ null
 */
export function TimeCursor({ bins, barW, plotH, calendar }: CursorProps) {
  const at = useTime((s) => s.at);
  const mode = useTime((s) => s.mode);
  const windowYears = useTime((s) => s.windowYears);
  const win = bins.length === 0 ? null : timeWindowOf({ at, mode, windowYears }, calendar);
  if (win === null) return null;
  const cursor = dayBoundary(bins, win.to + 1) * barW;
  const windowFrom = mode === 'window' ? dayBoundary(bins, win.from) * barW : null;
  return (
    <g data-testid="time-cursor" pointerEvents="none">
      {windowFrom !== null && (
        <rect
          className="tl-time-window"
          x={windowFrom}
          width={Math.max(0, cursor - windowFrom)}
          y={0}
          height={plotH}
        />
      )}
      <line className="tl-time-cursor" x1={cursor} x2={cursor} y1={0} y2={plotH} />
      <path
        className="tl-time-head"
        d={`M${String(cursor - 5)} 0 L${String(cursor + 5)} 0 L${String(cursor)} 8 Z`}
      />
    </g>
  );
}
