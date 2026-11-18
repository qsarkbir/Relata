import { AboutDialog } from '../views/AboutDialog';
import { TaskPanel } from '../views/TaskPanel';
import { useData, useT, useUi } from '../views/hooks';
import { LOCALES, LOCALE_NAMES } from '../i18n';
import './app.css';

/**
 * アプリ全体の最上位コンポーネント。ヘッダ、主な領域、進行表示を並べる。
 *
 * 配置: 左に絞り込み（T1-18）、中央に主な表示（グラフ T1-19）、右に指標（T1-20）。
 * 文言は `src/i18n/` の辞書から取る（FR-UI-01）。
 *
 * @returns アプリの要素
 */
// 【TS】`.tsx` は JSX（HTML に似た記法）を書ける TypeScript のファイル。
//       戻り値の型は、TypeScript が JSX の中身から推論するので書かなくてよい。
export function App() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const setOpenDialog = useUi((s) => s.setOpenDialog);
  const dataset = useData((s) => s.dataset);

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <p className="tagline">{t('app.tagline')}</p>
        <div className="header-actions">
          <div role="group" aria-label={t('locale.label')} className="locale-switch">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={l === locale}
                onClick={() => {
                  setLocale(l);
                }}
              >
                {LOCALE_NAMES[l]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpenDialog('about');
            }}
          >
            {t('about.open')}
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="region-filters" aria-label={t('app.region.filters')}>
          <p className="placeholder">{t('app.region.filters.placeholder')}</p>
        </aside>
        <main className="region-main" aria-label={t('app.region.main')}>
          {dataset === null ? (
            <div className="empty">
              <h2>{t('app.empty.title')}</h2>
              <p>{t('app.empty.body')}</p>
            </div>
          ) : null}
        </main>
        <aside className="region-metrics" aria-label={t('app.region.metrics')}>
          <p className="placeholder">{t('app.region.metrics.placeholder')}</p>
        </aside>
      </div>
      <TaskPanel />
      <AboutDialog />
    </div>
  );
}
