import type { GraphViewState, WorkspaceViewState } from '../state';
import type { StoreApi } from 'zustand/vanilla';
import { parseProject } from '../io/project';
import type { ParseProjectResult } from '../io/project';
import { applySnapshot, dataStore, filterStore, graphViewStore, workspaceStore } from '../state';
import type { DataState, FilterStoreState, UiState } from '../state';
import { projectNoticeStore } from './projectNotice';
import type { ProjectNoticeState, ProjectSource } from './projectNotice';

/** 読み込みの出力先。テストで差し替えられる。 */
export interface ProjectLoadTargets {
  readonly graph?: StoreApi<GraphViewState>;
  readonly workspace?: StoreApi<WorkspaceViewState>;
  readonly data: StoreApi<DataState>;
  readonly filter: StoreApi<FilterStoreState>;
  readonly notice: StoreApi<ProjectNoticeState>;
}

const DEFAULT_TARGETS: ProjectLoadTargets = {
  data: dataStore,
  graph: graphViewStore,
  workspace: workspaceStore,
  filter: filterStore,
  notice: projectNoticeStore,
};

/**
 * プロジェクトの JSON 文字列を読み込み、成功すればストアに入れる。例外は投げない。
 *
 * 成功: データ、読み込みの設定、フィルタを入れ（順序は `applySnapshot`）、警告を知らせに出す。
 * 失敗: ストアは変えず（今の作業を壊さない）、失敗の種類を知らせに出す。
 *
 * @param text - JSON 文字列
 * @param source - 読み込みの元（ファイルか、自動保存か）
 * @param targets - 出力先（省略するとアプリのストア）
 * @returns 解析の結果
 */
export function loadProjectText(
  text: string,
  source: ProjectSource,
  targets: ProjectLoadTargets = DEFAULT_TARGETS,
): ParseProjectResult {
  const result = parseProject(text);
  if (!result.ok) {
    targets.notice.getState().show({
      kind: 'failed',
      source,
      failure: {
        kind: result.kind,
        path: result.path,
        reason: result.reason,
        // 【TS】`cond && {…}` を展開すると、条件が偽のとき何も足さない（`undefined` の項目を作らない）。
        ...(result.fileVersion !== undefined && { fileVersion: result.fileVersion }),
      },
    });
    return result;
  }
  applySnapshot(result.value, targets.data, targets.filter, targets.graph, targets.workspace);
  targets.notice.getState().setReport({
    source,
    title: result.value.dataset.meta.title,
    warnings: result.warnings,
  });
  return result;
}

/** ファイルのように中身を文字列で読める値（`File` を単体テストで偽物に替えられるように）。 */
export interface TextSource {
  readonly text: () => Promise<string>;
}

/**
 * 描画の機会を 1 度ブラウザに渡す。
 *
 * 【なぜ】`requestAnimationFrame` の後に `setTimeout(0)` を挟むと、進行表示が実際に描かれた後で
 * 次の処理（同期の解析）が始まる。`requestAnimationFrame` が無い環境（単体テスト）では `setTimeout` だけ。
 *
 * @returns 描画の後に解決する Promise
 */
function yieldToPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * 選ばれたファイルを読み込む。読み込み中は進行表示を出す（FR-UI-03）。例外は投げない。
 *
 * 取り消せる区間: ファイルの読み取りと、描画を待つ間。取り消されたら、解析もストアへの反映もしない。
 * 取り消せない区間: 解析（`parseProject`）とストアへの反映は同期の処理で、始まったら途中で止められない
 * （D-33 (2)）。
 *
 * @param file - 選ばれたファイル
 * @param ui - 進行表示を持つ uiStore
 * @param targets - 出力先（省略するとアプリのストア）
 * @returns 解析の結果。ファイルを読めなかったとき、または取り消されたときは null
 */
export async function openProjectFile(
  file: TextSource,
  ui: StoreApi<UiState>,
  targets: ProjectLoadTargets = DEFAULT_TARGETS,
): Promise<ParseProjectResult | null> {
  // 【なぜ】オブジェクトの項目にする。`let` の真偽値だと、await をまたいだ変化を TypeScript が追えず、
  //   「いつも false」と誤って絞り込む。
  const state = { cancelled: false };
  // 【なぜ】関数を通すと、TypeScript は呼ぶたびに値が変わりうるとみなす（上の絞り込みの誤りを避ける）。
  const isCancelled = (): boolean => state.cancelled;
  const taskId = ui.getState().startTask({ key: 'project.task.open' }, () => {
    state.cancelled = true;
  });
  try {
    const text = await file.text();
    if (isCancelled()) return null;
    await yieldToPaint();
    if (isCancelled()) return null;
    return loadProjectText(text, 'file', targets);
  } catch (e) {
    targets.notice.getState().show({
      kind: 'read-error',
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    ui.getState().endTask(taskId);
  }
}
