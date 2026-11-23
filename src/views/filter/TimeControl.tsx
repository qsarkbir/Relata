import { useId, useMemo, useState } from 'react';
import { dateAttributes, timeDataExtent } from '../../core/filter';
import type { FilterDef, Target } from '../../core/filter';
import type { MissingPolicy, TimeMatch } from '../../core/filter';
import type { CalendarId, Dataset } from '../../core/model';
import { describeDayRange, inputCalendarOf } from '../../core/time';
import { useDisplay, useFilter, useT } from '../hooks';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { Field } from '../ui/Field';
import { findFilters } from './activeFilters';
import { DuplicateNotice } from './DuplicateNotice';
import { timeFilterId } from './filterIds';
import { renderingsText } from './timeText';
import { formatTimeInput, resolveTimeInput, sourceToValue, valueToSource } from './timeInput';
import type { TimeInputError } from './timeInput';

/** 左のパネルの「時間」の節の要素の ID。「適用中の条件」の行から、ここへ移る。 */
export const TIME_SECTION_ID = 'filter-time';

// 適用中の端を欄の文字にする。開いた端（undefined）は空欄。
function endText(jdn: number | undefined, cal: CalendarId, side: 'start' | 'end'): string {
  return jdn === undefined ? '' : formatTimeInput(jdn, cal, side);
}

/** {@link TimeControl} の入力。 */
interface TimeControlProps {
  readonly dataset: Dataset;
  /** `FilterState.filters` そのもの。適用中の時間フィルタはここから探す（別に持たない）。 */
  readonly filters: readonly FilterDef[];
}

/** 出どころの選択肢 1 件。 */
interface SourceOption {
  readonly value: string;
  readonly label: string;
}

/**
 * 左のパネルの「時間」の節（FR-FL-03、FR-TM-09、D-35）。
 *
 * 対象（ノード／エッジ）ごとに、日付の出どころ（要素の期間、または日付の属性）、開始と終了、
 * 重なる／収まる、欠損の扱いを選んで時間で絞り込む。
 *
 * - 開始と終了の文字は入力の途中の値を持つので、この 2 つだけ「適用」ボタンか Enter で反映する（§4.1）。
 *   適用前の値は欄の中だけにあり、適用中の条件の行や一覧には出ない。
 * - 出どころ、重なる／収まる、欠損の扱いは選ぶだけなので、適用中なら即時に反映する。
 * - 適用中の値は FilterState から読み、欄には表示の暦で出す（暦を切り替えると欄の文字も変わる）。
 *
 * 【なぜ】日付の読み取りと範囲の判定は core の関数（`parseTimeFilterInput` と `timeDataExtent`）に任せ、
 * この部品は欄の状態と表示だけを持つ。
 *
 * @param props - データセットと現在のフィルタ
 * @returns 節の要素
 */
export function TimeControl({ dataset, filters }: TimeControlProps) {
  const t = useT();
  const display = useDisplay((s) => s.calendar);
  const inputCal = inputCalendarOf(display);
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  const errorId = useId();
  const dirtyId = useId();
  const hintId = useId();

  const firstTime = findFilters(filters, 'time')[0];
  const [target, setTarget] = useState<Target>(firstTime?.target ?? 'node');
  const found = findFilters(filters, 'time', (f) => f.target === target);
  const active = found[0];

  const [sourceChoice, setSourceChoice] = useState<string | null>(null);
  const [start, setStart] = useState(() => endText(active?.from, inputCal, 'start'));
  const [end, setEnd] = useState(() => endText(active?.to, inputCal, 'end'));
  // 【なぜ】適用中の条件が無いときの「重なる／収まる」と「欠損の扱い」は、この欄の中だけの下書き。
  //   FilterState には入れず、「適用」で初めてフィルタに入る（適用前の値を条件の行や一覧に出さないため）。
  const [match, setMatch] = useState<TimeMatch>(active?.match ?? 'overlaps');
  const [missing, setMissing] = useState<MissingPolicy>(active?.missing ?? 'exclude');
  const [error, setError] = useState<TimeInputError | null>(null);

  // 【なぜ】適用中のフィルタ（解除、Undo、読み込みで変わる）に欄を合わせる。effect ではなく、描画中に
  //   前の値と比べて調整する（RangeControl と同じ。React 公式の「前の props から state を調整する」書き方）。
  //   端の値が変わっていない項目は触らない（入力の途中の文字を消さないため）。
  const [prev, setPrev] = useState({ active, target, inputCal });
  if (prev.active !== active || prev.target !== target || prev.inputCal !== inputCal) {
    setPrev({ active, target, inputCal });
    const targetChanged = prev.target !== target;
    const calChanged = prev.inputCal !== inputCal;
    if (active === undefined) {
      // 解除や Undo で無くなったとき、または対象を替えたときは、欄を空に戻す。
      // 適用中のものが元から無く暦だけが変わったときは、入力の途中の文字を残す。
      if (targetChanged || prev.active !== undefined) {
        setStart('');
        setEnd('');
        setMatch('overlaps');
        setMissing('exclude');
        setSourceChoice(null);
        setError(null);
      }
    } else {
      if (targetChanged || calChanged || prev.active?.from !== active.from) {
        setStart(endText(active.from, inputCal, 'start'));
      }
      if (targetChanged || calChanged || prev.active?.to !== active.to) {
        setEnd(endText(active.to, inputCal, 'end'));
      }
      setMatch(active.match);
      setMissing(active.missing);
      setSourceChoice(sourceToValue(active.source));
      if (
        targetChanged ||
        calChanged ||
        prev.active?.from !== active.from ||
        prev.active?.to !== active.to
      ) {
        setError(null);
      }
    }
  }

  // 出どころの候補。要素の期間は、その対象に期間のある要素があるときだけ。日付の属性は schema から。
  const hasSpan = useMemo(
    () => timeDataExtent(dataset, target, { kind: 'span' }) !== undefined,
    [dataset, target],
  );
  const options: SourceOption[] = [];
  if (hasSpan || active?.source.kind === 'span') {
    options.push({ value: 'span', label: t('filter.time.source.span') });
  }
  for (const a of dateAttributes(dataset, target)) {
    options.push({
      value: sourceToValue({ kind: 'attr', attr: a.key }),
      label: t('filter.time.source.attr', { label: a.label }),
    });
  }
  // 適用中の出どころが候補に無い（属性が消えた、日付でないなど）ときも、選択欄が嘘をつかないよう載せる。
  const activeValue = active === undefined ? undefined : sourceToValue(active.source);
  if (activeValue !== undefined && !options.some((o) => o.value === activeValue)) {
    options.push({
      value: activeValue,
      label:
        active?.source.kind === 'attr'
          ? t('filter.time.source.attr', { label: active.source.attr })
          : t('filter.time.source.span'),
    });
  }
  const sourceValue =
    sourceChoice !== null && options.some((o) => o.value === sourceChoice)
      ? sourceChoice
      : options[0]?.value;
  const source = sourceValue === undefined ? undefined : valueToSource(sourceValue);
  const extent = useMemo(
    () =>
      sourceValue === undefined
        ? undefined
        : timeDataExtent(dataset, target, valueToSource(sourceValue)),
    [dataset, target, sourceValue],
  );

  const dirty =
    active === undefined
      ? start.trim() !== '' || end.trim() !== ''
      : start !== endText(active.from, inputCal, 'start') ||
        end !== endText(active.to, inputCal, 'end');

  const submit = (): void => {
    if (source === undefined) return;
    const outcome = resolveTimeInput(start, end, inputCal, active !== undefined);
    switch (outcome.kind) {
      case 'clear':
        if (active !== undefined) remove(active.id);
        return;
      case 'error':
        setError(outcome.error);
        return;
      case 'apply':
        setError(null);
        // 空の側を埋めた値を欄に戻し、適用中の値と欄が一致した状態にする。
        setStart(endText(outcome.from, inputCal, 'start'));
        setEnd(endText(outcome.to, inputCal, 'end'));
        add({
          // 【なぜ】適用中のものがあれば、その ID を使って置き換える（別の ID で入ったフィルタも 1 つのまま）。
          id: active?.id ?? timeFilterId(target),
          kind: 'time',
          target,
          source,
          // 【なぜ】空の側は省く（開いた端）。データの範囲で埋めると、出どころを替えたときに前の範囲が残る。
          ...(outcome.from === undefined ? {} : { from: outcome.from }),
          ...(outcome.to === undefined ? {} : { to: outcome.to }),
          match,
          missing,
        });
        return;
      default: {
        const never: never = outcome;
        return never;
      }
    }
  };

  const errorText = error === null ? null : errorMessage(t, error);
  const describedBy =
    [hintId, error === null ? null : errorId, dirty ? dirtyId : null]
      .filter((x) => x !== null)
      .join(' ') || undefined;
  const invalid = (field: 'start' | 'end'): boolean =>
    error !== null && (error.field === undefined || error.field === field);
  const extentText =
    extent === undefined
      ? undefined
      : renderingsText(
          t,
          describeDayRange({ earliest: extent.min, latest: extent.max }, display, 'year'),
        );

  return (
    <CollapsibleSection title={t('filter.time.title')} id={TIME_SECTION_ID} defaultOpen>
      <form
        className="time-control"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('filter.time.target')}>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.currentTarget.value === 'edge' ? 'edge' : 'node');
            }}
          >
            <option value="node">{t('filter.target.node')}</option>
            <option value="edge">{t('filter.target.edge')}</option>
          </select>
        </Field>
        <DuplicateNotice count={found.length - 1} />
        {source === undefined ? (
          <p className="hint">{t('filter.time.noSource')}</p>
        ) : (
          <>
            <Field label={t('filter.time.source')}>
              <select
                value={sourceValue}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setSourceChoice(value);
                  if (active !== undefined) add({ ...active, source: valueToSource(value) });
                }}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {extentText !== undefined && (
              <p className="hint">{t('filter.time.extent', { range: extentText })}</p>
            )}
            <div className="time-fields">
              <Field label={t('filter.time.start')}>
                <input
                  type="text"
                  dir="auto"
                  value={start}
                  aria-invalid={invalid('start')}
                  aria-describedby={describedBy}
                  onChange={(e) => {
                    setStart(e.currentTarget.value);
                    setError(null);
                  }}
                />
              </Field>
              <Field label={t('filter.time.end')}>
                <input
                  type="text"
                  dir="auto"
                  value={end}
                  aria-invalid={invalid('end')}
                  aria-describedby={describedBy}
                  onChange={(e) => {
                    setEnd(e.currentTarget.value);
                    setError(null);
                  }}
                />
              </Field>
            </div>
            <p id={hintId} className="hint">
              {t('filter.time.inputHint', {
                calendar: t(`filter.time.inputCalendar.${inputCal}`),
              })}
            </p>
            <Field label={t('filter.time.match')}>
              <select
                value={match}
                onChange={(e) => {
                  const next: TimeMatch =
                    e.currentTarget.value === 'within' ? 'within' : 'overlaps';
                  setMatch(next);
                  if (active !== undefined) add({ ...active, match: next });
                }}
              >
                <option value="overlaps">{t('filter.time.match.overlaps')}</option>
                <option value="within">{t('filter.time.match.within')}</option>
              </select>
            </Field>
            <Field label={t('filter.time.missing')}>
              <select
                value={missing}
                onChange={(e) => {
                  const next: MissingPolicy =
                    e.currentTarget.value === 'include' ? 'include' : 'exclude';
                  setMissing(next);
                  if (active !== undefined) add({ ...active, missing: next });
                }}
              >
                <option value="exclude">{t('filter.range.missing.exclude')}</option>
                <option value="include">{t('filter.range.missing.include')}</option>
              </select>
            </Field>
            <button type="submit">{t('filter.time.apply')}</button>
            {/* 色だけで伝えない: 文字で「未適用」と示し、入力欄から aria-describedby で結ぶ。 */}
            {dirty && (
              <p id={dirtyId} className="hint">
                {t('filter.unapplied')}
              </p>
            )}
            {errorText !== null && (
              <p id={errorId} role="alert" className="error">
                {errorText}
              </p>
            )}
          </>
        )}
      </form>
    </CollapsibleSection>
  );
}

// 入力のエラーを、どちらの欄かを添えた文にする。
function errorMessage(t: ReturnType<typeof useT>, e: TimeInputError): string {
  const message = t(`filter.time.error.${e.code}`);
  if (e.field === undefined) return message;
  return t('filter.time.errorField', {
    field: t(e.field === 'start' ? 'filter.time.start' : 'filter.time.end'),
    message,
  });
}
