import type { ReactNode } from 'react';
import './ui.css';

/** {@link CollapsibleSection} の props。 */
interface CollapsibleSectionProps {
  /** 見出し（利用者に見える名前）。 */
  readonly title: string;
  /** 最初から開いておくか。 */
  readonly defaultOpen?: boolean;
  /** 見出しの下に添える一言（例: 「グラフと指標に共通」）。 */
  readonly note?: string;
  readonly children: ReactNode;
}

/**
 * 見出しつきの折りたたみの節。
 *
 * 【なぜ】標準の `<details>` を使う。Enter と Space で開閉でき、読み上げにも対応する（NFR-07）。
 * 閉じても中身は DOM に残る（描いたまま隠す）ので、入力の途中の値や下書きは失われない。
 * 開閉の状態は DOM が持つため、親が再描画されても勝手に変わらない。
 * @param props - 見出し、既定の開閉、注記、中身
 * @returns details 要素
 */
export function CollapsibleSection({
  title,
  defaultOpen,
  note,
  children,
}: CollapsibleSectionProps) {
  return (
    <details className="rl-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="rl-section-body">
        {note !== undefined && <p className="rl-section-note">{note}</p>}
        {children}
      </div>
    </details>
  );
}
