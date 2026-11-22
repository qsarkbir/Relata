import type { ReactNode } from 'react';
import type { SidePanelId } from '../../state';
import { useT, useUi } from '../hooks';
import { Icon } from './icons';

/** {@link SidePanel} の props。 */
interface SidePanelProps {
  readonly id: SidePanelId;
  /** パネルの名前（aside の aria-label と、開閉ボタンの名前に使う）。 */
  readonly label: string;
  /** 行の始め（左）のパネルか、終わり（右）のパネルか。畳む矢印の向きを決める。 */
  readonly side: 'start' | 'end';
  readonly className: string;
  readonly children: ReactNode;
}

/**
 * 折りたためる横のパネル。畳むと、開くためのボタンだけの細い列になる。
 *
 * 【なぜ】畳んでも中身は描いたまま隠す（hidden）。外すと、フィルタの下書きや指標の計算が
 * 捨てられ、開き直したときに作業が失われるため。
 * @param props - パネルの種類、名前、位置、中身
 * @returns aside 要素
 */
export function SidePanel({ id, label, side, className, children }: SidePanelProps) {
  const t = useT();
  const collapsed = useUi((s) => s.collapsedPanels[id]);
  const togglePanel = useUi((s) => s.togglePanel);
  const contentId = `side-panel-${id}`;
  const name = t(collapsed ? 'panel.expand' : 'panel.collapse', { panel: label });
  // 畳むときは外側へ、開くときは内側へ向く矢印にする。
  const icon = (side === 'start') !== collapsed ? 'collapseStart' : 'collapseEnd';
  return (
    <aside className={className} aria-label={label} data-collapsed={collapsed}>
      <div className="side-panel-toggle">
        <button
          type="button"
          className="icon-button"
          aria-label={name}
          title={name}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => {
            togglePanel(id);
          }}
        >
          <Icon name={icon} />
        </button>
      </div>
      <div id={contentId} hidden={collapsed}>
        {children}
      </div>
    </aside>
  );
}
