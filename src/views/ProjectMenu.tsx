import { useRef, useState } from 'react';
import { serializeProjectWithReport } from '../io/project';
import {
  takeSnapshot,
  dataStore,
  filterStore,
  uiStore,
  graphViewStore,
  workspaceStore,
  displayStore,
  timelineStore,
  timeStore,
  mapViewStore,
} from '../state';
import { useData, useT, useUi } from './hooks';
import { ModalDialog } from './ModalDialog';
import { ConfirmOpenDialog } from './ConfirmOpenDialog';
import { downloadText, projectFileName } from './projectFile';
import { openProjectFile } from './projectLoad';
import { projectNoticeStore } from './projectNotice';

/** ProjectMenu の props。 */
export interface ProjectMenuProps {
  /** 自動保存を消す操作。IndexedDB は app が持つので、呼ぶ側が渡す（views は app を import しない。D-26）。 */
  readonly onClearAutosave: () => void;
}

/**
 * プロジェクトの「保存」「開く」ボタンと、保存のダイアログ（FR-PJ-01、FR-IN-08、FR-PJ-02、FR-OUT-01）。
 *
 * 「保存」を押すとダイアログが開き、プロジェクト（.relata.json）を保存する。自動保存を消す操作も、このダイアログに置く。
 * 【なぜ】図（SVG・PNG・PDF）やグラフのデータ、CSV の書き出しは、別の「書き出し」のダイアログにまとめた
 * （T2-08。保存はプロジェクトだけ。保存と書き出しは別の操作）。
 *
 * @param props - 自動保存を消す操作
 * @returns ボタンの並び
 */
export function ProjectMenu({ onClearAutosave }: ProjectMenuProps) {
  const t = useT();
  const hasData = useData((s) => s.dataset !== null);
  const setOpenDialog = useUi((s) => s.setOpenDialog);
  // 【TS】`useRef<HTMLInputElement>(null)` は、型引数で「中身は input 要素」と指定する。描画前は null。
  const input = useRef<HTMLInputElement>(null);
  // 【なぜ】データがあるときは、選んだファイルをいったん持ち、確認の後で読む（D-33 (1)）。
  const [pending, setPending] = useState<File | null>(null);

  const save = (): void => {
    const snapshot = takeSnapshot(dataStore, filterStore, {
      graph: graphViewStore,
      workspace: workspaceStore,
      display: displayStore,
      timeline: timelineStore,
      time: timeStore,
      map: mapViewStore,
    });
    if (snapshot === null) return;
    // 【なぜ】日時は呼ぶ側（ここ）で作って渡す。io は Date を使わない（CLAUDE.md）。
    const savedAt = new Date().toISOString();
    // 【なぜ】タイルの URL の鍵は保存しない（D-52）。除いたら、ファイルを渡した先で入れ直しが要ることを知らせる。
    const saved = serializeProjectWithReport(snapshot, savedAt);
    downloadText(projectFileName(snapshot.dataset.meta.title, savedAt), saved.text);
    if (saved.strippedKeys.length > 0)
      projectNoticeStore.getState().show({ kind: 'tile-keys-stripped', names: saved.strippedKeys });
    else if (saved.tileUrlDropped) projectNoticeStore.getState().show({ kind: 'tile-url-dropped' });
  };

  return (
    <div role="group" aria-label={t('project.group')} className="project-menu">
      {/* 【なぜ】データが無くても押せる。自動保存を消す操作はデータが無いときにも要るため。 */}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setOpenDialog('save');
        }}
      >
        {t('project.save')}
      </button>
      <button
        type="button"
        onClick={() => {
          input.current?.click();
        }}
      >
        {t('project.open')}
      </button>
      <ModalDialog id="save" title={t('save.title')} className="save-dialog">
        <ul className="save-choices">
          <li>
            <button
              type="button"
              disabled={!hasData}
              onClick={() => {
                setOpenDialog(null);
                save();
              }}
            >
              {t('save.project')}
            </button>
            <p>{t('save.project.hint')}</p>
          </li>
        </ul>
        <h3>{t('save.autosave')}</h3>
        <p>{t('save.autosave.hint')}</p>
        <button
          type="button"
          onClick={() => {
            setOpenDialog(null);
            onClearAutosave();
          }}
        >
          {t('project.clearAutosave')}
        </button>
      </ModalDialog>
      {/* 【なぜ】見えない input をボタンから開く。ボタンならキーボードで操作でき、フォーカスも見える。 */}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="project-file-input"
        aria-label={t('project.open')}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // 【なぜ】同じファイルをもう一度選んでも change が起きるよう、選択を空に戻す。
          e.currentTarget.value = '';
          if (file === undefined) return;
          if (hasData) setPending(file);
          else void openProjectFile(file, uiStore);
        }}
      />
      <ConfirmOpenDialog
        fileName={pending === null ? null : pending.name}
        onConfirm={() => {
          if (pending !== null) void openProjectFile(pending, uiStore);
          setPending(null);
        }}
        onCancel={() => {
          setPending(null);
        }}
      />
    </div>
  );
}
