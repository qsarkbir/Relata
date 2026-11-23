import {
  typeStyles,
  encodeNodeSizes,
  encodeEdgeWidths,
  encodeNodeColorsByCategory,
  encodeNodeColorsByNumber,
} from '../core/encode';
import type {
  EncodingSettings,
  CategoryValue,
  CategoryLegend,
  GradientLegend,
  ScaleLegend,
} from '../core/encode';
import { getAttr, toNodeId, toEdgeId } from '../core/model';
import type { Dataset, Missing, NodeId } from '../core/model';
import type { RelataGraph } from '../core/graph';
import type { SceneEncoding } from '../render';
/** 凡例を作るための、割り当ての要約（書き出しの凡例。FR-OUT-07）。 */
export interface EncodingLegends {
  /** 大きさの凡例。定数のときは null。 */
  readonly size: ScaleLegend | null;
  /** エッジの太さの凡例。定数のときは null。 */
  readonly width: ScaleLegend | null;
  /** 色の凡例。型の色のときは `nodeType`。 */
  readonly color:
    | { readonly kind: 'nodeType' }
    | { readonly kind: 'category'; readonly attr: string; readonly legend: CategoryLegend }
    | { readonly kind: 'gradient'; readonly metric: string; readonly legend: GradientLegend };
}

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
  return graphEncodingWithLegends(dataset, graph, settings).encoding;
}

/**
 * `graphEncoding` と同じ割り当てに、凡例の要約を添えて返す。
 *
 * 【なぜ】凡例は図と同じ割り当てから作る（食い違うと読み手が取り違える）。計算を二重に書かず、
 * 割り当ての関数が返す凡例の情報をそのまま渡す。
 * @param dataset - 元データ
 * @param graph - 絞り込みと集計後のグラフ
 * @param settings - 保存可能な見た目設定
 * @returns シーンの割り当てと、凡例の要約
 */
export function graphEncodingWithLegends(
  dataset: Dataset,
  graph: RelataGraph,
  settings: EncodingSettings,
): { readonly encoding: SceneEncoding; readonly legends: EncodingLegends } {
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
  let colorLegend: EncodingLegends['color'] = { kind: 'nodeType' };
  if (settings.nodeColor.kind === 'metric') {
    const byNumber = encodeNodeColorsByNumber(numeric('metric', settings.nodeColor.metric));
    colors = byNumber.colors;
    colorLegend = { kind: 'gradient', metric: settings.nodeColor.metric, legend: byNumber.legend };
  }
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
    const byCategory = encodeNodeColorsByCategory(
      new Map(ids.map((id) => [id, basis.get(id) ?? { kind: 'missing', reason: 'unrecorded' }])),
      basis,
    );
    colors = byCategory.colors;
    colorLegend = { kind: 'category', attr: key, legend: byCategory.legend };
  }
  return {
    encoding: {
      typeColors: styles.colors,
      shapes: styles.shapes,
      sizes: sizes.sizes,
      widths: widths.widths,
      ...(colors === undefined ? {} : { colors }),
    },
    legends: { size: sizes.legend, width: widths.legend, color: colorLegend },
  };
}
