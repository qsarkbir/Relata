import { useT } from '../hooks';
import type { WizardWarning } from './model';
import { WARNING_NAMES } from './messages';
/**
 * 問題のあるレコード番号を、情報を切り捨てず一覧にする。
 * @param props - 警告
 * @returns 警告一覧
 */
export function Warnings({ warnings }: { readonly warnings: readonly WizardWarning[] }) {
  const t = useT();
  return (
    <div className="import-warning-list">
      <ul>
        {warnings.map((warning, index) => (
          <li key={index}>
            <strong>{t(warning.severity === 'error' ? 'import.error' : 'import.warning')}</strong>{' '}
            {t(
              warning.table === 'node'
                ? 'import.table.node'
                : warning.table === 'edge'
                  ? 'import.table.edge'
                  : 'import.table.single',
            )}{' '}
            {warning.row === undefined
              ? t('import.wholeFile')
              : t('import.row', { row: String(warning.row) })}
            {warning.column === undefined ? null : (
              <>
                {' '}
                / <bdi>{warning.column}</bdi>
              </>
            )}
            : {t(WARNING_NAMES[warning.code] ?? 'import.warning.unknown')}
            <details>
              <summary>{t('import.details')}</summary>
              <bdi>{warning.message}</bdi>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
