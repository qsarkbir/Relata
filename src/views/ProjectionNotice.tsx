import type { ProjectionIssue } from '../core/graph';
import { assertNever } from '../core/util/assertNever';
import type { ProjectionStatus } from '../state';
import { useData, useT } from './hooks';
import { tRich } from './richText';

/** {@link ProjectionIssues} の props。 */
interface ProjectionIssuesProps {
  /** 射影の状態（`getNetwork` の結果）。 */
  readonly status: ProjectionStatus;
}

/**
 * 射影の設定が使えない理由と、射影時の注意を文で示す（色だけで伝えない。NFR-07）。
 *
 * 【なぜ】設定が今のデータで無効（データを置き換えて型が無い、大きすぎる、など）のとき、射影せずに
 * 射影前のグラフを出す。黙って図が変わらないと「射影が効かない」ように見えるので、理由を画面に出す。
 * 型の名前やノードのラベルは利用者の値なので、`<bdi>` で隔離して文に入れる（NFR-09）。
 * @param props - 射影の状態
 * @returns 理由と注意。何も無ければ null
 */
export function ProjectionIssues({ status }: ProjectionIssuesProps) {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  if (dataset === null) return null;
  const typeName = (id: string) => dataset.nodeTypes.find((type) => type.id === id)?.label ?? id;
  const nodeName = (id: string) => dataset.nodes.find((node) => node.id === id)?.label ?? id;
  // 【TS】`switch` の最後の `assertNever` で、`ProjectionIssue` の `code` を足したときの書き忘れを型で検出する。
  const issueText = (issue: ProjectionIssue) => {
    switch (issue.code) {
      case 'unknownTarget':
        return tRich(t, 'build.issue.unknownTarget', {}, { type: typeName(issue.type) });
      case 'unknownVia':
        return tRich(t, 'build.issue.unknownVia', {}, { type: typeName(issue.type) });
      case 'sameType':
        return tRich(t, 'build.issue.sameType', {}, { type: typeName(issue.type) });
      case 'tooLarge':
        return (
          <>
            <span className="build-issue-line">
              {t('build.issue.tooLarge', {
                pairs: String(issue.pairs),
                limit: String(issue.limit),
              })}
            </span>
            <span className="build-issue-line">
              {t('build.issue.tooLargeHubs')}{' '}
              {issue.hubs.map((hub, index) => (
                <span key={hub.id}>
                  {index > 0 && ' / '}
                  {tRich(
                    t,
                    'build.issue.hub',
                    { count: String(hub.degree) },
                    { label: nodeName(hub.id) },
                  )}
                </span>
              ))}
            </span>
            <span className="build-issue-line">{t('build.issue.tooLargeHint')}</span>
          </>
        );
      default:
        return assertNever(issue);
    }
  };
  switch (status.kind) {
    case 'none':
      return null;
    case 'invalid':
      return (
        <ul className="build-issues" role="status">
          {status.issues.map((issue) => (
            <li key={issue.code}>{issueText(issue)}</li>
          ))}
        </ul>
      );
    case 'applied':
      if (status.warnings.length === 0) return null;
      return (
        <ul className="build-issues" role="status">
          {status.warnings.map((warning) => (
            <li key={warning.code}>{t('build.warning.directedAsUndirected')}</li>
          ))}
        </ul>
      );
    default:
      return assertNever(status);
  }
}
