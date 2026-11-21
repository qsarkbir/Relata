import {
  typeStyles,
  encodeNodeSizes,
  encodeEdgeWidths,
  encodeNodeColorsByCategory,
  encodeNodeColorsByNumber,
} from '../core/encode';
import type { EncodingSettings, CategoryValue } from '../core/encode';
import { getAttr, toNodeId, toEdgeId } from '../core/model';
import type { Dataset, Missing, NodeId } from '../core/model';
import type { RelataGraph } from '../core/graph';
import type { SceneEncoding } from '../render';
/**
 * UIの割当設定を、現在のグラフの数値と元データからシーンへ接続する。
 * @param dataset - 元データ。カテゴリの色の基準集合もここから求める
 * @param graph - 絞り込みと集計後のグラフ
 * @param settings - 保存可能な見た目設定
 * @returns シーンへ渡すサイズ・色・形・太さ
 */
export function graphEncoding(
  dataset: Dataset,
  graph: RelataGraph,
  settings: EncodingSettings,
): SceneEncoding {
  const styles = typeStyles(dataset.nodeTypes, settings.nodeShape);
  const ids = graph.nodes().map(toNodeId);
  const nodes = new Map(dataset.nodes.map((node) => [node.id, node]));
  const numeric = (kind: 'attr' | 'metric', key: string): Map<NodeId, number | Missing> =>
    new Map<NodeId, number | Missing>(
      ids.map((id) => {
        if (kind === 'metric') {
          const value =
            key === 'degree'
              ? graph.degree(id)
              : key === 'inDegree'
                ? graph.inDegree(id)
                : key === 'outDegree'
                  ? graph.outDegree(id)
                  : undefined;
          return [id, value ?? { kind: 'missing', reason: 'unrecorded' }];
        }
        const node = nodes.get(id);
        const attr = node === undefined ? undefined : getAttr(node.attrs, key);
        if (attr?.kind === 'missing') return [id, attr];
        if (attr?.kind === 'value') {
          const values = Array.isArray(attr.value) ? attr.value : [attr.value];
          if (
            values.length > 0 &&
            values.every((value) => typeof value === 'number' && Number.isFinite(value))
          ) {
            let sum = 0;
            for (const value of values) if (typeof value === 'number') sum += value;
            return [id, sum];
          }
        }
        return [id, { kind: 'missing', reason: 'unrecorded' }];
      }),
    );
  const source = settings.nodeSize.source;
  const sizes = encodeNodeSizes(
    ids,
    source.kind === 'constant'
      ? new Map()
      : numeric(source.kind, source.kind === 'attr' ? source.attr : source.metric),
    settings.nodeSize,
  );
  const widths = encodeEdgeWidths(
    graph.edges().map((id) => ({ id: toEdgeId(id), weight: graph.getEdgeAttribute(id, 'weight') })),
    settings.edgeWidth,
  );
  let colors: SceneEncoding['colors'];
  if (settings.nodeColor.kind === 'metric')
    colors = encodeNodeColorsByNumber(numeric('metric', settings.nodeColor.metric)).colors;
  if (settings.nodeColor.kind === 'attr') {
    const key = settings.nodeColor.attr;
    const basis = new Map<NodeId, CategoryValue>(
      dataset.nodes.map((node) => {
        const attr = getAttr(node.attrs, key);
        return [
          node.id,
          attr?.kind === 'value'
            ? Array.isArray(attr.value)
              ? attr.value
              : [attr.value]
            : attr?.kind === 'missing'
              ? attr
              : { kind: 'missing', reason: 'unrecorded' },
        ];
      }),
    );
    colors = encodeNodeColorsByCategory(
      new Map(ids.map((id) => [id, basis.get(id) ?? { kind: 'missing', reason: 'unrecorded' }])),
      basis,
    ).colors;
  }
  return {
    typeColors: styles.colors,
    shapes: styles.shapes,
    sizes: sizes.sizes,
    widths: widths.widths,
    ...(colors === undefined ? {} : { colors }),
  };
}
