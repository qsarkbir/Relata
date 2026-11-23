/**
 * 「書き出し」の各形式の実行（FR-OUT-01、03、04、05）。画面の部品から呼ぶ、React に依存しない関数。
 *
 * 図（SVG・PNG・PDF）は、グラフの部品が登録した「図の作り手」（figureExport.ts）が返す同じシーンから作る。
 * 利用者のデータはブラウザの外に送らない（NFR-02）。PDF のフォントも、このサイトから読み込む。
 */
import type { RelataGraph } from '../../core/graph';
import type { Dataset } from '../../core/model';
import {
  createPdf,
  downloadBlob,
  exportGexf,
  exportGraphml,
  loadPdfShaper,
  renderPng,
  withExtension,
} from '../../io/export';
import type { PngSize } from '../../io/export';
import { renderSvg } from '../../render';
import type { FigureRequest, FigureSource } from '../figureExport';

/**
 * 今日の日付（利用者の地域の暦）を `YYYY-MM-DD` にする。
 *
 * 【なぜ】出典表記の作成日。core は Date を使わない規約なので、views で作って渡す。
 * `toISOString` は UTC なので、夜に書き出すと日付がずれる。地域の年月日を使う。
 *
 * @param now - 現在の時刻
 * @returns 例: `2026-11-23`
 */
export function localDateString(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * ファイル名の基にする名前を作る。
 *
 * ASCII の英数字と `-`、`_`、`.` 以外は `_` にする。読み取れる文字が無ければ `relata`。
 * 【なぜ】非 ASCII のファイル名は、環境によって名前が失われる（プロジェクトの保存と同じ理由）。
 *
 * @param title - データの題名
 * @param date - 作成日
 * @returns 拡張子なしの名前
 */
export function exportBaseName(title: string, date: string): string {
  const cleaned = title
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 60);
  return `${/[A-Za-z0-9]/.test(cleaned) ? cleaned : 'relata'}-${date}`;
}

/** 図の書き出しの選択。 */
export interface FigureChoices {
  readonly legend: boolean;
  readonly credit: boolean;
  readonly pngScale: number;
  /** PDF のフォントのフォルダの URL。 */
  readonly fontBaseUrl: string;
  /** フォントの読み込みの進み（0 から 1）。 */
  readonly onFontProgress?: (fraction: number) => void;
  /** PDF の作成に入った（フォントの読み込みが終わった）ことを知らせる。 */
  readonly onMaking?: () => void;
}

/** 図の書き出しの結果。画面に知らせる内容。 */
export interface FigureOutcome {
  /** PNG で、上限のために倍率を下げたとき、その大きさ。 */
  readonly clamped?: PngSize;
}

/**
 * 図を SVG で書き出す。
 *
 * @param source - 図の作り手
 * @param choices - 選択
 * @param date - 作成日
 * @returns 画面に知らせる内容
 */
export function exportSvgFigure(
  source: FigureSource,
  choices: FigureChoices,
  date: string,
): FigureOutcome {
  const figure = source.build(request(choices, date));
  downloadBlob(figure.blob, withExtension(exportBaseName(source.title, date), 'svg'));
  return {};
}

function request(choices: FigureChoices, date: string): FigureRequest {
  return { legend: choices.legend, credit: choices.credit, createdAt: date };
}

/**
 * 図を PNG で書き出す。
 *
 * @param source - 図の作り手
 * @param choices - 選択（倍率を含む）
 * @param date - 作成日
 * @returns 倍率を下げたときの知らせ
 */
export async function exportPngFigure(
  source: FigureSource,
  choices: FigureChoices,
  date: string,
): Promise<FigureOutcome> {
  const figure = source.build(request(choices, date));
  // 【なぜ】PNG は透明より白の背景を既定にする（論文や発表の資料に貼るため）。
  const svg = renderSvg(figure.scene, { background: '#ffffff', title: source.title });
  const result = await renderPng(svg, figure.width, figure.height, choices.pngScale);
  downloadBlob(result.blob, withExtension(exportBaseName(source.title, date), 'png'));
  return result.size.clamped ? { clamped: result.size } : {};
}

/**
 * 図を PDF で書き出す。フォントは初回だけ、このサイトから読み込む。
 *
 * @param source - 図の作り手
 * @param choices - 選択
 * @param date - 作成日
 * @returns 画面に知らせる内容
 */
export async function exportPdfFigure(
  source: FigureSource,
  choices: FigureChoices,
  date: string,
): Promise<FigureOutcome> {
  const shaper = await loadPdfShaper(choices.fontBaseUrl, choices.onFontProgress);
  choices.onMaking?.();
  // 【なぜ】PDF に描くフォントで文字の幅を測ってシーンを作る。画面のフォントで測ると、
  // PDF の文字とラベル・凡例の配置がずれる。
  const figure = source.build({ ...request(choices, date), measureText: shaper.measure });
  const blob = await createPdf(figure.scene, shaper, { title: source.title });
  downloadBlob(blob, withExtension(exportBaseName(source.title, date), 'pdf'));
  return {};
}

/**
 * 表示中のグラフを GraphML または GEXF で書き出す。
 *
 * @param kind - 形式
 * @param dataset - 元のデータ
 * @param graph - 表示中のグラフ
 * @param date - 作成日（GEXF の更新日にも使う）
 */
export function exportNetworkFile(
  kind: 'graphml' | 'gexf',
  dataset: Dataset,
  graph: RelataGraph,
  date: string,
): void {
  const base = exportBaseName(dataset.meta.title, date);
  const text =
    kind === 'graphml'
      ? exportGraphml(dataset, graph)
      : exportGexf(dataset, graph, { modifiedDate: date });
  const type = kind === 'graphml' ? 'application/graphml+xml' : 'application/gexf+xml';
  downloadBlob(
    new Blob([text], { type: `${type};charset=utf-8` }),
    withExtension(base, kind === 'graphml' ? 'graphml' : 'gexf'),
  );
}
