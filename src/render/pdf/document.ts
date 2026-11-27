/**
 * 1 ページの PDF ファイルを組み立てる（FR-OUT-04）。外部ライブラリを使わない、最小の書き手。
 *
 * 構造: カタログ、ページの一覧、ページ、コンテンツストリーム、情報辞書。フォントは埋め込まない
 * （文字は輪郭の図形で描くため。scenePdf.ts）。仕様: ISO 32000-1（PDF 1.7）。
 * DOM は使わない。圧縮は関数で受け取る（ブラウザでは `CompressionStream`、テストでは zlib）。
 */
import type { PdfContent } from './scenePdf';

/** バイト列を zlib 形式（Flate）に圧縮する関数。 */
// 【TS】関数の型にも名前を付けられる。`(引数) => 戻り値` の形で、ブラウザ用とテスト用の圧縮を同じ型で渡せる。
export type Deflate = (data: Uint8Array) => Promise<Uint8Array>;

/** PDF の情報辞書。 */
export interface PdfInfo {
  readonly title?: string;
  readonly producer?: string;
}

/**
 * PDF の文字列リテラルにする。
 *
 * ASCII だけなら丸括弧の中に、それ以外は UTF-16BE（BOM つき）の 16 進文字列にする（PDF 32000-1 §7.9.2.2）。
 * 日本語やアラビア文字の題名が、閲覧ソフトの「文書のプロパティ」で正しく見えるようにする。
 *
 * @param s - 文字列
 * @returns PDF の文字列
 */
export function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, '\\$&')})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/**
 * ページ内容から PDF のバイト列を作る。
 *
 * @param content - `renderPdfContent` の結果
 * @param info - 題名など
 * @param deflate - 圧縮の関数。省略すると圧縮しない
 * @returns PDF のバイト列（先頭は `%PDF-1.7`）
 */
export async function buildPdf(
  content: PdfContent,
  info: PdfInfo = {},
  deflate?: Deflate,
): Promise<Uint8Array> {
  const raw = latin1(content.stream);
  const body = deflate === undefined ? raw : await deflate(raw);
  const gs = content.graphicsStates
    .map(
      (g) =>
        `/${g.name} << /Type /ExtGState /CA ${fmtNumber(g.stroke)} /ca ${fmtNumber(g.fill)} >>`,
    )
    .join(' ');
  const mediaBox = `[0 0 ${String(round(content.widthPt))} ${String(round(content.heightPt))}]`;
  const infoEntries = [
    info.title === undefined ? '' : `/Title ${pdfString(info.title)}`,
    `/Producer ${pdfString(info.producer ?? 'Relata')}`,
  ].join(' ');
  // 字形の図形（Form XObject）。オブジェクト番号は 6 から。
  const formObjects = await Promise.all(
    content.forms.map(async (f): Promise<(string | Uint8Array)[]> => {
      const raw = latin1(f.stream);
      const data = deflate === undefined ? raw : await deflate(raw);
      const box = f.bbox.map((v) => fmtNumber(v)).join(' ');
      return [
        `<< /Type /XObject /Subtype /Form /BBox [${box}]${f.group === true ? ' /Group << /S /Transparency /CS /DeviceRGB /I true >>' : ''} /Length ${String(data.length)}${deflate === undefined ? '' : ' /Filter /FlateDecode'} >>\nstream\n`,
        data,
        '\nendstream',
      ];
    }),
  );
  const xobjects = content.forms.map((f, i) => `/${f.name} ${String(6 + i)} 0 R`).join(' ');
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Contents 4 0 R /Resources << /ExtGState << ${gs} >> /XObject << ${xobjects} >> >> >>`,
    ],
    [
      `<< /Length ${String(body.length)}${deflate === undefined ? '' : ' /Filter /FlateDecode'} >>\nstream\n`,
      body,
      '\nendstream',
    ],
    [`<< ${infoEntries} >>`],
    ...formObjects,
  ];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (data: string | Uint8Array): void => {
    const bytes = typeof data === 'string' ? latin1(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };
  // 先頭の 2 行目のバイナリのコメントは、PDF がバイナリを含むと転送ソフトに知らせる慣習。
  push('%PDF-1.7\n%âãÏÓ\n');
  const offsets: number[] = [];
  objects.forEach((parts, i) => {
    offsets.push(offset);
    push(`${String(i + 1)} 0 obj\n`);
    for (const p of parts) push(p);
    push('\nendobj\n');
  });
  const xref = offset;
  push(`xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`);
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`);
  push(
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`,
  );
  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

const round = (v: number): number => Math.round(v * 100) / 100;

// 数値を PDF の書き方（指数表記なし、小数 4 桁まで）にする。JavaScript の既定の文字列は 1e-7 のような指数表記になりうる。
const fmtNumber = (v: number): string =>
  (Math.round(v * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '') || '0';
