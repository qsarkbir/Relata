import type { ReactNode } from 'react';
import './ui.css';

/** {@link Toolbar} の props。 */
interface ToolbarProps {
  /** ツールバーの名前（読み上げに使う）。 */
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * 操作を 1 行に並べる入れ物。幅が足りなければ折り返す（英語の長い文言ではみ出さないため）。
 *
 * 【なぜ】`role="toolbar"` は矢印キーで部品を移る作法を約束する。検索の入力欄を含むので、
 * その約束は付けず、名前のついたグループにする。Tab で順に移れる。
 * @param props - 名前と中身
 * @returns グループの要素
 */
export function Toolbar({ label, children }: ToolbarProps) {
  return (
    <div className="rl-toolbar" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * ツールバーの中で、関連する操作をまとめる。
 *
 * @param props - 中身
 * @param props.children - まとめる操作
 * @returns div 要素
 */
export function ToolbarGroup({ children }: { readonly children: ReactNode }) {
  return <div className="rl-toolbar-group">{children}</div>;
}
