/**
 * シーンの型（設計書 §8.1、D-31）。描画方式（SVG、Canvas）に依存しない「図形の一覧」。
 *
 * 画面表示と書き出しは、同じシーンから作る。そのため、画面と書き出した図は一致する。
 */
import type { NodeId, NodeShape } from '../../core/model';
import type { TextDirection } from '../text/direction';
import type { EdgeGeometry, EdgePoint } from '../edges/geometry';

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
  /** 欠損の印（FR-VG-12）。大きさ・色の値の欠損、または指定した属性の欠損のとき true。 */
  readonly dashed: boolean;
  /**
   * 「欠損の表示」で指定した属性の欠損による破線か。true なら、値の欠損による破線と間隔を変えて描く。
   * 【なぜ】2 つの意味の破線を、図の上で見分けられるようにするため（FR-VG-12）。
   */
  readonly attrMissing?: boolean;
  /** 選択の強調を書き出しに含める指定のとき、選択中のノードだけ true。 */
  readonly selected: boolean;
  /**
   * 再生の時刻の外（D-38）。true なら薄く描く（消さない）。`markOutOfTime` が付ける。
   * 【なぜ】座標やラベルの配置を変えずに、描くときの不透明度だけを変えるため。
   */
  readonly faded?: boolean;
}

/**
 * シーンのエッジ 1 本。まとめた後のエッジ（グラフのエッジ）に対応する。
 * 矢じり・先細り・濃淡の幾何は EdgeGeometry にまとめる。
 */
export interface SceneEdge extends EdgeGeometry {
  /** グラフのエッジのキー。 */
  readonly id: string;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly path: readonly PathCommand[];
  readonly width: number;
  readonly color: string;
  readonly opacity: number;
  readonly directed: boolean;
  /** 重みが欠損のエッジ、または指定した属性が欠損しているエッジ。 */
  readonly dashed: boolean;
  /** 指定した属性の欠損による破線か（ノードの `attrMissing` と同じ。間隔を変えて描く）。 */
  readonly attrMissing?: boolean;
  /** 再生の時刻の外（D-38）。true なら薄く描く。 */
  readonly faded?: boolean;
  /**
   * 束ねた描画（FR-VG-13、14）のときの役割。`overlay` は簡易版の線、`highlight` は選んだノードのエッジの強調線、
   * `missing` は欠損のエッジの破線（どちらも帯の上に引く）。通常のエッジは省略。
   */
  readonly role?: 'overlay' | 'highlight' | 'missing';
}

/** 帯（束ねた描き方 `bands`）の、エッジ 1 本分のリボン。不透明で塗り、層全体に不透明度を掛ける。 */
export interface SceneBundleRibbon {
  /** グラフのエッジのキー。 */
  readonly edgeId: string;
  /** リボンの多角形（左側の列、右側の列の逆順）。 */
  readonly polygon: readonly EdgePoint[];
  /** 矢印のときの矢じり。 */
  readonly head?: readonly EdgePoint[];
  /** 再生の時刻の外（D-38）。薄い層に分けて描く。 */
  readonly faded?: boolean;
}

/** 束ねた帯の層。`style` が `overlay` のときは `ribbons` は空で、線は `Scene.edges`（`role: 'overlay'`）にある。 */
export interface SceneBundle {
  readonly style: 'bands' | 'overlay';
  /** 帯の色（`#rrggbb`）。 */
  readonly color: string;
  /** 帯の層全体の不透明度。 */
  readonly opacity: number;
  readonly ribbons: readonly SceneBundleRibbon[];
  /** 太さの目盛り（凡例用）。幅 = maxWidth × スケール(W / maxWeight)、下限 minWidth。 */
  readonly widthScale: {
    readonly kind: 'linear' | 'sqrt' | 'log';
    readonly maxWeight: number;
    readonly maxWidth: number;
    readonly minWidth: number;
  };
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
  /** 再生の時刻の外のノードのラベル（D-38）。true なら薄く描く。 */
  readonly faded?: boolean;
}

/**
 * 凡例の見本の種類。`node` はノードの図形、`line` は線、`arrow` は矢じり付きの線、
 * `taper` は先細りの帯（始点が太く終点が細い）、`gradient` は濃淡の線（終点が濃い）、
 * `none` は見本なしの文字だけの行（見出し、出典表記）。
 */
export type LegendMark = 'node' | 'line' | 'arrow' | 'taper' | 'gradient' | 'none';

/** 凡例の 1 項目。見本の図形と文字。 */
export interface SceneLegendItem {
  readonly swatch: {
    readonly x: number;
    readonly y: number;
    /** `node` は半径。`line`、`arrow` は線の長さの半分。 */
    readonly r: number;
    readonly shape: NodeShape;
    readonly fill: string;
    readonly dashed: boolean;
    /** 見本の種類。 */
    readonly mark: LegendMark;
    /** 指定した属性の欠損の破線か（間隔を変える。`dashed` が true のときだけ意味を持つ）。 */
    readonly attrMissing?: boolean;
    /** 線の見本（`line`、`arrow`、`taper`、`gradient`）の太さ（px）。矢じりの大きさは、エッジと同じ式でこの太さから決める。 */
    readonly lineWidth?: number;
    /** 線の見本の不透明度（0 から 1）。省略は 1。図のエッジと同じ見え方にするために使う。 */
    readonly opacity?: number;
  };
  readonly label: SceneLabel;
  /** 見出しとして太字にするか。 */
  readonly bold?: boolean;
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
  /** 描けなかった自己ループの数。T1-12 以降は輪で描くため通常 0。 */
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
  /** 束ねた帯の層（FR-VG-13、14）。束ねないときは無い。エッジの前（下）に描く。 */
  readonly bundle?: SceneBundle;
  readonly labels: readonly SceneLabel[];
  /** 重なりのために隠したラベルのノード ID。データを除外した意味ではない。 */
  readonly hiddenLabels?: readonly NodeId[];
  readonly legend?: SceneLegend;
  readonly omitted: SceneOmitted;
}
