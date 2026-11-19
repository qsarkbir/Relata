/**
 * シーンの型（設計書 §8.1、D-31）。描画方式（SVG、Canvas）に依存しない「図形の一覧」。
 *
 * 画面表示と書き出しは、同じシーンから作る。そのため、画面と書き出した図は一致する。
 */
import type { NodeId, NodeShape } from '../../core/model';
import type { TextDirection } from '../text/direction';

/**
 * 経路の命令。T1-11 は `M` と `L`（直線）だけを使い、`Q`（2 次ベジェ）は T1-12 の往復エッジの弧のために持っておく。
 */
// 【TS】判別共用体。`type` の値で、持つ座標が決まる。
export type PathCommand =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | {
      readonly type: 'Q';
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    };

// 【なぜ】判定は text/direction.ts にあるので、型もそこで定義して再 export する。
export type { TextDirection } from '../text/direction';

/** シーンのノード 1 つ。座標は図の左上を原点とする（余白を含む）。 */
export interface SceneNode {
  readonly id: NodeId;
  readonly x: number;
  readonly y: number;
  /** 公称の半径（px）。円はこの半径。他の形は面積をそろえる（`shapeExtent` が外接円の半径を返す）。 */
  readonly r: number;
  readonly shape: NodeShape;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  /** 欠損の印（FR-VG-12）。 */
  readonly dashed: boolean;
  /** 選択の強調を書き出しに含める指定のとき、選択中のノードだけ true。 */
  readonly selected: boolean;
}

/**
 * シーンのエッジ 1 本。まとめた後のエッジ（グラフのエッジ）に対応する。
 * 矢じり（`head`）と先細りは T1-12 で足す。
 */
export interface SceneEdge {
  /** グラフのエッジのキー。 */
  readonly id: string;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly path: readonly PathCommand[];
  readonly width: number;
  readonly color: string;
  readonly opacity: number;
  readonly directed: boolean;
  /** 重みが欠損のエッジ。 */
  readonly dashed: boolean;
}

/** ラベル 1 つ。座標は文字の基準点で、`anchor` が基準点と文字の位置関係を決める。 */
export interface SceneLabel {
  /** ラベルが属するノード。凡例の文字は null。 */
  readonly nodeId: NodeId | null;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly direction: TextDirection;
  /**
   * x が文字列のどちらの端か（物理的な向き）。左から右のラベルは `left`（右へ伸びる）、
   * 右から左のラベルは `right`（ノードの左側に置き、左へ伸びる）。
   * SVG の `text-anchor` は `direction` によって start と end の意味が入れ替わるので、
   * `renderSvg` が変換する。
   */
  readonly anchor: 'left' | 'right';
}

/** 凡例の 1 項目。見本の図形と文字。 */
export interface SceneLegendItem {
  readonly swatch: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly shape: NodeShape;
    readonly fill: string;
    readonly dashed: boolean;
  };
  readonly label: SceneLabel;
}

/** 凡例。図の右側に置く。 */
export interface SceneLegend {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title?: SceneLabel;
  readonly items: readonly SceneLegendItem[];
}

/** 位置が無い、などの理由でシーンに入れなかったものの報告。 */
export interface SceneOmitted {
  /** 位置が無い（または有限でない）ノード。シーンに入れていない。 */
  readonly nodesWithoutPosition: readonly NodeId[];
  /** 端点のノードがシーンに無いので入れなかったエッジの数。 */
  readonly edgesWithoutEndpoint: number;
  /** 自己ループの数。描き方は T1-12 で決める（R-09）ので、今は入れていない。 */
  readonly selfLoops: number;
  /** `widths` に値があるのに、グラフのエッジのキーと 1 件も一致しなかった（元の EdgeId で引いた Map を渡した誤りの疑い）。 */
  readonly widthsUnmatched: boolean;
}

/** シーン。`width`、`height` は図全体の大きさ（余白と凡例を含む）。 */
export interface Scene {
  readonly width: number;
  readonly height: number;
  /** 文字のフォント。測定と描画で同じものを使う。 */
  readonly fontFamily: string;
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly labels: readonly SceneLabel[];
  readonly legend?: SceneLegend;
  readonly omitted: SceneOmitted;
}
