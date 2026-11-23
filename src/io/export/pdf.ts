/** PDF の書き出し（FR-OUT-04、NFR-09、D-43）。 */
import type { Scene } from '../../render';
import { buildPdf, renderPdfContent } from '../../render';
import type { Deflate } from '../../render';
import type { PdfFontBytes, TextShaper } from './pdfText';

/** フォントのファイル名（`public/fonts/`）。大きさの目安は UI に出す（D-43）。 */
// 【TS】`as const` は、オブジェクトを読み取り専用にし、値を文字列リテラルの型にする（`string` に広げない）。
export const PDF_FONT_FILES = {
  latin: 'NotoSans-Regular.ttf',
  japanese: 'NotoSansJP-Regular.ttf',
  arabic: 'NotoNaskhArabic-Regular.ttf',
} as const;

/**
 * 初回の読み込みの大きさの目安（バイト）。画面に「数 MB を読み込む」と示すために使う。
 * 実際のファイルの大きさとずれたら、`pdf.test.ts` が知らせる。
 */
export const PDF_FONT_BYTES_ESTIMATE = 6_560_000;

/** PDF の書き出しの選択肢。 */
export interface PdfExportOptions {
  /** PDF の題名。 */
  readonly title?: string;
  /** 背景色。既定は白。 */
  readonly background?: string;
}

// 【なぜ】フォントは読み込みごとに取りに行かない。ブラウザの HTTP キャッシュに加え、同じ画面の中では
// 1 回だけ読み込んで使い回す（書き出しを続けて行っても、待たない）。失敗したら次回やり直す。
// 【TS】`Promise<X> | null` は「読み込み中または完了の Promise か、まだ無い」。使う前に null を確かめる。
let fontCache: Promise<PdfFontBytes> | null = null;
// 整形の道具（フォントから作った harfbuzz の書体）も、1 回だけ作る。書き出しのたびに wasm の書体を
// 作り直さない。キーはフォントのフォルダの URL。
const shaperCache = new Map<string, Promise<TextShaper>>();

async function fetchBytes(url: string, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font: ${String(response.status)} ${url}`);
  const body = response.body;
  if (body === null) return response.arrayBuffer();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out.buffer;
}

/**
 * フォントを、このサイトから読み込む。
 *
 * @param baseUrl - フォントのフォルダの URL
 * @param onProgress - 進み（0 から 1。大きさの目安に対する割合）
 * @returns フォントのバイト列
 */
export function loadPdfFonts(
  baseUrl: string,
  onProgress?: (fraction: number) => void,
): Promise<PdfFontBytes> {
  if (fontCache !== null) return fontCache;
  let received = 0;
  const bump = (n: number): void => {
    received += n;
    onProgress?.(Math.min(1, received / PDF_FONT_BYTES_ESTIMATE));
  };
  const promise = Promise.all([
    fetchBytes(baseUrl + PDF_FONT_FILES.latin, bump),
    fetchBytes(baseUrl + PDF_FONT_FILES.japanese, bump),
    fetchBytes(baseUrl + PDF_FONT_FILES.arabic, bump),
  ]).then(([latin, japanese, arabic]) => ({ latin, japanese, arabic }));
  fontCache = promise;
  promise.catch(() => {
    if (fontCache === promise) fontCache = null;
  });
  return promise;
}

/**
 * ブラウザ標準の圧縮（zlib 形式。PDF の FlateDecode）。`CompressionStream` が無い環境では undefined
 * （圧縮しないで書く）。
 *
 * 【TS】`Deflate | undefined` は、関数の型または未定義。呼ぶ側は `buildPdf` の第 3 引数にそのまま渡せる。
 *
 * @param data - 圧縮するバイト列（関数の引数）
 * @returns 圧縮したバイト列（関数の戻り値）
 */
export const browserDeflate: Deflate | undefined =
  typeof CompressionStream === 'undefined'
    ? undefined
    : async (data) => {
        // 理由: 型が ArrayBufferLike を区別するだけで、中身は Blob に渡せるバイト列。
        const part = data as BlobPart;
        const stream = new Blob([part]).stream().pipeThrough(new CompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      };

/**
 * 整形の道具（フォント、harfbuzz）を用意する。初回だけフォントを読み込む。
 *
 * @param fontBaseUrl - フォントのフォルダの URL
 * @param onProgress - フォントの読み込みの進み（0 から 1）
 * @returns 整形の道具
 */
export function loadPdfShaper(
  fontBaseUrl: string,
  onProgress?: (fraction: number) => void,
): Promise<TextShaper> {
  const cached = shaperCache.get(fontBaseUrl);
  if (cached !== undefined) return cached;
  const promise = (async (): Promise<TextShaper> => {
    const [hb, text, fonts] = await Promise.all([
      // 【なぜ】harfbuzzjs（wasm を含む）と、双方向の処理（bidi-js）を含む整形のコードは、PDF の書き出しの
      // ときだけ読み込む。最初の読み込みに入れない（フォントと同じ方針。D-43）。
      import('harfbuzzjs'),
      import('./pdfText'),
      loadPdfFonts(fontBaseUrl, onProgress),
    ]);
    return text.createTextShaper(hb, fonts);
  })();
  shaperCache.set(fontBaseUrl, promise);
  // 失敗したら、次の書き出しでやり直せるよう、キャッシュから外す。
  promise.catch(() => {
    if (shaperCache.get(fontBaseUrl) === promise) shaperCache.delete(fontBaseUrl);
  });
  return promise;
}

/**
 * シーンから PDF を作る。
 *
 * 画面の SVG と同じシーンから、図形を PDF のパスで、文字を整形済みの輪郭で描く。
 * 文字は輪郭の図形になるので、PDF の中の文字を検索・選択することはできない（D-43 との違い）。
 *
 * @param scene - シーン（SVG の書き出しと同じもの）。ラベルの幅は `shaper.measure` で測って作ると、描く文字と一致する
 * @param shaper - `loadPdfShaper` の結果
 * @param options - 題名と背景
 * @returns PDF のファイル
 */
export async function createPdf(
  scene: Scene,
  shaper: TextShaper,
  options: PdfExportOptions = {},
): Promise<Blob> {
  const content = renderPdfContent(scene, {
    background: options.background ?? '#ffffff',
    outline: shaper.outline,
  });
  const bytes = await buildPdf(
    content,
    options.title === undefined ? {} : { title: options.title },
    browserDeflate,
  );
  // 理由: Uint8Array は Blob の部品として使える。TypeScript の型が ArrayBufferLike を区別するだけ。
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
