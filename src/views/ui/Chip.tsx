import { useId, type ReactNode } from 'react';
import { Icon } from './icons';
import './ui.css';

/** {@link Chip} の props。 */
interface ChipProps {
  /** 押したときの処理。あれば項目全体がボタンになる（その設定を開く）。 */
  readonly onClick?: () => void;
  /** 項目の中身。利用者の値は `<bdi>` で包んで渡す。 */
  readonly children: ReactNode;
  /**
   * 押したときに何が起きるかの説明（例: 「左のパネルの一覧を開く」）。`aria-describedby` で読み上げる。
   *
   * 【なぜ】ボタンの名前（`aria-label`）にはしない。名前は見える文字と一致させ、音声入力で
   * 見えている文字を言えば押せるようにするため（WCAG 2.5.3 Label in Name）。
   */
  readonly description?: string;
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
export function Chip({ onClick, children, description, title, id, onRemove }: ChipProps) {
  const descriptionId = useId();
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
    // 【なぜ】説明の文はボタンの外に置く。中に置くと、見えない文までボタンの名前に入ってしまう。
    return (
      <>
        <button
          type="button"
          className="rl-chip"
          id={id}
          aria-describedby={description === undefined ? undefined : descriptionId}
          onClick={onClick}
        >
          {body}
        </button>
        {description !== undefined && (
          <span id={descriptionId} className="visually-hidden">
            {description}
          </span>
        )}
      </>
    );
  }
  return (
    <span className="rl-chip" id={id}>
      {body}
    </span>
  );
}
