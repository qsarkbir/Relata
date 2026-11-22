import { useEffect, useId, useRef } from 'react';
import { useT } from './hooks';
import { tRich } from './richText';

/** ConfirmOpenDialog の props。 */
export interface ConfirmOpenDialogProps {
  /** 開こうとしているファイルの名前。確認の対象が無ければ null（ダイアログは閉じる）。 */
  readonly fileName: string | null;
  /** 「開く」を選んだ。 */
  readonly onConfirm: () => void;
  /** 「やめる」を選んだ、または Esc で閉じた。「開く」を選んだときは呼ばれない。 */
  readonly onCancel: () => void;
}

/**
 * 「今のデータを置き換えてよいか」の確認（D-33 (1)）。
 *
 * 【なぜ】ファイルに保存していない作業は、置き換えると戻らない。自動保存は最後の 1 つだけで、
 * 置き換えの後はそちらも新しいデータで上書きされる。ネイティブの `<dialog>` なので、
 * Esc で閉じる（= やめる）、フォーカスを中に閉じ込める、がキーボードだけで働く（NFR-07）。
 *
 * @param props - ファイル名と操作
 * @returns `<dialog>` 要素
 */
export function ConfirmOpenDialog({ fileName, onConfirm, onCancel }: ConfirmOpenDialogProps) {
  const t = useT();
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const open = fileName !== null;

  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        // 【なぜ】`close` イベントは、「やめる」や Esc で閉じたときだけでなく、「開く」の後に親が
        //       fileName を null にして、上の effect が `d.close()` を呼んだときにも起きる。
        //       そのときは、もう確認の対象が無い（open が false）ので、「やめる」の処理は呼ばない。
        //       このイベントは描画の後に届くので、ここで見る open は最新の値になっている。
        if (open) onCancel();
      }}
    >
      <h2 id={titleId}>{t('project.confirm.title')}</h2>
      <p>{fileName === null ? '' : tRich(t, 'project.confirm.body', {}, { file: fileName })}</p>
      <p>{t('project.confirm.saveHint')}</p>
      <form method="dialog">
        {/* 【なぜ】既定のフォーカスは「やめる」。Enter を押しただけで置き換えてしまわないため。 */}
        <button type="submit" autoFocus>
          {t('project.confirm.cancel')}
        </button>
        <button type="button" onClick={onConfirm}>
          {t('project.confirm.open')}
        </button>
      </form>
    </dialog>
  );
}
