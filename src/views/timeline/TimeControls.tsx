import { useMemo } from 'react';
import {
  TIME_MODES,
  TIME_SPEEDS,
  TIME_WINDOW_YEARS,
  binIndexOfTime,
  describeDayRange,
  isTimeMode,
  isTimeSpeed,
  isTimeWindowYears,
} from '../../core/time';
import type { TimeMode } from '../../core/time';
import type { MessageKey } from '../../i18n';
import { getPlaybackAxis, getTimeAxis, selectFilterState, timeStore } from '../../state';
import { useData, useDisplay, useFilter, useT, useTime, useTimelineView } from '../hooks';
import { renderingsText } from '../filter/timeText';
import { timeStateText } from '../timeFade';
import { InfoTip } from '../ui/InfoTip';
import './timeline.css';

// 【TS】`satisfies Record<TimeMode, MessageKey>` は、方式（TimeMode）をすべて含むことを検査する。
//       方式を足して文言を書き忘れると、型エラーになる。
const MODE_LABEL = {
  cumulative: 'time.mode.cumulative',
  window: 'time.mode.window',
} as const satisfies Record<TimeMode, MessageKey>;

/**
 * 時間の再生の操作（FR-TM-02、FR-TM-03、D-38、R-17）。年表の付近に置く。
 *
 * 再生、一時停止、コマ送り（前後）、時刻のつまみ、速度、方式（累積／移動窓）、窓の幅、時刻の解除。
 * すべて `timeStore` の操作を呼ぶだけで、この部品は時計も写しも持たない（時計は `app/playbackClock.ts`）。
 * 再生は表示だけを変える（R-17）。時刻で絞り込むときは年表で範囲を選ぶことを、画面に書く。
 *
 * キーボード: すべて Tab で届くボタン、選択、つまみ（矢印キーで区切りを 1 つずつ）。再生中かどうかは
 * ボタンの名前（再生／一時停止）で伝え、時刻は文字でも出す（色だけに頼らない）。
 *
 * @returns 再生の操作の要素
 */
export function TimeControls() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const timeline = useTimelineView((s) => s.timeline);
  const display = useDisplay((s) => s.calendar);
  const at = useTime((s) => s.at);
  const mode = useTime((s) => s.mode);
  const windowYears = useTime((s) => s.windowYears);
  const speed = useTime((s) => s.speed);
  const playing = useTime((s) => s.playing);
  const filters = useFilter(selectFilterState);
  // 【なぜ】範囲を選んでいるときは、つまみとコマ送りもその範囲に限る（時計と同じ軸。FR-TM-02）。
  const axis = useMemo(
    () => (dataset === null ? null : getPlaybackAxis(dataset, timeline, display, filters)),
    [dataset, timeline, display, filters],
  );
  const restricted =
    axis !== null && dataset !== null && getTimeAxis(dataset, timeline, display) !== axis;
  const store = timeStore.getState();
  const disabled = axis === null;
  const text = timeStateText(t, display, { at, mode, windowYears, speed });
  const binIndex = axis === null || at === null ? -1 : binIndexOfTime(at, axis);

  return (
    <div className="time-controls" role="group" aria-label={t('time.controls')}>
      <div className="time-controls-row">
        <button type="button" className="time-play" disabled={disabled} onClick={store.toggle}>
          <span aria-hidden="true">{playing ? '⏸ ' : '▶ '}</span>
          {playing ? t('time.pause') : t('time.play')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            store.step(-1);
          }}
        >
          <span aria-hidden="true">◀ </span>
          {t('time.stepBack')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            store.step(1);
          }}
        >
          {t('time.stepForward')}
          <span aria-hidden="true"> ▶</span>
        </button>
        <label className="time-slider">
          <span>{t('time.slider')}</span>
          <input
            type="range"
            // 【なぜ】最小を -1 にし、時刻が未設定のときのつまみを -1（「未設定」）に置く。0 に置くと、
            //   先頭の区切りを選ぶ操作が「値が変わらない」ため効かない。矢印キーの右で先頭の区切りへ、
            //   左で未設定へ戻る。
            min={-1}
            max={Math.max(0, (axis?.bins.length ?? 1) - 1)}
            step={1}
            value={binIndex}
            disabled={disabled}
            aria-valuetext={text === '' ? t('time.none') : text}
            onChange={(e) => {
              const i = Number(e.currentTarget.value);
              if (i < 0) {
                store.clear();
                return;
              }
              const bin = axis?.bins[i];
              if (bin !== undefined) store.seek(bin.latest);
            }}
          />
        </label>
        <label className="time-inline">
          <span>{t('time.speed')}</span>
          <select
            value={String(speed)}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              if (isTimeSpeed(v)) store.setSpeed(v);
            }}
          >
            {TIME_SPEEDS.map((s) => (
              <option key={s} value={String(s)}>
                {t('time.speed.option', { n: String(s) })}
              </option>
            ))}
          </select>
        </label>
        <label className="time-inline">
          <span>{t('time.mode')}</span>
          <select
            value={mode}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (isTimeMode(v)) store.setMode(v);
            }}
          >
            {TIME_MODES.map((m) => (
              <option key={m} value={m}>
                {t(MODE_LABEL[m])}
              </option>
            ))}
          </select>
        </label>
        {mode === 'window' && (
          <label className="time-inline">
            <span>{t('time.window')}</span>
            <select
              value={String(windowYears)}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                if (isTimeWindowYears(v)) store.setWindowYears(v);
              }}
            >
              {TIME_WINDOW_YEARS.map((w) => (
                <option key={w} value={String(w)}>
                  {t('time.window.option', { n: String(w) })}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" disabled={at === null} onClick={store.clear}>
          {t('time.clear')}
        </button>
        <InfoTip topic={t('time.info.topic')}>
          <p>{t('time.note')}</p>
          <p>{t('time.note.range')}</p>
        </InfoTip>
      </div>
      {/* 【なぜ】見える 1 行に、時刻と「表示だけを変える」旨を置く（R-17）。詳しい説明は (i) の中。
          行を 1 つに抑えるのは、下の段の低い高さでも年表の棒グラフが見えるようにするため。 */}
      <p className="time-state" dir="auto">
        <strong data-testid="time-state">
          <bdi>{text === '' ? t('time.none') : text}</bdi>
        </strong>{' '}
        <span className="hint" data-testid="time-note">
          {axis === null
            ? t('time.noAxis')
            : restricted
              ? t('time.noteRestricted', {
                  range: renderingsText(
                    t,
                    describeDayRange({ earliest: axis.min, latest: axis.max }, display, 'year'),
                  ),
                })
              : t('time.noteShort')}
        </span>
      </p>
    </div>
  );
}
