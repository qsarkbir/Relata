/**
 * 表ビューと下の段の保存可能な設定（FR-TB-01、FR-UI-02、D-44）。
 *
 * ページ番号は保存しない（一時的な表示の位置であり、データが変われば意味を失うため。D-44）。
 */
import type { ParseResult } from '../model';
import { isPlainObject } from '../model';

/** 表の対象。ノード表かエッジ表か。 */
export type TableTarget = 'node' | 'edge';

/** 並べ替えの向き。 */
export type SortDirection = 'asc' | 'desc';

/** 並べ替えの指定。 */
export interface TableSort {
  /**
   * 列のキー。組み込みの列は `id`、`label` など、データの属性は `attr:` を前に付けたキー。
   * 【なぜ】属性名は利用者の列名なので、組み込みの列名（`id` など）と衝突しない接頭辞を付ける。
   */
  readonly column: string;
  readonly direction: SortDirection;
}

/** ノード表またはエッジ表 1 つ分の設定。 */
export interface TableTargetSettings {
  /** 並べ替え。null なら並べ替えない（データの順）。 */
  readonly sort: TableSort | null;
  /**
   * 表示する列のキーを、表示する順に並べたもの。null なら既定（データから決まる）。
   * 【なぜ】null と空配列を区別する。null は「利用者はまだ選んでいない」、空配列は「すべて外した」。
   */
  readonly columns: readonly string[] | null;
}

/** 表ビューの設定。 */
export interface TableViewSettings {
  readonly target: TableTarget;
  readonly node: TableTargetSettings;
  readonly edge: TableTargetSettings;
}

// 【TS】`as const` は配列を読み取り専用の「リテラルの組」にする。`(typeof X)[number]` はその要素の型
//       （ここでは `'table'`）。タブを足すと、型も自動で広がる。
/** 開けるタブの一覧。年表と欠損は、それぞれのタスクで足す（空のタブを置かない）。 */
export const WORKSPACE_TABS = ['table'] as const;

/** 下の段のタブの ID。 */
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/** 下の段の高さの下限と上限（CSS ピクセル）。 */
export const WORKSPACE_HEIGHT_MIN = 120;
export const WORKSPACE_HEIGHT_MAX = 800;

/** 下の段の設定（開いているタブ、開閉、高さ）。 */
export interface WorkspaceSettings {
  readonly tab: WorkspaceTab;
  readonly open: boolean;
  /** 段の中身の高さ（CSS ピクセル）。 */
  readonly height: number;
}

const EMPTY_TARGET: TableTargetSettings = { sort: null, columns: null };

/** 未設定のときの表ビューの設定。 */
export const DEFAULT_TABLE_VIEW: TableViewSettings = {
  target: 'node',
  node: EMPTY_TARGET,
  edge: EMPTY_TARGET,
};

/** 未設定のときの下の段の設定。閉じておく（図を広く使う。表は見出しのタブから開く）。 */
export const DEFAULT_WORKSPACE: WorkspaceSettings = { tab: 'table', open: false, height: 300 };

/**
 * 下の段の高さを許す範囲に収める。
 *
 * @param height - 高さ
 * @returns 下限と上限の間の整数
 */
export function clampWorkspaceHeight(height: number): number {
  return Math.min(WORKSPACE_HEIGHT_MAX, Math.max(WORKSPACE_HEIGHT_MIN, Math.round(height)));
}

// 【TS】`unknown` は「何が入っているか分からない値」。型ガード（`typeof`、`isPlainObject`）で絞ってから使う。
function parseTarget(x: unknown): TableTargetSettings {
  if (!isPlainObject(x)) return EMPTY_TARGET;
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const s = get('sort');
  let sort: TableSort | null = null;
  if (
    isPlainObject(s) &&
    typeof s.column === 'string' &&
    s.column !== '' &&
    s.column.length <= 1000 &&
    (s.direction === 'asc' || s.direction === 'desc')
  )
    sort = { column: s.column, direction: s.direction };
  const c = get('columns');
  let columns: string[] | null = null;
  if (Array.isArray(c)) {
    const seen = new Set<string>();
    for (const key of c) {
      // 【なぜ】壊れた要素だけ捨てる。列の選択 1 つのために、プロジェクト全体を開けなくしない。
      if (typeof key === 'string' && key !== '' && key.length <= 1000 && !seen.has(key)) {
        seen.add(key);
        if (seen.size >= 10000) break;
      }
    }
    columns = [...seen];
  }
  return { sort, columns };
}

/**
 * JSON から表ビューの設定を組み立てる。
 *
 * 【なぜ】項目の欠け・壊れは既定で補う（任意の項目。D-24、D-44）。オブジェクトでないときだけ失敗にする。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた箇所
 */
export function parseTableView(x: unknown): ParseResult<TableViewSettings> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '表の設定が不正です' };
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const target = get('target') === 'edge' ? 'edge' : 'node';
  return {
    ok: true,
    value: { target, node: parseTarget(get('node')), edge: parseTarget(get('edge')) },
  };
}

/**
 * JSON から下の段の設定を組み立てる。無い項目と、読めない項目は既定で補う。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた箇所
 */
export function parseWorkspace(x: unknown): ParseResult<WorkspaceSettings> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '下の段の設定が不正です' };
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const tab = WORKSPACE_TABS.find((t) => t === get('tab')) ?? DEFAULT_WORKSPACE.tab;
  const open = get('open');
  const height = get('height');
  return {
    ok: true,
    value: {
      tab,
      open: typeof open === 'boolean' ? open : DEFAULT_WORKSPACE.open,
      height:
        typeof height === 'number' && Number.isFinite(height)
          ? clampWorkspaceHeight(height)
          : DEFAULT_WORKSPACE.height,
    },
  };
}
