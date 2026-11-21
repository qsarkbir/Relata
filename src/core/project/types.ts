import type { DatasetIssue } from '../model';
import type { FilterIssue } from '../filter';
import type { GraphViewSettings } from './graphView';
/**
 * プロジェクトファイルの型と定数（D-24、設計書 §11.3）。
 */
// 【TS】`import type` は型だけを取り込む。実行時には消えるので、層の間の余計な依存が増えない
//       （verbatimModuleSyntax のため、型だけの import はこう書く）。
import type { CalendarId, Dataset, MissingReason } from '../model';
import type { FilterState } from '../filter';

/** 今のプロジェクトファイルの版。互換性のない変更（列挙の要素の追加を含む）のときだけ上げる（D-24）。 */
export const CURRENT_FORMAT_VERSION = 1;

// 【TS】`readonly` を付けた項目は代入できない。`readonly T[]` は「要素の追加や置き換えができない配列」。
//       読み込んだ設定を、うっかり書き換えないための約束。
/** 欠損の記号と理由の対応 1 件（例: 「〔欠〕」→ lost。FR-IN-07）。 */
export interface MissingToken {
  readonly token: string;
  readonly reason: MissingReason;
}

/** 列ごとの暦の指定 1 件（例: 列 `born` はヒジュラ暦）。 */
export interface ColumnCalendar {
  readonly column: string;
  readonly calendar: CalendarId;
}

/**
 * 読み込みの設定。再読み込みや、保存したプロジェクトの再現のために持つ。
 */
// 【なぜ】利用者の列名をキーにした辞書にせず、配列で持つ。列名は `__proto__` などもありうるため（D-24）。
// 【TS】`encoding?: string` は任意の項目。「無い」ことがありうる（`undefined` を値として持つのとは区別する）。
export interface ImportSettings {
  readonly missingTokens: readonly MissingToken[];
  readonly encoding?: string;
  readonly columnCalendars: readonly ColumnCalendar[];
}

/** 既定の読み込み設定。記号の対応は空（空欄だけが欠損になる）。 */
export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  missingTokens: [],
  columnCalendars: [],
};

/** プロジェクトの表示状態。見た目、配置、時間の設定は、後のタスクで任意の項目として足す。 */
export interface ProjectView {
  readonly filter: FilterState;
  readonly graph?: GraphViewSettings;
}

// 【TS】`Record<keyof ProjectView, true>` は「ProjectView のキーを全部そろえた表」を強制する。
//       キーを足して、ここを書き忘れると型エラーになる。往復テストは、この表のキーがすべて残ることを見る。
/** `ProjectView` のキーの一覧（足し忘れの検出用）。 */
const PROJECT_VIEW_KEY_TABLE: Record<keyof ProjectView, true> = { filter: true, graph: true };
/** `ProjectView` のすべてのキー。 */
export const PROJECT_VIEW_KEYS: readonly string[] = Object.keys(PROJECT_VIEW_KEY_TABLE);

/** 保存する中身（ファイルの見出しを除く）。 */
export interface ProjectParts {
  readonly dataset: Dataset;
  readonly importSettings: ImportSettings;
  readonly view: ProjectView;
}

// 【TS】`extends` は、ProjectParts の項目をすべて引き継いで、項目を足す。
/** プロジェクトファイル（版 1）。 */
export interface ProjectFile extends ProjectParts {
  // 【TS】`'Relata'` は文字列リテラル型。「Relata という文字列だけ」を許し、他の文字列は型エラーになる。
  readonly app: 'Relata';
  readonly formatVersion: number;
  /** 保存した日時（ISO 8601）。呼ぶ側が渡す。読み込んだファイルに無ければ持たない。 */
  readonly savedAt?: string;
}

/** 読み込みで見つかった問題（読めはしたが、データに不整合がある）。 */
// 【TS】判別共用体。`source` で、問題の型が決まる。
export type ProjectWarning =
  | { readonly source: 'dataset'; readonly issue: DatasetIssue }
  | { readonly source: 'filter'; readonly issue: FilterIssue }
  /** 読み込みで落とした未知の項目（新しいアプリが足した任意の項目など）。 */
  | {
      readonly source: 'project';
      readonly issue: { readonly kind: 'unknown-field'; readonly path: string };
    };
