import { useEffect, useRef, type ReactNode } from 'react';
import type { DialogId } from '../state';
import { useT, useUi } from './hooks';

/** {@link ModalDialog} の props。 */
interface ModalDialogProps {
  /** ストアで開閉を管理するダイアログの種類。 */
  readonly id: DialogId;
  /** 見出しの文字列。 */
  readonly title: string;
  /** dialog 要素に付けるクラス名。 */
  readonly className?: string;
  /** 本文。 */
  readonly children: ReactNode;
}

/**
 * ストアの `openDialog` で開閉する、モーダルのダイアログ。
 *
 * 【なぜ】ネイティブの `<dialog>` と `showModal()` を使う。Esc で閉じる、フォーカスを中に閉じ込める、
 * 閉じたら元のボタンに戻す、が標準で働き、キーボードだけで操作できる（NFR-07）。
 * 開閉の状態は uiStore の 1 か所で持つ（AboutDialog と同じ方式）。
 * @param props - 種類、見出し、本文
 * @returns `<dialog>` 要素
 */
export function ModalDialog({ id, title, className, children }: ModalDialogProps) {
  const t = useT();
  const open = useUi((s) => s.openDialog === id);
  const setOpenDialog = useUi((s) => s.setOpenDialog);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const titleId = `${id}-dialog-title`;
  return (
    <dialog
      ref={ref}
      className={['modal-dialog', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      onClose={() => {
        setOpenDialog(null);
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {/* 【なぜ】閉じているときは中身を描かない。開くまで計算や購読を始めないため。 */}
      {open && children}
      <form method="dialog">
        <button type="submit">{t('about.close')}</button>
      </form>
    </dialog>
  );
}
