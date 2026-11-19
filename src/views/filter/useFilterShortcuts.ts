import { useEffect } from 'react';
import { useFilter } from '../hooks';

// 【TS】`as const` は、配列を「文字列リテラルの読み取り専用の並び」として固定する。
//       下の `.some` で `type` と比べるとき、typo を型で防げる。
// 【なぜ】文字を打ち込む欄では、Ctrl+Z はその欄自身の取り消しに使う。ボタン、チェックボックス、
//       ラジオボタンなど、文字を入力しない欄では、フィルタの Undo を効かせる。
const NON_TEXT_INPUT_TYPES = [
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
] as const;

/**
 * フィルタの Undo と Redo のキーボード操作（FR-FL-10、NFR-07）。
 *
 * Ctrl または Cmd + Z で元に戻し、Shift を加えるとやり直す。Ctrl + Y でもやり直す
 * （Windows の慣習。Mac の Cmd + Y はブラウザの履歴などに使われるので奪わない）。
 * 文字を入力する欄（テキスト系の `input`、`textarea`、編集可能な要素）にフォーカスがあるときは、
 * その欄自身の取り消しを邪魔しないよう何もしない。`select`、ラジオ、チェックボックスでは効かせる。
 * モーダルの `<dialog>` が開いているときも何もしない。
 *
 * @param enabled - false のあいだは何もしない（データが無いときなど）
 */
export function useFilterShortcuts(enabled: boolean): void {
  const undo = useFilter((s) => s.undo);
  const redo = useFilter((s) => s.redo);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (document.querySelector('dialog[open]') !== null) return;
      const target = e.target;
      // 【TS】`instanceof` で絞り込むと、true の分岐では target が HTMLElement として扱える
      //       （`e.target` の型は EventTarget | null で、そのままでは tagName を読めない）。
      if (target instanceof HTMLElement) {
        if (target instanceof HTMLTextAreaElement || target.isContentEditable) return;
        if (
          target instanceof HTMLInputElement &&
          !NON_TEXT_INPUT_TYPES.some((type) => type === target.type)
        ) {
          return;
        }
      }
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, undo, redo]);
}
