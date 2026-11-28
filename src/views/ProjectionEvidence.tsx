import { useMemo, useState } from 'react';
import type { EdgeId, GraphEdge, NodeId } from '../core/model';
import type { RelataGraph } from '../core/graph';
import { selectionStore } from '../state';
import { useData, useT, useUi } from './hooks';
import { getNumberFormat } from './intl';

/** 根拠の仲介ノードを、折りたたまずに先に見せる件数。多いときは件数を示して残りを畳む。 */
const VIA_PREVIEW = 5;

/** {@link ViaList} の props。 */
interface ViaListProps {
  readonly ids: readonly NodeId[];
  /** 仲介ノードの ID → ラベル（呼ぶ側が 1 回だけ作って渡す）。 */
  readonly labels: ReadonlyMap<NodeId, string>;
}

/**
 * 根拠の仲介ノードの一覧（FR-GR-04）。ラベルは利用者の値なので `<bdi>` で隔離する。
 * 多いときは件数を示し、先頭だけを見せて残りは押して開く。
 *
 * @param props - 仲介ノードの ID（昇順）
 * @returns 件数と一覧
 */
function ViaList({ ids, labels }: ViaListProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? ids : ids.slice(0, VIA_PREVIEW);
  return (
    <div className="evidence-via">
      <span className="evidence-via-count">
        {t('evidence.via', { count: nf.format(ids.length) })}
      </span>
      <ul>
        {shown.map((id) => (
          <li key={id} title={labels.get(id) ?? id}>
            <bdi>{labels.get(id) ?? id}</bdi>
          </li>
        ))}
      </ul>
      {ids.length > VIA_PREVIEW && !expanded && (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
          }}
        >
          {t('evidence.viaMore', { count: nf.format(ids.length - VIA_PREVIEW) })}
        </button>
      )}
    </div>
  );
}

/** {@link SelectedEdges} の props。 */
interface SelectedEdgesProps {
  readonly graph: RelataGraph;
  readonly edgeKeys: readonly string[];
  readonly edgeNote?: (key: string) => string | undefined;
  readonly records?: ReadonlyMap<EdgeId, GraphEdge>;
}

/**
 * 選択中のエッジ（射影したエッジ、または集約したエッジ）。射影したエッジには根拠の仲介ノードを出す。
 *
 * @param props - グラフと、選択中のエッジのキー
 * @returns エッジごとの一覧
 */
export function SelectedEdges({ graph, edgeKeys, edgeNote, records }: SelectedEdgesProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const dataset = useData((s) => s.dataset);
  // 【なぜ】ID からラベルを引く表は、データが替わったときだけ作る（ラベルで照合せず、ID で引く）。
  // エッジごとの一覧で作り直さないよう、ここで 1 回だけ作って渡す。
  const labels = useMemo(
    () => new Map((dataset?.nodes ?? []).map((node) => [node.id, node.label])),
    [dataset],
  );
  return (
    <section className="evidence" aria-label={t('evidence.selectedEdges')}>
      <h4>{t('evidence.selectedEdges')}</h4>
      <ul className="evidence-edges">
        {edgeKeys.map((key) => {
          const attrs = graph.getEdgeAttributes(key);
          const source = graph.getNodeAttribute(graph.source(key), 'label');
          const target = graph.getNodeAttribute(graph.target(key), 'label');
          const note = edgeNote?.(key);
          return (
            <li key={key} data-testid="evidence-edge">
              <p className="evidence-edge-title">
                <bdi>{source}</bdi> — <bdi>{target}</bdi>
              </p>
              {attrs.via === undefined ? (
                <p>
                  {t('evidence.aggregated')} ·{' '}
                  {t('evidence.originalEdges', { count: nf.format(attrs.edgeIds.length) })}
                </p>
              ) : (
                <ViaList ids={attrs.via} labels={labels} />
              )}
              {note !== undefined && <p className="graph-card-hidden">{note}</p>}
              {records !== undefined && (
                <details>
                  <summary>{t('evidence.edgeRecords')}</summary>
                  <OriginalEdgeRecords
                    ids={attrs.edgeIds}
                    records={records}
                    labelOf={(id) => labels.get(id) ?? id}
                  />
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 元のエッジに記録されている端点・関係・重みを示す。集約で置き換わった値も ID から確認できる。
 *
 * @param props - 元のエッジ ID と記録、ノードの名前、項目ごとの表示理由
 * @returns 元のエッジの一覧
 */
export function OriginalEdgeRecords({
  ids,
  records,
  labelOf,
  noteOf,
}: {
  readonly ids: Iterable<EdgeId>;
  readonly records: ReadonlyMap<EdgeId, GraphEdge>;
  readonly labelOf: (id: NodeId) => string;
  readonly noteOf?: (id: EdgeId) => string;
}) {
  const t = useT();
  const nf = getNumberFormat(useUi((s) => s.locale));
  return (
    <ul className="map-edge-records">
      {Array.from(ids, (id) => {
        const record = records.get(id);
        const note = noteOf?.(id);
        return (
          <li key={id}>
            <bdi>{id}</bdi>
            {record !== undefined && (
              <>
                {' · '}
                <bdi>{labelOf(record.source)}</bdi> {record.directed ? '→' : '—'}{' '}
                <bdi>{labelOf(record.target)}</bdi>
                {record.relation !== undefined && (
                  <>
                    {' '}
                    {'·'} <bdi>{record.relation}</bdi>
                  </>
                )}
                {' · '}
                {t('table.col.weight')} {nf.format(record.weight)}
              </>
            )}
            {note !== undefined && <p className="graph-card-hidden">{note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** {@link NeighborEvidence} の props。 */
interface NeighborEvidenceProps {
  readonly graph: RelataGraph;
  readonly nodeId: NodeId;
}

/**
 * 射影後のノードを選んだとき、隣接ノードごとの根拠の件数を一覧にする。各行から、そのエッジを選べる
 * （選ぶと、上の「選択中のエッジ」に根拠の仲介ノードが出る）。
 *
 * @param props - 射影後のグラフと、選択中のノード
 * @returns 隣接ノードの一覧
 */
export function NeighborEvidence({ graph, nodeId }: NeighborEvidenceProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const rows = graph
    .edges(nodeId)
    .map((key) => {
      const attrs = graph.getEdgeAttributes(key);
      const other = graph.opposite(nodeId, key);
      return {
        key,
        id: other,
        label: graph.getNodeAttribute(other, 'label'),
        count: attrs.count,
        edgeIds: attrs.edgeIds,
      };
    })
    .sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
  if (rows.length === 0) return null;
  return (
    <section className="evidence" aria-label={t('evidence.neighbors')}>
      <h4>{t('evidence.neighbors')}</h4>
      <ul className="evidence-neighbors">
        {rows.map((row) => (
          <li key={row.key} data-testid="evidence-neighbor">
            <bdi>{row.label}</bdi>
            <span className="evidence-count">
              {' '}
              {t('evidence.neighborCount', { count: nf.format(row.count) })}
            </span>{' '}
            <button
              type="button"
              aria-label={`${t('evidence.selectEdge')}: ${row.label}`}
              onClick={() => {
                selectionStore.getState().select({
                  nodes: [nodeId],
                  edges: row.edgeIds,
                });
              }}
            >
              {t('evidence.selectEdge')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
