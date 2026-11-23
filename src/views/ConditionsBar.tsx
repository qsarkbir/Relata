import { DEFAULT_FILTER_STATE, describeTimeFilter } from '../core/filter';
import { CALENDAR_DISPLAYS, isCalendarDisplay } from '../core/time';
import { selectFilterState, getFilterResult, displayStore } from '../state';
import { APPLIED_LIST_ID, FILTER_RULES_ID } from './filter/AppliedList';
import { TIME_SECTION_ID } from './filter/TimeControl';
import { timeBoundText } from './filter/timeText';
import { useData, useDisplay, useFilter, useT, useUi } from './hooks';
import { getNumberFormat } from './intl';
import { Chip } from './ui/Chip';
import { BuildControl } from './BuildControl';
import './conditions.css';

/**
 * 適用中の条件の行（フェーズ 2 の方針 §3.1）。中央の列の上に 1 行で、今効いている条件を示す。
 *
 * 表示件数とフィルタの数は、フィルタパネルと同じ `getFilterResult`（FR-FL-09 と同じ計算の結果）と
 * filterStore の現在の状態から読む。この部品は何も持たない（旧 Palladio の不具合の原因だった
 * 「表示用の別の状態」を作らない。filter-audit #2、#3）。入力の途中の値は出さない。
 * 射影・期間・暦は、その機能ができたときに足す（未実装の項目は出さない）。
 * @returns 条件の行。データが無いときは null
 */
export function ConditionsBar() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const dataset = useData((s) => s.dataset);
  const state = useFilter(selectFilterState);
  const setPanelCollapsed = useUi((s) => s.setPanelCollapsed);
  const calendar = useDisplay((s) => s.calendar);
  if (dataset === null) return null;
  const { counts } = getFilterResult(dataset, state);
  const nf = getNumberFormat(locale);
  const filterCount = state.filters.length;
  const openFilters = (targetId: string) => {
    // 【なぜ】畳まれていれば開く（開いていれば何もしない）。開いた後の描画を待ってから、該当箇所へ移る。
    setPanelCollapsed('filters', false);
    requestAnimationFrame(() => {
      const el = document.getElementById(targetId);
      // 折りたたんだ節（details）なら開き、見出し（summary）へ移る。閉じたままだと移った先が見えない。
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.querySelector('summary')?.focus();
        return;
      }
      el?.focus();
    });
  };
  const edgeRuleText = t('conditions.edgeRule', {
    value: t(
      state.edgeRule === 'both-ends' ? 'filter.edgeRule.bothEnds' : 'filter.edgeRule.eitherEnd',
    ),
  });
  // 既定は「表示しない」なので、既定と違うのは「表示する」のとき。その設定の名前をそのまま出す。
  const isolatedText = t('filter.showIsolated');
  const filtersText = t('conditions.filters', { count: nf.format(filterCount) });
  return (
    <section className="conditions-bar" aria-labelledby="conditions-title">
      <h2 id="conditions-title" className="conditions-title">
        {t('conditions.region')}
      </h2>
      <Chip>
        {t('filter.counts.nodes', {
          shown: nf.format(counts.nodes.shown),
          total: nf.format(counts.nodes.total),
        })}
      </Chip>
      <Chip>
        {t('filter.counts.edges', {
          shown: nf.format(counts.edges.shown),
          total: nf.format(counts.edges.total),
        })}
      </Chip>
      {filterCount > 0 ? (
        <Chip
          onClick={() => {
            openFilters(APPLIED_LIST_ID);
          }}
          description={t('conditions.filtersOpen')}
        >
          {filtersText}
        </Chip>
      ) : (
        <Chip>{filtersText}</Chip>
      )}
      {/* 【なぜ】既定と違うときだけ出す。既定のままの規則を並べると、行が長くなり、効いている条件が埋もれる。 */}
      {state.edgeRule !== DEFAULT_FILTER_STATE.edgeRule && (
        <Chip
          onClick={() => {
            openFilters(FILTER_RULES_ID);
          }}
          description={t('conditions.edgeRuleOpen')}
          title={edgeRuleText}
        >
          {edgeRuleText}
        </Chip>
      )}
      {state.showIsolated !== DEFAULT_FILTER_STATE.showIsolated && (
        <Chip
          onClick={() => {
            openFilters(FILTER_RULES_ID);
          }}
          description={t('conditions.isolatedOpen')}
          title={isolatedText}
        >
          {isolatedText}
        </Chip>
      )}
      {/* 時間フィルタの期間（適用中の値だけ。入力の途中の値は出さない）。表示の暦で書く。 */}
      {state.filters.map((f) => {
        if (f.kind !== 'time') return null;
        const d = describeTimeFilter(f, dataset, calendar);
        const text = t('conditions.time', {
          target: t(f.target === 'node' ? 'filter.target.node' : 'filter.target.edge'),
          range: `${timeBoundText(t, d)}${t('filter.time.matchWrap', {
            match: t(`filter.time.match.${d.match}`),
          })}`,
        });
        return (
          <Chip
            key={f.id}
            onClick={() => {
              openFilters(TIME_SECTION_ID);
            }}
            description={t('conditions.timeOpen')}
            title={text}
          >
            {text}
          </Chip>
        );
      })}
      {/* 構築（重み・自己ループ・射影）。実際に適用されている値だけを出し、押すと小さなパネルが開く。 */}
      <BuildControl />
      {/* 表示する暦（R-24）。軽い表示の変更なので、選んだらすぐ反映する。 */}
      <label className="rl-chip conditions-calendar" title={t('conditions.calendar.hint')}>
        <span>{t('conditions.calendar')}</span>
        <select
          value={calendar}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (isCalendarDisplay(v)) displayStore.getState().setCalendar(v);
          }}
        >
          {CALENDAR_DISPLAYS.map((c) => (
            <option key={c} value={c}>
              {t(`calendar.display.${c}`)}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
