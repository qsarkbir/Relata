/** SVG ファイルの組み立てと保存（FR-OUT-01、D-31）。 */
import type { RelataGraph } from '../../core/graph';
import type { NodeId } from '../../core/model';
import { buildScene, renderSvg } from '../../render';
import type { BuildSceneOptions, SceneEncoding, SceneOmitted } from '../../render';

/** SVG の書き出し設定。画面のズームやパンは受け取らず、常に全体を収める。 */
export interface SvgExportOptions extends BuildSceneOptions {
  /** 背景色。省略すると透明。 */
  readonly background?: string;
  /** SVG 内の題名。 */
  readonly title?: string;
  /** 他の図と同じ文書に貼るときの id の接頭辞。 */
  readonly idPrefix?: string;
}

/** 保存する SVG と、図に含められなかったものの報告。 */
export interface SvgExport {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly omitted: SceneOmitted;
}

/**
 * グラフの全体から、UTF-8 の SVG ファイルを作る。
 *
 * 画面のシーンを使い回さず、同じ位置・割り当てから書き出し用に組み立て直す。
 * 【なぜ】画面で選択を強調していても、既定のファイルには含めないため（D-31）。
 * ノード、エッジ、ラベル、凡例は既存 renderSvg のグループ構造をそのまま使う。
 * フォントファイルは埋め込まない。編集先には指定フォントまたは代替フォントが必要。
 * 計算量は buildScene と同じ O(N log N + E)。
 * @param graph - 絞り込み後のグラフ
 * @param positions - レイアウトのノード位置
 * @param encoding - 見た目の割り当て
 * @param options - 余白、凡例、選択の強調など
 * @returns ファイルと寸法、図から省いた要素の報告
 */
export function createSvgExport(
  graph: RelataGraph,
  positions: ReadonlyMap<NodeId, { readonly x: number; readonly y: number }>,
  encoding: SceneEncoding = {},
  options: SvgExportOptions = {},
): SvgExport {
  const scene = buildScene(graph, positions, encoding, options);
  const svg = renderSvg(scene, options);
  // 【なぜ】外部の CSS や画面の transform を使わない、単独で開ける文書にする。
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', svg], {
    type: 'image/svg+xml;charset=utf-8',
  });
  return { blob, width: scene.width, height: scene.height, omitted: scene.omitted };
}

/**
 * SVG をブラウザ内でダウンロードする。利用者のデータは外部に送らない。
 * @param exported - createSvgExport の結果
 * @param fileName - 保存名（省略時 relata.svg）。拡張子が無ければ .svg を付ける
 */
export function downloadSvg(exported: SvgExport, fileName = 'relata.svg'): void {
  const url = URL.createObjectURL(exported.blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = /\.svg$/iu.test(fileName) ? fileName : fileName + '.svg';
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    // 【なぜ】クリック直後の解放で保存が中断される環境がある。既存のプロジェクト保存と同じ猶予を置く。
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10_000);
  }
}
