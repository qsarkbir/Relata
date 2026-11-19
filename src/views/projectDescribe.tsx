import type { ReactNode } from 'react';
import { assertNever } from '../core/util/assertNever';
import type { ProjectWarning } from '../io/project';
import type { useT } from './hooks';
import type { ProjectFailure } from './projectNotice';
import { tRich } from './richText';

// 【TS】`typeof useT` は関数 useT の型、`ReturnType<…>` はその戻り値の型。翻訳の関数の型を、
//       useT の定義から導く（定義を変えても、ここは自動で追随する）。
type T = ReturnType<typeof useT>;

/**
 * 警告 1 件を、人が読める文にする。利用者の値（ID、path）は `<bdi>` で隔離する。
 *
 * @param w - 読み込みの警告
 * @param t - 翻訳の関数
 * @returns 文
 */
export function describeWarning(w: ProjectWarning, t: T): ReactNode {
  switch (w.source) {
    case 'dataset': {
      const owner = w.issue.owner;
      return tRich(
        t,
        'project.warning.dataset',
        { code: w.issue.code },
        { owner: `${owner.entity}:${String(owner.id)}` },
      );
    }
    case 'filter':
      return tRich(
        t,
        'project.warning.filter',
        { kind: w.issue.kind },
        { id: String(w.issue.filterId) },
      );
    case 'project':
      return tRich(t, 'project.warning.unknownField', {}, { path: w.issue.path });
    default:
      return assertNever(w);
  }
}

/**
 * 失敗を、種類ごとの文にする。版が分からないときは、版を出さない文にする。
 *
 * @param f - 失敗
 * @param t - 翻訳の関数
 * @returns 文
 */
export function describeFailure(f: ProjectFailure, t: T): ReactNode {
  switch (f.kind) {
    case 'not-json':
      return t('project.failure.notJson');
    case 'not-relata':
      return t('project.failure.notRelata');
    case 'newer-version':
      return f.fileVersion === undefined
        ? t('project.failure.newerVersionUnknown')
        : t('project.failure.newerVersion', { version: f.fileVersion });
    case 'missing-migration':
    case 'migration-failed':
      return f.fileVersion === undefined
        ? t('project.failure.migrationUnknown')
        : t('project.failure.migration', { version: f.fileVersion });
    case 'broken':
      return tRich(t, 'project.failure.broken', {}, { path: f.path });
    default:
      return assertNever(f.kind);
  }
}
