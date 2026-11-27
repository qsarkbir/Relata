import type { ReactNode } from 'react';
import { assertNever } from '../core/util/assertNever';
import { useProjectNotice, useT } from './hooks';
import { describeFailure, describeWarning } from './projectDescribe';
import type { ProjectNotice as Notice } from './projectNotice';
import { tRich } from './richText';

/**
 * 一時的な知らせが、すぐ読ませたい失敗（role=alert）か、状況の通知（role=status）か。
 *
 * @param n - 知らせ
 * @returns 失敗なら true
 */
function isAlert(n: Notice): boolean {
  switch (n.kind) {
    case 'autosave-cleared':
    case 'other-tab':
    case 'tile-keys-stripped':
    case 'tile-url-dropped':
      return false;
    case 'failed':
    case 'read-error':
    case 'autosave-unavailable':
    case 'autosave-quota':
    case 'autosave-serialize':
    case 'autosave-stopped':
    case 'autosave-clear-failed':
      return true;
    default:
      return assertNever(n);
  }
}

/**
 * 保存と読み込みの結果の知らせ。
 *
 * 構造（D-33 (3)）: ①一時的な知らせ（保存の失敗、消したこと、別のタブなど）と、②読み込みの結果
 * （題名と警告の一覧。データと組）は別の欄。①が出ても②は消えない。②は閉じても「警告 n 件」のボタンで開き直せる。
 * 【なぜ】読み上げの入れ物（role="alert"、role="status"）は常に置き、中身だけ差し替える。
 * 後から入れた入れ物は、読み上げられないことがあるため。色だけで区別しないよう、見出しの文言と枠線も使う。
 *
 * @returns 知らせの領域
 */
export function ProjectNotice() {
  const t = useT();
  const notice = useProjectNotice((s) => s.notice);
  const report = useProjectNotice((s) => s.report);
  const reportOpen = useProjectNotice((s) => s.reportOpen);
  const dismiss = useProjectNotice((s) => s.dismiss);
  const setReportOpen = useProjectNotice((s) => s.setReportOpen);

  // 閉じた後、フォーカスが消える（閉じたボタンが無くなる）ので、メニューの先頭のボタンへ戻す。
  const focusMenu = (): void => {
    document.querySelector<HTMLElement>('.project-menu button')?.focus();
  };

  const alertNotice = notice !== null && isAlert(notice) ? notice : null;
  const statusNotice = notice !== null && !isAlert(notice) ? notice : null;

  const body = (n: Notice): ReactNode => {
    switch (n.kind) {
      case 'failed':
        return (
          <>
            <strong>
              {t(n.source === 'file' ? 'project.failed.file' : 'project.failed.autosave')}
            </strong>
            <br />
            {describeFailure(n.failure, t)}
          </>
        );
      case 'read-error':
        return (
          <>
            <strong>{t('project.failed.read')}</strong>
            <br />
            <bdi>{n.message}</bdi>
          </>
        );
      case 'autosave-unavailable':
        return t('project.autosave.unavailable');
      case 'autosave-quota':
        return t('project.autosave.quota');
      case 'autosave-serialize':
        return t('project.autosave.serialize');
      case 'autosave-stopped':
        return t('project.autosave.stopped');
      case 'autosave-clear-failed':
        return t('project.autosave.clearFailed');
      case 'autosave-cleared':
        return t('project.autosave.cleared');
      case 'other-tab':
        return t('project.otherTab');
      case 'tile-keys-stripped':
        return t('project.tileKeysStripped', { names: n.names.join(', ') });
      case 'tile-url-dropped':
        return t('project.tileUrlDropped');
      default:
        return assertNever(n);
    }
  };

  return (
    <div className="project-notice-slot">
      <div role="alert" className="project-alert-slot">
        {alertNotice !== null && (
          <section className="project-notice project-notice-error">
            <p>{body(alertNotice)}</p>
            <button
              type="button"
              onClick={() => {
                dismiss();
                focusMenu();
              }}
            >
              {t('project.dismiss')}
            </button>
          </section>
        )}
      </div>
      <div role="status" className="project-status-slot">
        {statusNotice !== null && (
          <section className="project-notice">
            <p>{body(statusNotice)}</p>
            <button
              type="button"
              onClick={() => {
                dismiss();
                focusMenu();
              }}
            >
              {t('project.dismiss')}
            </button>
          </section>
        )}
        {report !== null && reportOpen && (
          <section className="project-notice" aria-label={t('project.warnings.label')}>
            <p>
              <strong>
                {tRich(
                  t,
                  report.source === 'file' ? 'project.loaded.file' : 'project.loaded.autosave',
                  {},
                  { title: report.title },
                )}
              </strong>{' '}
              {report.warnings.length > 0 &&
                t('project.warnings.count', { n: report.warnings.length })}
            </p>
            {report.warnings.length > 0 && (
              <ul className="project-warnings">
                {report.warnings.map((w, i) => (
                  // 【なぜ】警告には安定した ID が無いので、位置を key にする（一覧は読み込みごとに作り直す）。
                  <li key={i}>{describeWarning(w, t)}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => {
                setReportOpen(false);
                focusMenu();
              }}
            >
              {t('project.dismiss')}
            </button>
          </section>
        )}
        {report !== null && !reportOpen && report.warnings.length > 0 && (
          <button
            type="button"
            className="project-report-reopen"
            onClick={() => {
              setReportOpen(true);
            }}
          >
            {t('project.warnings.show', { n: report.warnings.length })}
          </button>
        )}
      </div>
    </div>
  );
}
