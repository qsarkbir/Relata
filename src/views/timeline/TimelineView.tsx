import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  aggregateTimeline,
  describeTimeFilter,
  resolveTimelineSource,
  sameTimeSource,
  timelineSourceOptions,
} from '../../core/filter';
import type { FilterDef, TimeSource, TimelineBin } from '../../core/filter';
import {
  TIME_BIN_WIDTHS,
  binCalendarOf,
  binsDayRange,
  describeDayRange,
  jdnToParts,
} from '../../core/time';
import { getFilterResult, selectFilterState, timelineStore } from '../../state';
import { useData, useDisplay, useFilter, useT, useTimelineView } from '../hooks';
import type { MessageKey } from '../../i18n';
import { findFilters } from '../filter/activeFilters';
import { timeFilterId } from '../filter/filterIds';
import { datePartsText, renderingsText, timeBoundText } from '../filter/timeText';
import { sourceToValue, valueToSource } from '../filter/timeInput';
import { Field } from '../ui/Field';
import { InfoTip } from '../ui/InfoTip';
import { bandIndexes, binIndexAt, tickIndexes } from './timelineLayout';
import './timeline.css';

/** 描画の領域の余白（CSS ピクセル）。左は件数の目盛り、下は年の目盛りの分。 */
const MARGIN = { left: 40, right: 12, top: 8, bottom: 24 } as const;
/** 年の目盛りの文字の間の最小の距離（CSS ピクセル）。 */
const TICK_GAP = 72;

// 【TS】`interface` はオブジェクトの形を表す型。`readonly` を付けた項目は、作った後で代入できない
//       （状態は書き換えず、`setSel` で新しいオブジェクトに置き換える、という約束を型で守る）。
/** 選択中の範囲。ドラッグ中とキーボードの操作で共通。 */
interface Selection {
  /** 範囲の起点の区切りの番号。 */
  readonly anchor: number;
  /** 動かしている側の区切りの番号（キーボードのカーソルも兼ねる）。 */
  readonly cursor: number;
  /** ポインタで動かしている最中か。 */
  readonly dragging: boolean;
}

/**
 * 要素の大きさを測る。大きさが変わると更新する（下の段の高さを変える、ウィンドウを変えるなど）。
 *
 * 【なぜ】SVG の文字は拡大縮小すると歪むので、`viewBox` で縮めず、実際のピクセルの大きさで描き直す。
 *
 * @returns 測る要素に付ける ref と、測った大きさ
 */
// 【TS】`<T extends HTMLElement>` はジェネリクス。「T は HTMLElement の仲間なら何でもよい」という制約で、
//       呼ぶ側が `useElementSize<HTMLDivElement>()` と指定すると、ref の型も div 用になる。
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const read = (): void => {
      const { width, height } = el.getBoundingClientRect();
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, size };
}

/** {@link TimelineBars} の props。 */
interface BarsProps {
  readonly bins: readonly TimelineBin[];
  /** 区切りごとの吹き出し（`<title>`）の文。`bins` と同じ並び。 */
  readonly titles: readonly string[];
  /** 目盛りの文字。0 以上の区切りの番号 → 文字。`ticks` の番号だけ使う。 */
  readonly tickLabels: ReadonlyMap<number, string>;
  readonly barW: number;
  readonly plotW: number;
  readonly plotH: number;
  readonly maxTotal: number;
  readonly patternId: string;
}

// 【TS】`memo(関数)` は、props が前と同じ（各項目が `Object.is` で等しい）間は再描画を飛ばす React の部品。
//       ドラッグ中は選択の矩形だけが変わるので、数百本の棒を描き直さないように棒の層を分ける。
/**
 * 棒、軸、目盛りの層。ドラッグやカーソルの移動では変わらないので、`memo` で再描画を避ける。
 *
 * @param props - 区切り、吹き出しの文、目盛りの文字、大きさ
 * @returns SVG の `<g>`
 */
const TimelineBars = memo(function TimelineBars({
  bins,
  titles,
  tickLabels,
  barW,
  plotW,
  plotH,
  maxTotal,
  patternId,
}: BarsProps) {
  const yOf = (count: number): number => (count / maxTotal) * plotH;
  return (
    <g>
      {bins.map((b, i) => {
        const x = i * barW;
        const inner = Math.max(0, barW - (barW > 4 ? 1 : 0));
        const hContained = yOf(b.contained);
        const hCount = yOf(b.count);
        return (
          <g key={b.startYear}>
            <title>{titles[i]}</title>
            {b.total > b.count && (
              <rect
                className="tl-total"
                x={x}
                width={inner}
                y={plotH - yOf(b.total)}
                height={yOf(b.total)}
              />
            )}
            {b.count > b.contained && (
              <rect
                className="tl-bar-spanning"
                x={x}
                width={inner}
                y={plotH - hCount}
                height={hCount - hContained}
                fill={`url(#${patternId})`}
              />
            )}
            {b.contained > 0 && (
              <rect
                className="tl-bar-contained"
                x={x}
                width={inner}
                y={plotH - hContained}
                height={hContained}
              />
            )}
          </g>
        );
      })}
      <line className="tl-axis" x1={0} x2={plotW} y1={plotH} y2={plotH} />
      {[...tickLabels].map(([i, label]) => (
        <g key={i} transform={`translate(${String(i * barW)} ${String(plotH)})`}>
          <line className="tl-axis" y2={4} />
          <text className="tl-tick" y={16}>
            {label}
          </text>
        </g>
      ))}
      <text className="tl-tick tl-y" x={-6} y={4} textAnchor="end">
        {maxTotal}
      </text>
      <text className="tl-tick tl-y" x={-6} y={plotH} textAnchor="end">
        0
      </text>
    </g>
  );
});

/**
 * 年表（FR-TM-01、FR-TM-04、FR-TM-05、FR-FL-11、D-41、D-42）。
 *
 * 絞り込み後のノードかエッジを、日付の出どころと区切りの幅で数えた棒グラフ。数えるのは
 * `core/filter/timeline.ts` で、この部品は描画と操作だけを持つ。
 *
 * - 棒の中は、日付が区切りに収まる要素（塗りつぶし）と、幅が区切りをまたぐ要素（斜線）に分ける。
 *   絞り込みで除いた分は、点線の枠で背景に残す（範囲を選び直せるように）。色だけに頼らない。
 * - 年代のない要素の数は、軸の外に別に示す。絞り込みで除いた件数とは別の数。
 * - ドラッグ（またはキーボードで範囲を決めて Enter）で、離した時点で時間フィルタを足すか置き換える。
 *   適用中の範囲は FilterState から導き出し、年表に別の状態として持たない。Undo はフィルタの履歴で戻る。
 * - 設定（対象、出どころ、区切りの幅）は timelineStore に持ち、保存する。ドラッグ中の範囲は
 *   この部品の中だけ（保存しない一時的な状態）。
 *
 * @returns 年表の要素
 */
export function TimelineView() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const filters = useFilter(selectFilterState);
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  const settings = useTimelineView((s) => s.timeline);
  const display = useDisplay((s) => s.calendar);
  const calendar = binCalendarOf(display);
  const { target, width } = settings;
  const ids = useId();
  const hintId = `${ids}-hint`;
  const patternId = `tl-hatch-${ids.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const options = useMemo(
    () => (dataset === null ? [] : timelineSourceOptions(dataset, target)),
    [dataset, target],
  );
  const source = resolveTimelineSource(options, settings[target]);
  const filterResult = dataset === null ? null : getFilterResult(dataset, filters);
  const shownIds =
    filterResult === null
      ? undefined
      : target === 'node'
        ? filterResult.nodeIds
        : filterResult.edgeIds;
  // 【なぜ】絞り込み後の集合から毎回数え直す（差分で更新しない）。入力が同じ間は前の結果を使う。
  const result = useMemo(
    () =>
      dataset === null || source === undefined || shownIds === undefined
        ? null
        : aggregateTimeline(dataset, target, shownIds, source, calendar, width),
    [dataset, source, shownIds, target, calendar, width],
  );
  const bins = result?.bins;

  const { ref: chartRef, size } = useElementSize<HTMLDivElement>();
  const [sel, setSel] = useState<Selection | null>(null);
  // 【なぜ】選択の番号は「区切りの何番目か」なので、軸（先頭の年、幅、暦、区切りの数、対象）が変わると
  //   別の区切りを指してしまう。その時だけ選択を捨てる。`bins` の参照では比べない: 絞り込みや Enter での
  //   確定のたびに集計し直されて参照が変わるが、軸は変わらず、キーボードの選択を残したいため。
  //   描画の途中で前の値と比べて調整する（TimeControl と同じ書き方）。
  const axisKey =
    bins === undefined || bins.length === 0
      ? ''
      : `${target}|${calendar}|${String(width)}|${String(bins[0]?.startYear)}|${String(bins.length)}`;
  const [seenAxis, setSeenAxis] = useState(axisKey);
  if (seenAxis !== axisKey) {
    setSeenAxis(axisKey);
    if (sel !== null) setSel(null);
  }

  const patch = (change: Partial<typeof settings>) => {
    timelineStore.getState().patchTimeline(change);
  };

  // 適用中の時間フィルタ（この対象の 1 件目）。別に持たず FilterState から探す。
  const active = findFilters(filters.filters, 'time', (f) => f.target === target)[0];
  const activeSameSource =
    active !== undefined && source !== undefined && sameTimeSource(active.source, source);
  const band =
    activeSameSource && bins !== undefined ? bandIndexes(bins, active.from, active.to) : null;

  const sourceLabel = (s: TimeSource): string => {
    if (s.kind === 'span') return t('filter.time.source.span');
    const label = dataset?.schema.find((a) => a.key === s.attr && a.appliesTo === target)?.label;
    return t('filter.time.source.attr', { label: label ?? s.attr });
  };

  const n = bins?.length ?? 0;
  const plotW = Math.max(0, size.width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(0, size.height - MARGIN.top - MARGIN.bottom);
  const barW = n > 0 ? plotW / n : 0;
  const maxTotal = Math.max(1, result?.maxTotal ?? 1);

  const rangeText = (first: number, last: number): string => {
    const a = bins?.[first];
    const b = bins?.[last];
    if (a === undefined || b === undefined) return '';
    return renderingsText(
      t,
      describeDayRange(binsDayRange(calendar, a.startYear, b.startYear, width), display, 'year'),
    );
  };
  // 吹き出しと目盛りの文字は、区切りや言語、暦が変わったときだけ作り直す（棒の層を memo で守るため）。
  const titles = useMemo(
    () =>
      (bins ?? []).map((b) =>
        t('timeline.bin', {
          range: renderingsText(
            t,
            describeDayRange({ earliest: b.earliest, latest: b.latest }, display, 'year'),
          ),
          count: String(b.count),
          spanning: String(b.count - b.contained),
          excluded: String(b.total - b.count),
        }),
      ),
    [bins, t, display],
  );
  const ticks = bins === undefined ? [] : tickIndexes(n, plotW, TICK_GAP);
  const tickKey = ticks.join(',');
  const tickLabels = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of tickKey === '' ? [] : tickKey.split(',').map(Number)) {
      const b = bins?.[i];
      if (b !== undefined) m.set(i, datePartsText(t, jdnToParts(b.earliest, calendar, 'year')));
    }
    return m;
  }, [bins, tickKey, t, calendar]);

  // 範囲を時間フィルタにする（D-41）。適用中のものがあれば、その ID と「重なる／収まる」「欠損」を
  // 引き継いで置き換え、無ければ足す。FilterState に入るので、Undo で戻せる。
  const commit = (a: number, b: number): void => {
    if (bins === undefined || source === undefined) return;
    const first = bins[Math.min(a, b)];
    const last = bins[Math.max(a, b)];
    if (first === undefined || last === undefined) return;
    const range = binsDayRange(calendar, first.startYear, last.startYear, width);
    const def: Extract<FilterDef, { kind: 'time' }> = {
      id: active?.id ?? timeFilterId(target),
      kind: 'time',
      target,
      source,
      from: range.earliest,
      to: range.latest,
      match: active?.match ?? 'overlaps',
      missing: active?.missing ?? 'exclude',
    };
    add(def);
  };

  const indexAtEvent = (e: PointerEvent<SVGRectElement>): number => {
    const box = e.currentTarget.getBoundingClientRect();
    return binIndexAt(e.clientX - box.left, box.width, n);
  };
  const onPointerDown = (e: PointerEvent<SVGRectElement>) => {
    if (n === 0 || e.button !== 0) return;
    const i = indexAtEvent(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setSel({ anchor: i, cursor: i, dragging: true });
  };
  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    if (sel?.dragging !== true) return;
    const i = indexAtEvent(e);
    if (i !== sel.cursor) setSel({ ...sel, cursor: i });
  };
  const onPointerUp = (e: PointerEvent<SVGRectElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (sel?.dragging !== true) return;
    // 離した時点で反映する（D-41）。
    commit(sel.anchor, indexAtEvent(e));
    setSel(null);
  };
  const onPointerCancel = (e: PointerEvent<SVGRectElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setSel(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const cur = sel?.cursor ?? band?.first ?? 0;
    const move = (to: number) => {
      const next = Math.min(n - 1, Math.max(0, to));
      e.preventDefault();
      // Shift なしは起点も動かす（1 つの区切りを指す）。Shift 付きは起点を残して範囲を広げる。
      setSel({ anchor: e.shiftKey ? (sel?.anchor ?? cur) : next, cursor: next, dragging: false });
    };
    switch (e.key) {
      case 'ArrowLeft':
        move(sel === null ? cur : cur - 1);
        break;
      case 'ArrowRight':
        move(sel === null ? cur : cur + 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(n - 1);
        break;
      case 'Enter':
      case ' ':
        if (sel === null) break;
        e.preventDefault();
        commit(sel.anchor, sel.cursor);
        setSel({ anchor: sel.cursor, cursor: sel.cursor, dragging: false });
        break;
      case 'Escape':
        if (sel === null) break;
        e.preventDefault();
        setSel(sel.anchor === sel.cursor ? null : { ...sel, anchor: sel.cursor });
        break;
      default:
    }
  };

  const clampIndex = (i: number): number => Math.min(Math.max(0, i), Math.max(0, n - 1));
  const selFirst = sel === null ? 0 : clampIndex(Math.min(sel.anchor, sel.cursor));
  const selLast = sel === null ? 0 : clampIndex(Math.max(sel.anchor, sel.cursor));

  const activeDescription = (f: Extract<FilterDef, { kind: 'time' }>): string =>
    timeBoundText(t, describeTimeFilter(f, dataset ?? undefined, display));
  const status =
    sel === null
      ? active !== undefined && activeDescription(active) !== ''
        ? t('timeline.applied', { range: activeDescription(active) })
        : ''
      : selFirst === selLast
        ? `${t('timeline.cursor', { range: rangeText(selFirst, selFirst) })} — ${titles[selFirst] ?? ''}`
        : t('timeline.selection', { range: rangeText(selFirst, selLast) });
  const [announced, setAnnounced] = useState(status);
  if (sel?.dragging !== true && announced !== status) setAnnounced(status);

  // 【なぜ】`{ [target]: … }` の計算キーだと、TypeScript がキー名を `string` に広げて型検査が効かなくなる。
  //   対象ごとに分岐して、`node` と `edge` のどちらも `TimeSource | null` として検査させる。
  const setSource = (value: string) => {
    const next = valueToSource(value);
    patch(target === 'node' ? { node: next } : { edge: next });
  };
  const sourceValue = source === undefined ? '' : sourceToValue(source);

  const hasData = dataset !== null;
  // 日付がまったく無い（出どころの候補が無い）ときは、絞り込み後の全要素が年代なし（FR-TM-05）。
  const noDate = result?.noDate ?? (source === undefined ? (shownIds?.size ?? 0) : 0);
  let message: string | null = null;
  if (!hasData) message = t('timeline.noData');
  else if (source === undefined) message = t('timeline.noSource');
  else if (result?.tooManyBins === true) {
    const [from, to] = extentParts(result.extent);
    message = width === 100 ? t('timeline.tooManyWide', { from, to }) : t('timeline.tooMany');
  } else if (result !== null && result.bins.length === 0) message = t('timeline.noBins');

  // 【TS】関数の中の関数。`extent` が undefined のときは空の文字を返し、呼ぶ側は分岐しなくてよい。
  function extentParts(
    e: { readonly earliest: number; readonly latest: number } | undefined,
  ): [string, string] {
    if (e === undefined) return ['', ''];
    const one = (jdn: number): string =>
      renderingsText(t, describeDayRange({ earliest: jdn, latest: jdn }, display, 'year'));
    return [one(e.earliest), one(e.latest)];
  }

  const roleKey: MessageKey = 'timeline.chart.role';

  return (
    <div className="timeline-view">
      <div className="timeline-controls">
        <Field label={t('timeline.target')}>
          <select
            value={target}
            onChange={(e) => {
              patch({ target: e.currentTarget.value === 'edge' ? 'edge' : 'node' });
            }}
          >
            <option value="node">{t('filter.target.node')}</option>
            <option value="edge">{t('filter.target.edge')}</option>
          </select>
        </Field>
        {source !== undefined && (
          <Field label={t('timeline.source')}>
            <select
              dir="auto"
              value={sourceValue}
              onChange={(e) => {
                setSource(e.currentTarget.value);
              }}
            >
              {options.map((o) => (
                <option key={sourceToValue(o)} value={sourceToValue(o)}>
                  {sourceLabel(o)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('timeline.width')}>
          <select
            value={String(width)}
            onChange={(e) => {
              const w = TIME_BIN_WIDTHS.find((x) => String(x) === e.currentTarget.value);
              if (w !== undefined) patch({ width: w });
            }}
          >
            {TIME_BIN_WIDTHS.map((w) => (
              <option key={w} value={String(w)}>
                {t('timeline.width.option', { n: String(w) })}
              </option>
            ))}
          </select>
        </Field>
        <InfoTip topic={t('timeline.info.topic')}>
          <p>{t('timeline.chartHint')}</p>
          <p>{t('timeline.countNote')}</p>
          <p>{t('timeline.info.binCalendar')}</p>
          <p>{t('timeline.noDate.hint')}</p>
          <p>{t('timeline.inconsistent.hint')}</p>
        </InfoTip>
        {active !== undefined && (
          <button
            type="button"
            onClick={() => {
              remove(active.id);
            }}
          >
            {t('timeline.clearRange')}
          </button>
        )}
      </div>
      {message !== null && <p className="hint">{message}</p>}
      <div className="timeline-main">
        {/* 【なぜ】`role="application"`: 矢印キーなどをスクリーンリーダーの閲覧モードに奪われず、この部品に届ける。 */}
        <div
          ref={chartRef}
          className="timeline-chart"
          role="application"
          aria-roledescription={t(roleKey)}
          aria-label={t('timeline.chart')}
          aria-describedby={hintId}
          tabIndex={n > 0 ? 0 : -1}
          onKeyDown={onKeyDown}
          hidden={message !== null && n === 0 ? true : undefined}
        >
          {size.width > 0 && n > 0 && bins !== undefined && (
            <svg width={size.width} height={size.height} aria-hidden="true">
              <defs>
                <pattern
                  id={patternId}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" className="tl-hatch-bg" />
                  <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch-line" />
                </pattern>
              </defs>
              <g transform={`translate(${String(MARGIN.left)} ${String(MARGIN.top)})`}>
                {band !== null && (
                  <rect
                    className="tl-band"
                    x={band.first * barW}
                    width={(band.last - band.first + 1) * barW}
                    y={0}
                    height={plotH}
                  />
                )}
                <TimelineBars
                  bins={bins}
                  titles={titles}
                  tickLabels={tickLabels}
                  barW={barW}
                  plotW={plotW}
                  plotH={plotH}
                  maxTotal={maxTotal}
                  patternId={patternId}
                />
                {sel !== null && (
                  <rect
                    className="tl-selection"
                    x={selFirst * barW}
                    width={(selLast - selFirst + 1) * barW}
                    y={0}
                    height={plotH}
                  />
                )}
                {/* 描画の領域全体でポインタを受ける（棒のない場所でもドラッグを始められる）。 */}
                <rect
                  className="tl-hit"
                  x={0}
                  y={0}
                  width={plotW}
                  height={plotH}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
              </g>
            </svg>
          )}
        </div>
        {hasData && (
          <aside
            className="timeline-nodate"
            aria-label={t('timeline.noDate', { n: String(noDate) })}
          >
            <p className="timeline-nodate-count">
              <strong>{t('timeline.noDate', { n: String(noDate) })}</strong>
            </p>
            {result !== null && result.noDateTotal !== result.noDate && (
              <p className="hint">
                {t('timeline.noDate.total', { n: String(result.noDateTotal) })}
              </p>
            )}
            {result !== null && result.inconsistentTotal > 0 && (
              <p className="timeline-inconsistent">
                {t('timeline.inconsistent', { n: String(result.inconsistent) })}
              </p>
            )}
          </aside>
        )}
      </div>
      <p className="hint" id={hintId}>
        {t('timeline.chartHintShort')}
      </p>
      {/* 見える文は常に更新する。読み上げ用の文は、ドラッグ中は更新せず、離したとき（確定時）だけ更新する。 */}
      <p className="timeline-status" aria-hidden="true" dir="auto">
        <bdi>{status}</bdi>
      </p>
      <p className="visually-hidden" role="status" aria-live="polite" dir="auto">
        <bdi>{announced}</bdi>
      </p>
      <div className="timeline-legend hint" hidden={n === 0}>
        <span>
          <svg width="14" height="10" aria-hidden="true">
            <rect className="tl-bar-contained" width="14" height="10" />
          </svg>{' '}
          {t('timeline.legend.contained')}
        </span>
        <span>
          <svg width="14" height="10" aria-hidden="true">
            <rect className="tl-bar-spanning" width="14" height="10" fill={`url(#${patternId})`} />
          </svg>{' '}
          {t('timeline.legend.spanning')}
        </span>
        <span>
          <svg width="14" height="10" aria-hidden="true">
            <rect className="tl-total" x="0.5" y="0.5" width="13" height="9" />
          </svg>{' '}
          {t('timeline.legend.excluded')}
        </span>
        <span>
          {t(
            calendar === 'hijri'
              ? 'timeline.calendarNote.hijri'
              : 'timeline.calendarNote.gregorian',
          )}
        </span>
      </div>
      {active !== undefined && source !== undefined && !activeSameSource && (
        <p className="hint">{t('timeline.appliedOther')}</p>
      )}
    </div>
  );
}
