import { useMemo } from 'react';
import type { RelataGraph } from '../core/graph';
import { toNodeId, type Dataset, type EdgeId, type NodeId, type NodeTypeId } from '../core/model';
import { getFilterResult, selectFilterState } from '../state';
import { useFilter, useT } from './hooks';
import { NeighborEvidence, OriginalEdgeRecords, SelectedEdges } from './ProjectionEvidence';
import { NodeNeighbors, SelectionCard } from './SelectionCard';
import { RangeSelectSummary } from './RangeSelectSummary';

/** {@link MapSelectionCard} の props。地図と表で同じ元の ID の選択を読む。 */
interface Props {
  readonly dataset: Dataset;
  readonly graph: RelataGraph;
  readonly selected: ReadonlySet<NodeId>;
  readonly selectedEdges: ReadonlySet<EdgeId>;
  readonly edgeKeys: readonly string[];
  readonly placed: Pick<ReadonlySet<NodeId>, 'has'>;
  readonly viaType?: NodeTypeId;
  readonly heading: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onEscape: () => void;
}

/**
 * 地図で選んだ人・場所と関係の詳細（FR-TB-02、D-40、phase3-plan §3.1）。
 * 地図に載せられない選択も残し、フィルタ、グラフの設定、座標の不足を区別する。
 *
 * @param props - 元のデータ、現在のグラフと座標、ビューで共通の選択、カードの状態
 * @returns 選んだものの詳細
 */
export function MapSelectionCard({
  dataset,
  graph,
  selected,
  selectedEdges,
  edgeKeys,
  placed,
  viaType,
  heading,
  expanded,
  onToggle,
  onEscape,
}: Props) {
  const t = useT();
  const filters = useFilter(selectFilterState);
  const filtered = getFilterResult(dataset, filters);
  const labels = useMemo(
    () => new Map(dataset.nodes.map((node) => [node.id, node.label])),
    [dataset],
  );
  const records = useMemo(() => new Map(dataset.edges.map((edge) => [edge.id, edge])), [dataset]);
  const labelOf = (id: NodeId): string => labels.get(id) ?? id;
  const endpointsPlaced = (key: string): boolean =>
    placed.has(toNodeId(graph.source(key))) && placed.has(toNodeId(graph.target(key)));

  const represented = new Set(edgeKeys.flatMap((key) => graph.getEdgeAttribute(key, 'edgeIds')));
  const originalOnly = Array.from(selectedEdges).filter((id) => !represented.has(id));
  const withoutCoordinates = new Set<EdgeId>();
  // 一部の元エッジだけを選んでも集約エッジ全体は強調しない（D-40）。元の詳細と、地図に出ない理由は残す。
  if (originalOnly.length > 0) {
    const originals = new Set(originalOnly);
    const drawable = new Set<EdgeId>();
    graph.forEachEdge((key, attrs) => {
      for (const id of attrs.edgeIds) {
        if (!originals.has(id)) continue;
        if (endpointsPlaced(key)) drawable.add(id);
        else withoutCoordinates.add(id);
      }
    });
    for (const id of drawable) withoutCoordinates.delete(id);
  }

  const nodeNote = (id: NodeId): string | undefined => {
    if (placed.has(id)) return undefined;
    if (!filtered.nodeIds.has(id)) return t('map.selection.nodeFiltered');
    if (!graph.hasNode(id)) return t('graph.selection.hidden');
    return t('map.selection.nodeCoordinates');
  };
  const originalEdgeNote = (id: EdgeId): string => {
    if (!filtered.edgeIds.has(id)) return t('map.selection.edgeFiltered');
    if (withoutCoordinates.has(id)) return t('map.selection.edgeCoordinates');
    return t('evidence.edgeHidden');
  };
  const nodeId = selected.size === 1 ? selected.values().next().value : undefined;
  const note = nodeId === undefined ? undefined : nodeNote(nodeId);
  return (
    <SelectionCard
      bodyId="map-card-body"
      heading={heading}
      expanded={expanded}
      onToggle={onToggle}
      onEscape={onEscape}
    >
      {nodeId !== undefined && (
        <>
          <p>
            <bdi>{nodeId}</bdi>
          </p>
          {note !== undefined && <p className="graph-card-hidden">{note}</p>}
        </>
      )}
      {selected.size > 0 && (
        <RangeSelectSummary
          ids={selected}
          nodeLabel={labelOf}
          isVisible={(id) => graph.hasNode(id)}
          unavailableLabel={nodeNote}
          passTypes={viaType === undefined ? [] : [viaType]}
          typeLabel={(id) => dataset.nodeTypes.find((type) => type.id === id)?.label ?? id}
        />
      )}
      {edgeKeys.length > 0 && (
        <SelectedEdges
          graph={graph}
          edgeKeys={edgeKeys}
          records={records}
          edgeNote={(key) =>
            endpointsPlaced(key) ? undefined : t('map.selection.edgeCoordinates')
          }
        />
      )}
      {originalOnly.length > 0 && (
        <section aria-label={t('evidence.edgeRecords')}>
          <h4>{t('evidence.edgeRecords')}</h4>
          <OriginalEdgeRecords
            ids={originalOnly}
            records={records}
            labelOf={labelOf}
            noteOf={originalEdgeNote}
          />
        </section>
      )}
      {nodeId !== undefined && graph.hasNode(nodeId) && (
        <>
          {viaType !== undefined && <NeighborEvidence graph={graph} nodeId={nodeId} />}
          <NodeNeighbors graph={graph} id={nodeId} />
        </>
      )}
    </SelectionCard>
  );
}
