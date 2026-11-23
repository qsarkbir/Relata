import { useMemo } from 'react';
import { getTimeAxis, timeStore } from '../state';
import { useData, useDisplay, useT, useTime, useTimelineView } from './hooks';
import { useTimeStateText } from './timeFade';
import { Chip } from './ui/Chip';

/**
 * 適用中の条件の行にある、再生中の時刻と小さな再生・一時停止の操作（FR-TM-02、方針 §3.1）。
 *
 * 再生は表示だけを変える（R-17）ので、件数やフィルタの数は変わらない。時刻は文字で出す
 * （色だけに頼らない）。ボタンの名前は「再生」と「一時停止」を切り替える（`aria-pressed` は使わない。
 * 名前と押した状態の両方を切り替えると、読み上げが矛盾するため）。
 *
 * 【なぜ】時刻は再生中に毎コマ変わる。この行の他の項目（件数、フィルタ、暦）を巻き込まないよう、
 * 時刻に依る部分だけを小さな部品にして、ここで購読する（NFR-05）。
 *
 * @returns 時刻の項目と再生の操作。データが無いときは null
 */
export function TimeChips() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const timeline = useTimelineView((s) => s.timeline);
  const calendar = useDisplay((s) => s.calendar);
  const playing = useTime((s) => s.playing);
  const timeText = useTimeStateText();
  // 再生できるのは、年表の軸（日付）があるときだけ。軸は年表と同じもの（結果は覚えてある）。
  const canPlay = useMemo(
    () => dataset !== null && getTimeAxis(dataset, timeline, calendar) !== null,
    [dataset, timeline, calendar],
  );
  return (
    <>
      {timeText !== '' && (
        <Chip
          title={t('time.conditions.hint')}
          onRemove={{ label: t('time.clear'), run: timeStore.getState().clear }}
        >
          {t('time.conditions', { time: timeText })}
        </Chip>
      )}
      {canPlay && (
        <button
          type="button"
          className="rl-chip conditions-play"
          onClick={timeStore.getState().toggle}
        >
          <span aria-hidden="true">{playing ? '⏸ ' : '▶ '}</span>
          <span className="rl-chip-text">{playing ? t('time.pause') : t('time.play')}</span>
        </button>
      )}
    </>
  );
}
