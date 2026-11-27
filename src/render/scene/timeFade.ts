/**
 * 再生の時刻の外にある図形に「薄く描く」印を付ける（FR-TM-02、D-38）。
 *
 * 配置、ラベル、色は変えない。印を付けるだけなので、再生の 1 コマごとに呼んでも軽い（O(ノード + エッジ +
 * ラベル)）。どの要素が時刻の外かの判定は core（`outOfTime`）の仕事で、ここは ID の集合を受け取って
 * 印を付けるだけ。React にも DOM にも依存しない。
 */
import type { Scene } from './types';

/** 薄く描くときの不透明度。消さず、輪郭と位置は読める濃さ。 */
export const FADED_OPACITY = 0.2;

/**
 * シーンの要素に、時刻の外の印（`faded`）を付けた新しいシーンを返す。
 *
 * 何も薄くしないとき（両方の集合が空）は、同じシーンをそのまま返す（参照を保ち、無駄な再描画を避ける）。
 *
 * @param scene - シーン
 * @param nodes - 薄くするノードの ID
 * @param edges - 薄くするエッジのキー（グラフのエッジのキー）
 * @returns 印を付けたシーン
 */
export function markOutOfTime(
  scene: Scene,
  nodes: ReadonlySet<string>,
  edges: ReadonlySet<string>,
): Scene {
  if (nodes.size === 0 && edges.size === 0) return scene;
  return {
    ...scene,
    nodes: scene.nodes.map((n) => (nodes.has(n.id) ? { ...n, faded: true } : n)),
    edges: scene.edges.map((e) => (edges.has(e.id) ? { ...e, faded: true } : e)),
    // 【なぜ】束ねた帯（FR-VG-13）も、エッジのキーで薄くする。薄いリボンは、別の層にまとめて描かれる。
    ...(scene.bundle === undefined
      ? {}
      : {
          bundle: {
            ...scene.bundle,
            ribbons: scene.bundle.ribbons.map((r) =>
              edges.has(r.edgeId) ? { ...r, faded: true } : r,
            ),
          },
        }),
    // 【なぜ】ラベルも、ノードと一緒に薄くする。凡例の文字（nodeId が null）は薄くしない。
    labels: scene.labels.map((l) =>
      l.nodeId !== null && nodes.has(l.nodeId) ? { ...l, faded: true } : l,
    ),
  };
}
