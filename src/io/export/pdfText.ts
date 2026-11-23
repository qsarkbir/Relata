/**
 * PDF のラベルの整形（FR-OUT-04、NFR-09、設計書 §11.2、D-43）。
 *
 * 手順: (1) Unicode 双方向アルゴリズム（UAX #9、bidi-js）で、文字ごとの埋め込みレベルを求める。
 * (2) 同じレベル・同じフォントの文字を 1 つの「ラン」にまとめる。(3) ランごとに harfbuzzjs で整形する
 * （アラビア文字の連結形・合字・結合記号の位置、右から左の並び）。(4) 行の見た目の順に、ランを左から並べる
 * （UAX #9 の L2: 奇数レベルのランの並びを反転）。(5) 字形の輪郭（SVG のパス）を取り出し、座標を変換する。
 *
 * 出典: Unicode Standard Annex #9, "Unicode Bidirectional Algorithm"（Unicode Consortium）、
 * HarfBuzz（Behdad Esfahbod ほか）。計算量は文字数に比例（整形は文字数 × 定数）。
 *
 * 【なぜ】pdf-lib などは、OpenType の字形の置き換え（GSUB）をしないため、アラビア文字が語頭・語中・語末の
 * 形にならず、ばらばらの字形になる。ここでは整形そのものを harfbuzz に任せ、結果の輪郭を描く。
 */
import bidiFactory from 'bidi-js';
import type * as HarfBuzz from 'harfbuzzjs';
import type { OutlineCommand, TextOutline, TextOutliner } from '../../render';
import { detectDirection, parseGlyphPath } from '../../render';

/** harfbuzzjs のモジュール（`import('harfbuzzjs')` の結果）。 */
export type HarfBuzzModule = typeof HarfBuzz;

/** 書き出しに使うフォント。 */
export interface PdfFontBytes {
  /** 日本語と欧文（Noto Sans JP）。 */
  readonly sans: ArrayBuffer;
  /** アラビア文字（Noto Naskh Arabic）。 */
  readonly arabic: ArrayBuffer;
}

type FontClass = 'sans' | 'arabic';

// アラビア文字のブロック: アラビア、アラビア補助、アラビア拡張 A、表示形 A、表示形 B。
// ペルシア語・ウルドゥー語の字（ی ک گ پ ڤ など）は U+06xx にあるので、ここに含まれる。
const ARABIC_RANGES: readonly (readonly [number, number])[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x0870, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];
const isArabic = (cp: number): boolean => ARABIC_RANGES.some(([a, b]) => cp >= a && cp <= b);
// 空白と約物は、前後の文字のフォントに合わせる（ランを細かく割らない）。
const isNeutral = (ch: string): boolean => /^[\s\p{P}]$/u.test(ch);

interface Run {
  readonly text: string;
  readonly level: number;
  readonly font: FontClass;
}

/**
 * 文字列を、レベルとフォントが同じ文字のランに分ける。
 *
 * @param text - 論理順の文字列
 * @param levels - UTF-16 の位置ごとの埋め込みレベル
 * @returns 論理順のラン
 */
export function splitRuns(text: string, levels: ArrayLike<number>): Run[] {
  const runs: { text: string; level: number; font: FontClass }[] = [];
  let previous: FontClass = 'sans';
  let index = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const font: FontClass = isArabic(cp) ? 'arabic' : isNeutral(ch) ? previous : 'sans';
    previous = font;
    const level = levels[index] ?? 0;
    index += ch.length;
    const last = runs[runs.length - 1];
    if (last?.level === level && last.font === font) last.text += ch;
    else runs.push({ text: ch, level, font });
  }
  return runs;
}

/**
 * ランを見た目の順（左から右）に並べ替える。UAX #9 の規則 L2 を、文字ではなくランに適用する。
 *
 * 最も高いレベルから最も低い奇数レベルまで、そのレベル以上のランが続く範囲を反転する。
 *
 * @param levels - 論理順のランのレベル
 * @returns 見た目の順に並べた、元の添字
 */
export function visualOrder(levels: readonly number[]): number[] {
  const order = levels.map((_, i) => i);
  const max = Math.max(0, ...levels);
  const minOdd = Math.min(...levels.filter((l) => l % 2 === 1), Infinity);
  // 並べ替え後の位置 k にあるランのレベル。
  const levelAt = (k: number): number => levels[order[k] ?? 0] ?? 0;
  for (let lvl = max; lvl >= minOdd && lvl >= 1; lvl--) {
    let i = 0;
    while (i < order.length) {
      if (levelAt(i) >= lvl) {
        let j = i;
        while (j + 1 < order.length && levelAt(j + 1) >= lvl) j++;
        const part = order.slice(i, j + 1).reverse();
        order.splice(i, part.length, ...part);
        i = j + 1;
      } else i++;
    }
  }
  return order;
}

/** 整形した字形（フォントの座標のまま）。 */
export interface ShapedGlyph {
  readonly gid: number;
  readonly xAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
  readonly path: string;
}

/**
 * harfbuzzjs で文字列を整形する関数と、フォントの単位数を持つ組を作る。
 *
 * @param hb - harfbuzzjs のモジュール
 * @param bytes - フォントのバイト列（TrueType）
 * @returns 整形関数と upem
 */
function makeFace(hb: HarfBuzzModule, bytes: ArrayBuffer) {
  const blob = new hb.Blob(bytes);
  const face = new hb.Face(blob);
  const font = new hb.Font(face);
  const paths = new Map<number, string>();
  return {
    upem: face.upem,
    shape(text: string, rtl: boolean): ShapedGlyph[] {
      const buffer = new hb.Buffer();
      buffer.addText(text);
      // 【なぜ】文字から文字種（script）と言語を推定してから、向きだけ上書きする。向きは bidi が決めたレベルに従う。
      buffer.guessSegmentProperties();
      buffer.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
      hb.shape(font, buffer);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      return infos.map((info, i) => {
        const gid = info.codepoint; // 整形後は字形の番号（名前は codepoint のまま）
        let path = paths.get(gid);
        if (path === undefined) {
          path = font.glyphToPath(gid);
          paths.set(gid, path);
        }
        const p = positions[i];
        return {
          gid,
          xAdvance: p?.xAdvance ?? 0,
          xOffset: p?.xOffset ?? 0,
          yOffset: p?.yOffset ?? 0,
          path,
        };
      });
    },
  };
}

/** 整形の関数を含む、書き出しの道具。 */
export interface TextShaper {
  /** ラベルを輪郭にする（`renderPdfContent` に渡す）。 */
  readonly outline: TextOutliner;
  /**
   * 文字列の幅（px）を測る。`buildScene` の `measureText` に渡せる形（`"12px sans-serif"` の大きさだけを読む）。
   * 【なぜ】PDF に描くフォントで測った幅でシーンを作れば、ラベルと凡例の重なり・はみ出しの判断が、
   * 実際に描く文字と一致する（画面のフォントで測ると、PDF の文字とずれる）。
   */
  readonly measure: (text: string, font: string) => number;
  /** 文字列を整形した字形（レベルごとのランを、見た目の順に並べたもの）。テストと診断用。 */
  readonly shapeVisual: (
    text: string,
    direction: 'ltr' | 'rtl',
  ) => readonly {
    readonly font: FontClass;
    readonly rtl: boolean;
    readonly glyphs: ShapedGlyph[];
  }[];
}

/**
 * フォントを読み込んで、ラベルの整形の道具を作る。
 *
 * @param hb - harfbuzzjs のモジュール
 * @param fonts - フォントのバイト列
 * @returns 整形の道具
 */
export function createTextShaper(hb: HarfBuzzModule, fonts: PdfFontBytes): TextShaper {
  const faces = { sans: makeFace(hb, fonts.sans), arabic: makeFace(hb, fonts.arabic) };
  const bidi = bidiFactory();
  const shapeVisual: TextShaper['shapeVisual'] = (text, direction) => {
    // 【なぜ】段落の向きは、ラベルの向き（`detectDirection`）に合わせて明示する。
    const { levels } = bidi.getEmbeddingLevels(text, direction);
    const runs = splitRuns(text, levels);
    return visualOrder(runs.map((r) => r.level)).flatMap((i) => {
      const run = runs[i];
      if (run === undefined) return [];
      const rtl = run.level % 2 === 1;
      return [{ font: run.font, rtl, glyphs: faces[run.font].shape(run.text, rtl) }];
    });
  };
  const outline = (text: string, fontSize: number, direction: 'ltr' | 'rtl'): TextOutline => {
    const commands: OutlineCommand[] = [];
    let pen = 0;
    for (const run of shapeVisual(text, direction)) {
      const face = faces[run.font];
      const scale = fontSize / face.upem;
      for (const g of run.glyphs) {
        commands.push(
          ...parseGlyphPath(g.path, scale, pen + g.xOffset * scale, -g.yOffset * scale),
        );
        pen += g.xAdvance * scale;
      }
    }
    return { width: pen, commands };
  };
  const measure = (text: string, font: string): number => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
    return outline(text, size, detectDirection(text)).width;
  };
  return { outline, shapeVisual, measure };
}
