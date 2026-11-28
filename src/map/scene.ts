/** 地図のシーン（FR-MP-02、D-54）。地図と SVG の書き出しで同じ平面上の図形を使う。 */
import { mercator } from '../core/layout/geo';
import type { RelataGraph } from '../core/graph';
import type { NodeId } from '../core/model';
import type { MapEdgeDirection, MapEdgeShape, MapLabels, MapViewport } from '../core/project';
import type { EdgePoint } from '../render/edges/geometry';
import { buildSceneNetwork, layoutNodeLabels, type SceneEncoding } from '../render/scene/build';
import type { SceneBundling } from '../render/scene/bundled';
import type { SceneLabel, SceneNode } from '../render/scene/types';
import { WORLD_SIZE_AT_ZOOM_0 } from './viewport';

/** 地図のデータと表示設定。座標は `mercator` の単位（経度 1 度 = 1）で、北が上。 */
export interface MapNetwork {
  readonly graph: RelataGraph;
  readonly positions: ReadonlyMap<NodeId, EdgePoint>;
  readonly encoding: SceneEncoding;
  readonly selected: ReadonlySet<NodeId>;
  readonly selectedEdgeKeys: ReadonlySet<string>;
  readonly direction: MapEdgeDirection;
  readonly edgeShape: MapEdgeShape;
  readonly labels: MapLabels;
  readonly bundled?: SceneBundling;
}

/** 位置は赤道と本初子午線の交点を原点とした、確定したズームでの平面メルカトルの px。 */
export interface MapScene extends ReturnType<typeof buildSceneNetwork> {
  readonly zoom: number;
}

const POINT_SHAPES: NonNullable<SceneEncoding['shapes']> = new Map();

function pixelsPerDegree(zoom: number): number {
  return (WORLD_SIZE_AT_ZOOM_0 / 360) * 2 ** zoom;
}

/**
 * 指定のズームでノードの縁までの経路、矢じり、束の幅を作る。パンや枠の大きさで図形は変わらない。
 *
 * @param network - グラフと、ズームに依らないメルカトルの座標
 * @param zoom - MapLibre と共通のズーム
 * @returns Web メルカトル上の図形。半径・線幅は px
 */
export function buildMapScene(network: MapNetwork, zoom: number): MapScene {
  const { graph, positions, encoding, selected, selectedEdgeKeys, direction, edgeShape, bundled } =
    network;
  // 【なぜ】地図ではすべてのノードを点で描く。色・大きさ・エッジ幅の割当はグラフと同じものを使う。
  return {
    ...buildSceneNetwork(
      graph,
      positions,
      { ...encoding, shapes: POINT_SHAPES },
      {
        zoom: pixelsPerDegree(zoom),
        includeSelection: true,
        selected,
        selectedEdgeKeys,
        directedStyle: direction,
        edgeShape,
        ...(bundled === undefined ? {} : { bundled }),
      },
    ),
    zoom,
  };
}

/**
 * シーンの点を deck.gl の Mercator 共通座標に変換する。deck.gl は南を y=0、経度 −180° を x=0 とする。
 *
 * @param p - 地図のシーンの点
 * @param scale - シーンが使うズームの倍率（2 の累乗）
 * @returns deck.gl の平面上の座標。世界の幅は 512 単位
 */
export function toDeckPosition(p: EdgePoint, scale: number): [number, number] {
  return [WORLD_SIZE_AT_ZOOM_0 / 2 + p.x / scale, WORLD_SIZE_AT_ZOOM_0 / 2 - p.y / scale];
}

/**
 * 今の画面に見えるノードを基準にラベルを置く。描画中のズームでも文字とノード半径は px のまま使う。
 *
 * @param scene - 確定したズームでのシーン
 * @param network - ラベルの設定とグラフ
 * @param viewport - 現在のカメラ
 * @param size - 地図の枠（px）
 * @param textWidth - 文字の幅を測る関数
 * @returns 画面座標で配置したラベル
 */
export function mapLabels(
  scene: MapScene,
  network: MapNetwork,
  viewport: MapViewport,
  size: { readonly width: number; readonly height: number },
  textWidth: (text: string) => number,
): readonly SceneLabel[] {
  if (network.labels === 'none' || size.width === 0 || size.height === 0) return [];
  const center = mercator(viewport);
  const centerScale = pixelsPerDegree(viewport.zoom);
  const scale = 2 ** (viewport.zoom - scene.zoom);
  const dx = size.width / 2 - center.x * centerScale;
  const dy = size.height / 2 - center.y * centerScale;
  const visible: SceneNode[] = [];
  for (const n of scene.nodes) {
    if (network.labels === 'selected' && !network.selected.has(n.id)) continue;
    const x = n.x * scale + dx;
    const y = n.y * scale + dy;
    // 枠の外のノードのラベルは、画面内のラベルの配置を妨げないよう先に外す。
    if (x + n.r < 0 || y + n.r < 0 || x - n.r > size.width || y - n.r > size.height) continue;
    visible.push({ ...n, x, y });
  }
  return layoutNodeLabels(network.graph, visible, textWidth, {
    labels: 'all',
  }).visible;
}
