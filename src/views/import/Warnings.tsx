import { useT } from '../hooks';
import type { WizardWarning } from './model';
import { WARNING_NAMES } from './messages';
// 読めなかった確からしさの値を、io のメッセージ（「確からしさ「値」を読めません。…」）から取り出す。
// 【なぜ】WizardWarning は元の値を持たない。io の警告に項目を足さず、見出しの行に値を出すための小さな読み取り。
// 形が合わないとき（欠損記号と重なる場合の警告など）は出さない。値は右から左の文字もありうるので <bdi> で囲む。
function unreadableValue(warning: WizardWarning): string | undefined {
  if (warning.code !== 'invalid-certainty') return undefined;
  return /^確からしさ「(.*)」を読めません/su.exec(warning.message)?.[1];
}
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
            {unreadableValue(warning) !== undefined && (
              <>
                {' '}
                <bdi>「{unreadableValue(warning)}」</bdi>
              </>
            )}
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
