// 【なぜ】0.10.1 の反復関数には型定義がない。行列を保持し step の続きを計算する。
// 内部 API の変更を避けるため依存の版を固定する。
declare module 'graphology-layout-forceatlas2/iterate.js' {
  import type { ForceAtlas2Settings } from 'graphology-layout-forceatlas2';
  export default function iterate(
    settings: Required<ForceAtlas2Settings>,
    nodes: Float32Array,
    edges: Float32Array,
  ): void;
}

// 【なぜ】テストで 0.10.1 の実際の helpers の出力と手製の行列を照合するための型。
// 本体の算法にはこの関数を使わず、安定した並び順で同じ契約の行列を組み立てる。
declare module 'graphology-layout-forceatlas2/helpers.js' {
  import type Graph from 'graphology';
  export function graphToByteArrays(
    graph: Graph,
    getEdgeWeight: (edge: string, attrs: { readonly weight: number }) => number,
  ): { nodes: Float32Array; edges: Float32Array };
}
