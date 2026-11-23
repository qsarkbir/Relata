import type { StoreApi } from 'zustand/vanilla';
import { serializeProject } from '../io/project';
import { selectFilterState, takeSnapshot } from '../state';
import type { DataState, FilterStoreState, UiState } from '../state';
import { loadProjectText } from '../views/projectLoad';
import type { ProjectLoadTargets } from '../views/projectLoad';

/** 自動保存の保存先。本番は IndexedDB、テストでは偽物。 */
export interface AutosaveStorage {
  /** 保存してある文字列。無ければ null。使えない環境では reject。 */
  readonly load: () => Promise<string | null>;
  /** 保存する（上書き）。 */
  readonly save: (text: string) => Promise<void>;
  /** 消す。 */
  readonly clear: () => Promise<void>;
}

/** 自動保存の待ち時間（ミリ秒。FR-PJ-02、§10）。 */
export const AUTOSAVE_DELAY_MS = 1000;

/**
 * 自動保存の問題の種類（D-33 (4)、(6)）。種類ごとに、利用者へ一度だけ知らせる。
 */
export type AutosaveProblem =
  /** 保存先が使えない（IndexedDB が無い、開けない）。 */
  | 'unavailable'
  /** 容量が足りない。 */
  | 'quota'
  /** 保存する文字列を作れなかった。 */
  | 'serialize'
  /** 保存してあったものがこのアプリより新しい版なので、自動保存を止めた。 */
  | 'stopped';

/** createAutosave の部品。 */
export interface AutosaveDeps {
  readonly targets: ProjectLoadTargets;
  readonly storage: AutosaveStorage;
  /** 保存日時（ISO 8601）を返す。呼ぶ側が時計を渡す。 */
  readonly now: () => string;
  /** 問題を知らせる。同じ種類は一度だけ呼ぶ。 */
  readonly onProblem: (problem: AutosaveProblem) => void;
  /** 復元の進行表示に使う uiStore（省略すると出さない）。 */
  readonly ui?: StoreApi<UiState>;
  readonly delayMs?: number;
}

/** 自動保存の操作。 */
export interface Autosave {
  /**
   * 前回の保存があれば読み込む。失敗してもアプリを止めない。
   * 読み取りが戻った時点で、すでにデータが入っていたら（利用者が先にファイルを開いたら）適用しない。
   */
  readonly restore: () => Promise<void>;
  /** 変更の見張りを始める。最初から張ってよい（復元の適用中の変更は無視する）。返す関数で止める。 */
  readonly start: () => () => void;
  /** 待っている保存があれば、今すぐ行う（タブを閉じる前など）。 */
  readonly flush: () => Promise<void>;
  /**
   * 保存してあるものを消す。進行中の保存の完了を待ってから消す。
   *
   * @returns 消せたら true、失敗したら false（呼ぶ側が毎回知らせる）
   */
  readonly clear: () => Promise<boolean>;
}

/**
 * 保存の失敗を種類に分ける。
 *
 * @param e - 投げられた値
 * @returns 容量の不足なら 'quota'、それ以外は 'unavailable'
 */
function classify(e: unknown): AutosaveProblem {
  // 【TS】`instanceof` で型を絞ってから `name` を読む。`DOMException` はブラウザ（と Node）が持つ例外の型。
  return typeof DOMException !== 'undefined' &&
    e instanceof DOMException &&
    e.name === 'QuotaExceededError'
    ? 'quota'
    : 'unavailable';
}

/**
 * 自動保存を作る（FR-PJ-02）。データ・読み込みの設定・フィルタが変わってから 1 秒後に保存する。
 *
 * 【なぜ】変化のたびにタイマーを張り直す（デバウンス）。フィルタを続けて操作している間は書かず、
 * 手が止まってから 1 回だけ書く。データが無いとき（起動直後など）は何も書かない
 * （前回の保存を空の状態で上書きしないため）。
 *
 * @param deps - 出力先、保存先、時計、通知
 * @returns 自動保存の操作
 */
export function createAutosave(deps: AutosaveDeps): Autosave {
  const delay = deps.delayMs ?? AUTOSAVE_DELAY_MS;
  const { data, filter } = deps.targets;
  // 【TS】`ReturnType<typeof setTimeout>` は「setTimeout が返す型」。ブラウザでは数、Node では別の型になるので、
  //       型を直に書かず、関数の戻り値の型から導く。
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> | undefined;
  let stopped = false;
  let applying = false;
  const told = new Set<AutosaveProblem>();

  // 【なぜ】失敗は黙らせない。ただし毎回知らせると邪魔なので、種類ごとに一度だけ。動作は続ける。
  const problem = (p: AutosaveProblem): void => {
    if (told.has(p)) return;
    told.add(p);
    deps.onProblem(p);
  };

  const write = async (): Promise<void> => {
    timer = undefined;
    if (stopped) return;
    const snapshot = takeSnapshot(data, filter, {
      ...(deps.targets.graph === undefined ? {} : { graph: deps.targets.graph }),
      ...(deps.targets.workspace === undefined ? {} : { workspace: deps.targets.workspace }),
      ...(deps.targets.display === undefined ? {} : { display: deps.targets.display }),
    });
    if (snapshot === null) return;
    let text: string;
    try {
      text = serializeProject(snapshot, deps.now());
    } catch {
      problem('serialize');
      return;
    }
    try {
      await deps.storage.save(text);
    } catch (e) {
      problem(classify(e));
    }
  };

  // 保存を始め、進行中の保存として覚えておく。終わったら（次の保存が始まっていなければ）忘れる。
  // 【なぜ】`clear` が進行中の保存の完了を待つため。タイマーからも flush からも、ここを通す。
  const startWrite = (): Promise<void> => {
    const p = write();
    inflight = p;
    void p.finally(() => {
      if (inflight === p) inflight = undefined;
    });
    return p;
  };

  const schedule = (): void => {
    if (stopped || applying) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void startWrite();
    }, delay);
  };

  return {
    restore: async () => {
      const before = data.getState().dataset;
      const taskId = deps.ui?.getState().startTask({ key: 'project.task.restore' });
      try {
        let text: string | null;
        try {
          text = await deps.storage.load();
        } catch {
          problem('unavailable');
          return;
        }
        if (text === null) return;
        // 【なぜ】読み取りの間に利用者がファイルを開いていたら、その作業を優先する（D-33 (2)）。
        if (data.getState().dataset !== before) return;
        // 【なぜ】復元の適用が「変更」として保存し直されないよう、適用の間だけ見張りを無視する。
        applying = true;
        try {
          // 通常の読み込みと同じ道を通す。壊れた保存は失敗として知らせるだけで、アプリは止まらない。
          const result = loadProjectText(text, 'autosave', deps.targets);
          if (!result.ok && result.kind === 'newer-version') {
            // 【なぜ】新しい版の保存を、古いアプリが上書きして壊さないため（D-33 (6)）。
            stopped = true;
            problem('stopped');
          }
        } finally {
          applying = false;
        }
      } finally {
        if (taskId !== undefined) deps.ui?.getState().endTask(taskId);
      }
    },
    start: () => {
      const unsubData = data.subscribe((s: DataState, prev: DataState) => {
        if (s.dataset !== prev.dataset || s.importSettings !== prev.importSettings) schedule();
      });
      const unsubFilter = filter.subscribe((s: FilterStoreState, prev: FilterStoreState) => {
        if (selectFilterState(s) !== selectFilterState(prev)) schedule();
      });
      const unsubGraph = deps.targets.graph?.subscribe((s, prev) => {
        if (s.view !== prev.view) schedule();
      });
      const unsubWorkspace = deps.targets.workspace?.subscribe((s, prev) => {
        if (s.table !== prev.table || s.workspace !== prev.workspace) schedule();
      });
      const unsubDisplay = deps.targets.display?.subscribe((s, prev) => {
        if (s.calendar !== prev.calendar) schedule();
      });
      return () => {
        unsubWorkspace?.();
        unsubDisplay?.();
        unsubGraph?.();
        unsubData();
        unsubFilter();
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
    },
    flush: async () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      await startWrite();
    },
    clear: async () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      // 【なぜ】進行中の保存が消した後に書き込むと、「消した」のに残る。完了を待ってから消す（D-33 (4)）。
      //       待っている間に次の保存が始まることがある（待ちの間の変更、flush）。最初の 1 つだけを
      //       待つと、その次の保存が消した後に終わって残るので、進行中の保存が無くなるまで待つ。
      while (inflight !== undefined) {
        await inflight;
      }
      try {
        await deps.storage.clear();
        return true;
      } catch {
        return false;
      }
    },
  };
}
