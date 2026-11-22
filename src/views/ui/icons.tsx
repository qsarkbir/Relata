/**
 * 画面で使う小さなアイコン（SVG）。
 *
 * 【なぜ】アイコンの書体やライブラリを読み込まず、線だけの SVG を自前で持つ。外部への通信を増やさず
 * （CLAUDE.md「データの扱い」）、色は文字色（currentColor）に従うので、ボタンの状態と揃う。
 * アイコンだけのボタンには、必ず aria-label と title を付けて、読み上げと説明を補う（NFR-07）。
 */
import type { ReactNode } from 'react';

/** アイコンの種類。 */
export type IconName =
  'info' | 'zoomIn' | 'zoomOut' | 'fit' | 'undo' | 'redo' | 'collapseStart' | 'collapseEnd';

// 【TS】`Record<IconName, ReactNode>` は、IconName のすべての値をキーに持つことを型で強制する。
//       種類を足して図を書き忘れると、型検査で分かる。
const PATHS: Record<IconName, ReactNode> = {
  // 〇の中に「！」。注意書きや説明をまとめるアイコン（利用者の提案）。
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="6.8" x2="12" y2="13.2" />
      <circle cx="12" cy="16.8" r="0.6" fill="currentColor" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
    </>
  ),
  // 四隅の角。図の全体を枠に収める。
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
  // 二重の山括弧。パネルを左（行の始め）へ畳む／右（行の終わり）へ畳む向きを示す。
  collapseStart: <path d="M12 6l-6 6 6 6M18 6l-6 6 6 6" />,
  collapseEnd: <path d="M6 6l6 6-6 6M12 6l6 6-6 6" />,
};

/**
 * アイコンを描く。読み上げからは隠す（意味はボタンの aria-label で伝える）。
 *
 * @param props - アイコンの種類
 * @returns 24×24 の SVG
 */
export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** {@link IconButton} の props。 */
interface IconButtonProps {
  readonly icon: IconName;
  /** 読み上げとツールチップに使う名前。 */
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

/**
 * アイコンだけのボタン。名前は aria-label と title（マウスを重ねたときの説明）で示す。
 *
 * @param props - アイコン、名前、押したときの処理
 * @returns button 要素
 */
export function IconButton({ icon, label, onClick, disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
