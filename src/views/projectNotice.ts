import { createStore } from 'zustand/vanilla';
import type { ProjectFailureKind, ProjectWarning } from '../io/project';

/** 読み込みの失敗。`parseProject` の失敗の項目をそのまま持つ。 */
export interface ProjectFailure {
  readonly kind: ProjectFailureKind;
  readonly path: string;
  readonly reason: string;
  readonly fileVersion?: number;
}

/** 読み込みの元。ファイルを開いたか、自動保存から復元したか。 */
export type ProjectSource = 'file' | 'autosave';

/**
 * 読み込みの結果。読み込んだデータと組にして持つ（D-33 (3)）。
 * 一時的な知らせ（保存の失敗など）では消えない。次の読み込みで置き換わる。
 */
export interface LoadReport {
  readonly source: ProjectSource;
  readonly title: string;
  readonly warnings: readonly ProjectWarning[];
}

// 【TS】判別共用体。`kind` で持つ項目が決まる。
/**
 * 一時的な知らせ（FR-IN-08、FR-PJ-02、D-33）。次の知らせで置き換わる。
 */
export type ProjectNotice =
  /** 読み込みの失敗（ファイルを開く、または自動保存の復元）。 */
  | { readonly kind: 'failed'; readonly source: ProjectSource; readonly failure: ProjectFailure }
  /** ファイルの読み取り自体に失敗した（ファイルの中身の問題ではない）。 */
  | { readonly kind: 'read-error'; readonly message: string }
  /** IndexedDB が使えず、自動保存ができない。動作は続く。 */
  | { readonly kind: 'autosave-unavailable' }
  /** 容量が足りず、自動保存できなかった。 */
  | { readonly kind: 'autosave-quota' }
  /** 保存する文字列を作れなかった（想定外）。 */
  | { readonly kind: 'autosave-serialize' }
  /** 自動保存がこのアプリより新しい版だったので、自動保存を止めた（上書きしない）。 */
  | { readonly kind: 'autosave-stopped' }
  /** 自動保存を消した。 */
  | { readonly kind: 'autosave-cleared' }
  /** 自動保存を消せなかった。 */
  | { readonly kind: 'autosave-clear-failed' }
  /** 同じアプリを別のタブでも開いている。 */
  | { readonly kind: 'other-tab' }
  /** 保存するとき、地図のタイルの URL から鍵らしい項目を除いた（D-52）。項目名だけを持つ（値は持たない）。 */
  | { readonly kind: 'tile-keys-stripped'; readonly names: readonly string[] }
  /** 保存するとき、使えないタイルの URL を空にした（D-52）。 */
  | { readonly kind: 'tile-url-dropped' };

/** projectNotice の状態と操作。 */
export interface ProjectNoticeState {
  /** 最後の読み込みの結果。無ければ null。 */
  readonly report: LoadReport | null;
  /** 読み込みの結果の欄を開いているか（閉じても `report` は残り、再び開ける）。 */
  readonly reportOpen: boolean;
  /** 一時的な知らせ。 */
  readonly notice: ProjectNotice | null;
  /** 読み込みの結果を置く（欄は開く。前の一時的な知らせは消す）。 */
  readonly setReport: (report: LoadReport) => void;
  /** 読み込みの結果の欄を開く、または閉じる。 */
  readonly setReportOpen: (open: boolean) => void;
  /** 一時的な知らせを出す（前の知らせは置き換える。読み込みの結果は変えない）。 */
  readonly show: (notice: ProjectNotice) => void;
  /** 一時的な知らせを閉じる。 */
  readonly dismiss: () => void;
}

/**
 * 知らせのストアを作る。
 *
 * 【なぜ】一時的な UI の状態なので保存しない。警告の型が io に依存するので state ではなく views に置く
 * （state は io を import できない。D-26）。
 *
 * @returns Zustand のストア
 */
export function createProjectNoticeStore() {
  return createStore<ProjectNoticeState>()((set) => ({
    report: null,
    reportOpen: false,
    notice: null,
    setReport: (report) => {
      set({ report, reportOpen: true, notice: null });
    },
    setReportOpen: (reportOpen) => {
      set({ reportOpen });
    },
    show: (notice) => {
      set({ notice });
    },
    dismiss: () => {
      set({ notice: null });
    },
  }));
}

/** アプリ全体で使う知らせのストア。 */
export const projectNoticeStore = createProjectNoticeStore();
