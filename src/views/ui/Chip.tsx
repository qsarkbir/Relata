import type { ReactNode } from 'react';
import { Icon } from './icons';
import './ui.css';

/** {@link Chip} の props。 */
interface ChipProps {
  /** 押したときの処理。あれば項目全体がボタンになる（その設定を開く）。 */
  readonly onClick?: () => void;
  /** 項目の中身。利用者の値は `<bdi>` で包んで渡す。 */
  readonly children: ReactNode;
  /** ボタンの名前を、見える文字と別にするとき。 */
  readonly label?: string;
  /** 省略記号で切れたときに全体を出す説明（`title`）。 */
  readonly title?: string;
  /** 項目の ID（フォーカスを移すときなどに使う）。 */
  readonly id?: string;
  /** 解除の処理と、解除ボタンの名前。あれば右に ✕ を付ける。 */
  readonly onRemove?: { readonly label: string; readonly run: () => void };
}

/**
 * 条件の項目（チップ）。適用中の条件の行や、選択中の表示に使う。
 *
 * 【なぜ】押せるかどうかは、枠の見た目だけでなく要素の種類（button か span）で区別する。
 * 色だけで伝えない（NFR-07）。
 * @param props - 中身、押したときの処理、解除の処理
 * @returns チップの要素
 */
export function Chip({ onClick, children, label, title, id, onRemove }: ChipProps) {
  const body = (
    <span className="rl-chip-text" title={title}>
      {children}
    </span>
  );
  if (onRemove !== undefined) {
    return (
      <span className="rl-chip" id={id}>
        {body}
        <button
          type="button"
          className="rl-chip-remove"
          aria-label={onRemove.label}
          title={onRemove.label}
          onClick={onRemove.run}
        >
          <Icon name="close" />
        </button>
      </span>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" className="rl-chip" id={id} aria-label={label} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <span className="rl-chip" id={id}>
      {body}
    </span>
  );
}
