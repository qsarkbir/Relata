import type { MessageKey } from '../i18n';
import type { ProjectionIssue } from '../core/graph';
import type { ProjectionStatus } from '../state';
import { useData, useT } from './hooks';

const ISSUE_NAMES: Record<ProjectionIssue['code'], MessageKey> = {
  unknownTarget: 'build.issue.unknownTarget',
  unknownVia: 'build.issue.unknownVia',
  sameType: 'build.issue.sameType',
};

/**
 * 射影の設定が使えない理由と、射影時の注意を文で示す（色だけで伝えない。NFR-07）。
 *
 * 【なぜ】設定が今のデータで無効（データを置き換えて型が無い、など）のとき、射影せずに射影前のグラフを
 * 出す。黙って図が変わらないと「射影が効かない」ように見えるので、理由を画面に出す。
 * @param props - 射影の状態（`getNetwork` の結果）
 * @returns 理由と注意。何も無ければ null
 */
export function ProjectionIssues({ status }: { readonly status: ProjectionStatus }) {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  if (status.kind === 'none' || dataset === null) return null;
  if (status.kind === 'invalid') {
    return (
      <ul className="build-issues" role="status">
        {status.issues.map((issue) => (
          <li key={issue.code}>
            {t(ISSUE_NAMES[issue.code], {
              type: dataset.nodeTypes.find((type) => type.id === issue.type)?.label ?? issue.type,
            })}
          </li>
        ))}
      </ul>
    );
  }
  if (status.warnings.length === 0) return null;
  return (
    <ul className="build-issues" role="status">
      {status.warnings.map((warning) => (
        <li key={warning.code}>{t('build.warning.directedAsUndirected')}</li>
      ))}
    </ul>
  );
}
