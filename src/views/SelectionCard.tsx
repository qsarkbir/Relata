import type { ReactNode, Ref } from 'react';
import type { RelataGraph } from '../core/graph';
import type { NodeId } from '../core/model';
import { useT } from './hooks';
import { Icon } from './ui/icons';

/** {@link SelectionCard} の props。表示内容と Escape 後のフォーカスはビューが決める。 */
interface Props {
  readonly bodyId: string;
  readonly heading: string;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onEscape: () => void;
  readonly children: ReactNode;
}

/**
 * グラフと地図で共通の選択カードの枠。名前は書字方向を周囲から隔離する。
 *
 * @param props - 見出し、開閉、解除と、カードに表示する内容
 * @returns 選択カード
 */
export function SelectionCard({
  bodyId,
  heading,
  headingRef,
  expanded,
  onToggle,
  onEscape,
  children,
}: Props) {
  const t = useT();
  const toggleLabel = t(expanded ? 'graph.selection.collapse' : 'graph.selection.expand');
  return (
    <section
      className="graph-card"
      aria-label={t('graph.details')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onEscape();
        }
      }}
    >
      <div className="graph-card-head">
        <h3 ref={headingRef} tabIndex={-1} title={heading}>
          <bdi>{heading}</bdi>
        </h3>
        <button
          type="button"
          className="icon-button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={onToggle}
        >
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
        </button>
      </div>
      <div id={bodyId} className="graph-card-body" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

/**
 * グラフと地図で共通の、選んだノードに入る関係と出る関係の一覧。
 *
 * @param props - 現在のグラフと、そのグラフに含まれるノード
 * @returns 入る関係と出る関係
 */
export function NodeNeighbors({ graph, id }: { readonly graph: RelataGraph; readonly id: NodeId }) {
  const t = useT();
  return (
    <>
      <h4>{t('graph.in')}</h4>
      <ul>
        {graph.inNeighbors(id).map((neighbor) => (
          <li key={neighbor}>
            <bdi>{graph.getNodeAttribute(neighbor, 'label')}</bdi>
          </li>
        ))}
      </ul>
      <h4>{t('graph.out')}</h4>
      <ul>
        {graph.outNeighbors(id).map((neighbor) => (
          <li key={neighbor}>
            <bdi>{graph.getNodeAttribute(neighbor, 'label')}</bdi>
          </li>
        ))}
      </ul>
    </>
  );
}
