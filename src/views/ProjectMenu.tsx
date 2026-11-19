import { useRef, useState } from 'react';
import { serializeProject } from '../io/project';
import { takeSnapshot, dataStore, filterStore, uiStore } from '../state';
import { useData, useT } from './hooks';
import { ConfirmOpenDialog } from './ConfirmOpenDialog';
import { downloadText, projectFileName } from './projectFile';
import { openProjectFile } from './projectLoad';

/** ProjectMenu の props。 */
export interface ProjectMenuProps {
  /** 自動保存を消す操作。IndexedDB は app が持つので、呼ぶ側が渡す（views は app を import しない。D-26）。 */
  readonly onClearAutosave: () => void;
}

/**
 * プロジェクトの「保存」「開く」「自動保存を消す」ボタン（FR-PJ-01、FR-IN-08、FR-PJ-02）。
 *
 * @param props - 自動保存を消す操作
 * @returns ボタンの並び
 */
export function ProjectMenu({ onClearAutosave }: ProjectMenuProps) {
  const t = useT();
  const hasData = useData((s) => s.dataset !== null);
  // 【TS】`useRef<HTMLInputElement>(null)` は、型引数で「中身は input 要素」と指定する。描画前は null。
  const input = useRef<HTMLInputElement>(null);
  // 【なぜ】データがあるときは、選んだファイルをいったん持ち、確認の後で読む（D-33 (1)）。
  const [pending, setPending] = useState<File | null>(null);

  const save = (): void => {
    const snapshot = takeSnapshot(dataStore, filterStore);
    if (snapshot === null) return;
    // 【なぜ】日時は呼ぶ側（ここ）で作って渡す。io は Date を使わない（CLAUDE.md）。
    const savedAt = new Date().toISOString();
    downloadText(
      projectFileName(snapshot.dataset.meta.title, savedAt),
      serializeProject(snapshot, savedAt),
    );
  };

  return (
    <div role="group" aria-label={t('project.group')} className="project-menu">
      <button type="button" disabled={!hasData} onClick={save}>
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
      <button type="button" onClick={onClearAutosave}>
        {t('project.clearAutosave')}
      </button>
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
