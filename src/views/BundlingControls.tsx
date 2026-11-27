/** グラフの「束ねる」の操作: 状態の文言（進行、取り消し、確認）と、設定の節（FR-VG-13、14）。 */
import { BUNDLING_VIEW_STYLES } from '../core/project';
import type { BundlingViewSettings, BundlingViewStyle } from '../core/project';
import { BUNDLING_EDGE_WARNING_LIMIT, bundlingController } from '../state';
import type { BundlingView } from '../state';
import { useT, useUi } from './hooks';
import { getNumberFormat } from './intl';
import { formatPercent } from './percent';
import { Field } from './ui/Field';

/** {@link BundlingStatus} の props。 */
interface StatusProps {
  readonly view: BundlingView;
  readonly enabled: boolean;
}

/**
 * 束ねる計算の状態の文言。計算中は進行と取り消し、確認待ちは「始める／やめる」を出す。
 * 計算中・中止・失敗のときも、図は束ねない図のまま（文言でそう伝える）。
 *
 * @param props - 計算の状態と、有効か
 * @returns 状態の表示。無効のときは null
 */
export function BundlingStatus({ view, enabled }: StatusProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  if (!enabled) return null;
  switch (view.phase) {
    case 'idle':
      return <p className="rl-status">{t('graph.bundle.status.idle')}</p>;
    case 'waiting':
      return (
        <p className="rl-status" role="status">
          {t('graph.bundle.status.waiting')}
        </p>
      );
    case 'running':
      return (
        <div className="graph-bundle-status" role="status">
          <p className="rl-status" data-kind="loading">
            {t('graph.bundle.status.running', { percent: formatPercent(locale, view.progress) })}
          </p>
          <progress
            max={1}
            value={view.progress}
            aria-label={t('graph.bundle.status.running', {
              percent: formatPercent(locale, view.progress),
            })}
          />
          <button
            type="button"
            onClick={() => {
              bundlingController.cancel();
            }}
          >
            {t('graph.bundle.cancel')}
          </button>
        </div>
      );
    case 'confirm':
      return (
        <div className="graph-bundle-status" role="alert">
          <p className="rl-status" data-kind="error">
            {t('graph.bundle.status.confirm', {
              count: nf.format(view.edgeCount),
              limit: nf.format(BUNDLING_EDGE_WARNING_LIMIT),
            })}
          </p>
          <button
            type="button"
            onClick={() => {
              bundlingController.confirm();
            }}
          >
            {t('graph.bundle.start')}
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              bundlingController.cancel();
            }}
          >
            {t('graph.bundle.cancel')}
          </button>
        </div>
      );
    case 'ready':
      return (
        <p className="rl-status" role="status">
          {t('graph.bundle.status.ready', { count: nf.format(view.edgeCount) })}
        </p>
      );
    case 'cancelled':
      return (
        <p className="rl-status" role="status">
          {t('graph.bundle.status.cancelled')}
        </p>
      );
    case 'error':
      return (
        <p className="rl-status" data-kind="error" role="alert">
          {t('graph.bundle.status.error', { reason: view.error ?? '' })}
        </p>
      );
    default: {
      const never: never = view.phase;
      return never;
    }
  }
}

/** {@link BundlingControls} の props。 */
interface ControlsProps {
  readonly settings: BundlingViewSettings;
  readonly view: BundlingView;
  readonly onChange: (next: BundlingViewSettings) => void;
}

/**
 * 「束ねる」の節の中身。強さ、描き方、「束ね直す」。
 *
 * 【なぜ】強さの変更は自動では計算しない（重いため）。「束ね直す」で始める（phase3-plan §4.1）。描き方の切り替えは
 * 計算し直さず、すぐ図に反映される。
 *
 * @param props - 設定、計算の状態、変更の通知
 * @returns 節の中身
 */
export function BundlingControls({ settings, view, onChange }: ControlsProps) {
  const t = useT();
  const stale = view.result !== null && view.result.strength !== settings.strength;
  return (
    <div className="graph-bundle-controls">
      <p className="rl-section-note">{t('graph.bundle.toggleHint')}</p>
      <Field label={t('graph.bundle.strength')}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.strength}
          disabled={!settings.enabled}
          onChange={(e) => {
            const value = e.currentTarget.valueAsNumber;
            if (Number.isFinite(value) && value >= 0 && value <= 1)
              onChange({ ...settings, strength: value });
          }}
        />
      </Field>
      <Field label={t('graph.bundle.style')}>
        <select
          aria-label={t('graph.bundle.style')}
          value={settings.style}
          onChange={(e) => {
            const value = BUNDLING_VIEW_STYLES.find((s) => s === e.currentTarget.value);
            if (value !== undefined)
              onChange({ ...settings, style: value satisfies BundlingViewStyle });
          }}
        >
          <option value="bands">{t('graph.bundle.style.bands')}</option>
          <option value="overlay">{t('graph.bundle.style.overlay')}</option>
        </select>
      </Field>
      <button
        type="button"
        disabled={!settings.enabled || view.phase === 'running'}
        onClick={() => {
          bundlingController.rebundle();
        }}
      >
        {t('graph.bundle.rebundle')}
      </button>
      {stale && <p className="rl-status">{t('graph.bundle.stale')}</p>}
      <BundlingStatus view={view} enabled={settings.enabled} />
    </div>
  );
}
