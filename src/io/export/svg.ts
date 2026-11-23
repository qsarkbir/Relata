/** SVG ファイルの組み立てと保存（FR-OUT-01、D-31）。 */
import type { RelataGraph } from '../../core/graph';
import type { NodeId } from '../../core/model';
import { buildScene, renderSvg } from '../../render';
import type { Scene } from '../../render';
import { downloadBlob, withExtension } from './download';
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
  /** 書き出しに使ったシーン。PNG と PDF は、このシーンから作る（画面と書き出しを一致させる）。 */
  readonly scene: Scene;
  /** SVG の文字列（XML 宣言なし）。PNG への変換に使う。 */
  readonly svg: string;
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
  return { blob, scene, svg, width: scene.width, height: scene.height, omitted: scene.omitted };
}

/**
 * SVG をDOMが使えるブラウザ内でダウンロードする。利用者のデータは外部に送らない。
 *
 * document と URL.createObjectURL を利用するため、DOMのないNode.jsやWorkerからは呼ばない。
 * @param exported - createSvgExport の結果
 * @param fileName - 保存名。前後の空白を除き、省略・空白のみなら relata.svg。拡張子が無ければ .svg を付ける
 */
export function downloadSvg(exported: SvgExport, fileName = 'relata.svg'): void {
  downloadBlob(exported.blob, withExtension(fileName, 'svg'));
}
