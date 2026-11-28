/** 地図のシーンから deck.gl の描画の層を作る（FR-MP-02、D-54）。 */
import type { Color, LayersList } from '@deck.gl/core';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { NodeId } from '../core/model';
import type { EdgePoint } from '../render/edges/geometry';
import type { SceneEdge, SceneNode } from '../render/scene/types';
import { edgeDash, MISSING_TAPER_FILL_OPACITY, nodeDash } from '../render/scene/missingStyle';
import { toDeckPosition, type MapNetwork, type MapScene } from './scene';

/** 地図上でクリックしたもの。エッジは集約・射影後のグラフのキー。 */
export type MapPick =
  { readonly kind: 'node'; readonly id: NodeId } | { readonly kind: 'edge'; readonly id: string };

// 【なぜ】loadOptions は MapboxOverlay の設定ではなく、loaders.gl を呼ぶ層ごとの設定。
// core.worker は現行の設定名、worker は旧版の設定名。どちらも切り、外部の Worker 取得を防ぐ（NFR-02）。
const LAYER_PROPS = {
  coordinateSystem: 'cartesian',
  positionFormat: 'XY',
  loadOptions: { worker: false, core: { worker: false } },
  pickable: true,
} as const;

const PATH_DASH = new PathStyleExtension({ dashMode: 'path' });
const OUTLINE_DASH = new PathStyleExtension({ dash: true });
const SOLID: readonly [number, number] = [0, 0];
type SelectedFeatures = Pick<MapNetwork, 'selected' | 'selectedEdgeKeys'>;

interface Line {
  readonly pick: MapPick;
  readonly path: [number, number][];
  readonly color: Color | Color[];
  readonly width: number;
}
interface DashedLine extends Line {
  readonly dash: readonly [number, number];
}
interface Area {
  readonly pick: MapPick;
  readonly polygon: [number, number][];
  readonly color: Color;
}
interface Dot {
  readonly pick: MapPick;
  readonly position: [number, number];
  readonly node: SceneNode;
}

function rgba(hex: string, opacity = 1): [number, number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    Math.round(opacity * 255),
  ];
}

// 二次ベジェ曲線を折れ線にする。中央での弦からのずれを基準に、1 px 未満になる分割数を選ぶ。
// 【なぜ】分割数を最大 64 にし、全世界にわたる曲線を拡大しても頂点数が増え続けないようにする。
function samplePath(edge: SceneEdge): EdgePoint[] {
  const points: EdgePoint[] = [];
  for (const p of edge.path) {
    const previous = points.at(-1);
    const count =
      p.type === 'Q' && previous !== undefined
        ? Math.min(
            64,
            Math.ceil(
              Math.sqrt(Math.hypot(2 * p.cx - previous.x - p.x, 2 * p.cy - previous.y - p.y) / 4),
            ),
          )
        : edge.gradient !== undefined && edge.path.length === 2
          ? 24
          : 1;
    if (previous !== undefined)
      for (let step = 1; step < count; step++) {
        const t = step / count;
        const u = 1 - t;
        points.push(
          p.type === 'Q'
            ? {
                x: u * u * previous.x + 2 * u * t * p.cx + t * t * p.x,
                y: u * u * previous.y + 2 * u * t * p.cy + t * t * p.y,
              }
            : { x: u * previous.x + t * p.x, y: u * previous.y + t * p.y },
        );
      }
    points.push({ x: p.x, y: p.y });
  }
  return points;
}

function edgeColor(edge: SceneEdge, network: SelectedFeatures): string {
  // 束に欠損の破線と選択の強調を重ねるときは、色が同じだと破線が強調線に埋もれる。
  if (edge.role === 'missing') return edge.color;
  if (network.selectedEdgeKeys.has(edge.id)) return '#191919';
  if (network.selected.has(edge.source)) return '#2166ac';
  if (network.selected.has(edge.target)) return edge.directed ? '#a54232' : '#2166ac';
  return edge.color;
}

function pathColors(
  edge: SceneEdge,
  path: readonly EdgePoint[],
  color: string,
  opacity: number,
): Color | Color[] {
  const g = edge.gradient;
  if (g === undefined) return rgba(color, opacity);
  const dx = g.end.x - g.start.x;
  const dy = g.end.y - g.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return rgba(color, opacity);
  // SVG の userSpaceOnUse の線形グラデーションと同じく、始点→終点の軸に射影して濃さを決める。
  return path.map((p) => {
    const t = ((p.x - g.start.x) * dx + (p.y - g.start.y) * dy) / lengthSquared;
    return rgba(color, opacity * (0.15 + 0.85 * Math.max(0, Math.min(1, t))));
  });
}

/**
 * 形を WebGL の層に割り当てる。線の幅と点の半径は画面の px。
 *
 * @param scene - ズームが確定したときの地図のシーン
 * @param network - 選択中のノードとエッジ
 * @returns 束、線、多角形、点の順に描く層
 */
export function networkLayers(scene: MapScene, network: SelectedFeatures): LayersList {
  const scale = 2 ** scene.zoom;
  const project = (p: EdgePoint): [number, number] => toDeckPosition(p, scale);
  const lines: Line[] = [];
  const dashed: DashedLine[] = [];
  const areas: Area[] = [];
  for (const edge of scene.edges) {
    const pick: MapPick = { kind: 'edge', id: edge.id };
    const color = edgeColor(edge, network);
    const opacity = color === edge.color ? edge.opacity : 1;
    if (edge.ribbon === undefined && edge.width > 0) {
      const path = samplePath(edge);
      if (path.length >= 2) {
        const line = {
          pick,
          path: path.map(project),
          color: pathColors(edge, path, color, opacity),
          width: edge.width,
        };
        if (edge.dashed) dashed.push({ ...line, dash: edgeDash(edge.attrMissing === true) });
        else lines.push(line);
      }
    }
    if (edge.head !== undefined && edge.head.length >= 3) {
      areas.push({ pick, polygon: edge.head.map(project), color: rgba(color, opacity) });
    }
    if (edge.ribbon !== undefined && edge.ribbon.length >= 3) {
      const polygon = edge.ribbon.map(project);
      const fillOpacity = edge.dashed ? opacity * MISSING_TAPER_FILL_OPACITY : opacity;
      areas.push({ pick, polygon, color: rgba(color, fillOpacity) });
      // SVG と同じく先細りの形を残し、輪郭を破線で示す。
      const first = polygon[0];
      if (edge.dashed && first !== undefined)
        dashed.push({
          pick,
          path: [...polygon, first],
          color: rgba(color, opacity),
          width: 1,
          dash: edgeDash(edge.attrMissing === true),
        });
    }
  }
  const bands: Area[] = [];
  const bundle = scene.bundle;
  if (bundle !== undefined) {
    const color = rgba(bundle.color, bundle.opacity);
    for (const ribbon of bundle.ribbons) {
      const pick: MapPick = { kind: 'edge', id: ribbon.edgeId };
      for (const polygon of [ribbon.polygon, ribbon.head]) {
        if (polygon !== undefined && polygon.length >= 3)
          bands.push({ pick, polygon: polygon.map(project), color });
      }
    }
  }
  return [
    new SolidPolygonLayer<Area>({
      ...LAYER_PROPS,
      id: 'map-bundle-bands',
      data: bands,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      // 【なぜ】同じ色の帯が重なっても濃くならないよう透明な canvas の色を上書きする。
      // RGB は不透明度を掛けて格納し、透明な地図の canvas に通常どおり合成できるようにする。
      parameters: { blendColorDstFactor: 'zero', blendAlphaDstFactor: 'zero' },
    }),
    new PathLayer<Line>({
      ...LAYER_PROPS,
      id: 'map-edge-paths',
      data: lines,
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: (d) => d.width,
      widthUnits: 'pixels',
      jointRounded: true,
    }),
    new SolidPolygonLayer<Area>({
      ...LAYER_PROPS,
      id: 'map-edge-heads-and-tapers',
      data: areas,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
    }),
    new PathLayer<DashedLine, PathStyleExtensionProps<DashedLine>>({
      ...LAYER_PROPS,
      id: 'map-edge-missing-paths',
      data: dashed,
      extensions: [PATH_DASH],
      getPath: (d) => d.path,
      getColor: (d) => d.color,
      getWidth: (d) => d.width,
      getDashArray: (d) => d.dash,
      widthUnits: 'pixels',
      dashUnits: 'pixels',
      dashGapPickable: true,
      jointRounded: true,
    }),
    new ScatterplotLayer<Dot, PathStyleExtensionProps<Dot>>({
      ...LAYER_PROPS,
      id: 'map-nodes',
      data: scene.nodes.map((node): Dot => ({
        pick: { kind: 'node', id: node.id },
        position: project(node),
        node,
      })),
      extensions: [OUTLINE_DASH],
      stroked: true,
      radiusUnits: 'pixels',
      lineWidthUnits: 'pixels',
      getPosition: (d) => d.position,
      // ScatterplotLayer は線幅の半分を半径の外に足す。縁での切断と同じ外接半径になる。
      getRadius: (d) => d.node.r,
      getFillColor: (d) => rgba(d.node.fill),
      getLineColor: (d) => rgba(d.node.stroke),
      getLineWidth: (d) => d.node.strokeWidth,
      getDashArray: ({ node }) => {
        if (!node.dashed || node.strokeWidth <= 0) return SOLID;
        const [dash, gap] = nodeDash(node.attrMissing === true);
        // ScatterplotLayer の破線は線幅を単位とするので、SVG の px を線幅で割る。
        return [dash / node.strokeWidth, gap / node.strokeWidth];
      },
    }),
  ];
}
