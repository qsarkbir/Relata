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
