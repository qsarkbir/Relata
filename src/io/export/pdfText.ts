/**
 * PDF のラベルの整形（FR-OUT-04、NFR-09、設計書 §11.2、D-43）。
 *
 * 手順: (1) Unicode 双方向アルゴリズム（UAX #9、bidi-js）で、文字ごとの埋め込みレベルを求める。
 * (2) 文字ごとに「その字形を持つフォント」を選び（下の `pickFont`）、同じレベル・同じフォントの文字を 1 つの「ラン」にまとめる。(3) ランごとに harfbuzzjs で整形する
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
import type { OutlineCommand, PlacedGlyph, TextOutline, TextOutliner } from '../../render';
import { detectDirection, parseGlyphPath } from '../../render';

// 【TS】`import type * as X` は、モジュール全体を「型だけ」として取り込む。実行時には何も読み込まない
//       （harfbuzzjs 本体は、PDF のときだけ動的に import する）。
// 【TS】`typeof HarfBuzz` は、値（モジュールの名前空間）の型を取り出す。
/** harfbuzzjs のモジュール（`import('harfbuzzjs')` の結果）。 */
export type HarfBuzzModule = typeof HarfBuzz;

/** 書き出しに使うフォント。 */
export interface PdfFontBytes {
  /** 欧文（拡張ラテン文字、ギリシア文字、キリル文字。転写記号、トルコ語の字を含む）。Noto Sans。 */
  readonly latin: ArrayBuffer;
  /** 日本語（と、他のフォントに無い文字の最後の頼み）。Noto Sans JP。 */
  readonly japanese: ArrayBuffer;
  /** アラビア文字。Noto Naskh Arabic。 */
  readonly arabic: ArrayBuffer;
}

/** 使うフォントの種類。 */
export type FontClass = 'latin' | 'japanese' | 'arabic';

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
// 空白と約物は、前の文字のフォントに字形があればそれを使う（ランを細かく割らない）。
const isNeutral = (ch: string): boolean => /^[\s\p{P}]$/u.test(ch);
// 結合記号（\p{M}）と書式制御文字（\p{Cf}。ZWJ、ZWNJ、双方向の制御文字など）は、前の文字と同じフォントにする。
// 【なぜ】ランを割ると、結合記号が土台の字から離れ、ZWJ による連結が切れる。
const isAttached = (ch: string): boolean => /^[\p{M}\p{Cf}]$/u.test(ch);

/** フォントごとに、その字形を持つかを答える関数。 */
export type HasGlyph = (font: FontClass, codePoint: number) => boolean;

/**
 * 文字に使うフォントを、「字形を持つ最初のフォント」として選ぶ。
 *
 * 探す順は文字の種類で決める: アラビア文字は Naskh → 欧文 → 日本語、拉丁・ギリシア・キリル・数字などは
 * 欧文 → 日本語 → アラビア、それ以外（漢字、かな、全角の約物など）は日本語 → 欧文 → アラビア。
 * どれにも無ければ、先頭のフォント（字形番号 0 の豆腐）にする。
 *
 * @param codePoint - 文字のコードポイント
 * @param has - フォントが字形を持つかの関数
 * @returns フォントの種類
 */
export function pickFont(codePoint: number, has: HasGlyph): FontClass {
  const ch = String.fromCodePoint(codePoint);
  const order: readonly FontClass[] = isArabic(codePoint)
    ? ['arabic', 'latin', 'japanese']
    : /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(ch) ||
        (codePoint >= 0x3000 && codePoint <= 0x30ff) ||
        (codePoint >= 0xff00 && codePoint <= 0xffef)
      ? ['japanese', 'latin', 'arabic']
      : ['latin', 'japanese', 'arabic'];
  return order.find((f) => has(f, codePoint)) ?? order[0] ?? 'latin';
}

interface Run {
  readonly text: string;
  readonly level: number;
  readonly font: FontClass;
}

/**
 * 文字列を、レベルとフォントが同じ文字のランに分ける。
 *
 * - 結合記号と書式制御文字は、前の文字のフォントを継ぐ（ランを割らない）。
 * - 空白と約物は、前のフォントに字形があればそれを使い、無ければ字形を持つフォントを選ぶ。
 * - それ以外は `pickFont`。
 *
 * @param text - 論理順の文字列
 * @param levels - UTF-16 の位置ごとの埋め込みレベル
 * @param has - フォントが字形を持つかの関数
 * @returns 論理順のラン
 */
// 【TS】`ArrayLike<number>` は「添字で読める長さのある物」。配列でも Uint8Array（bidi-js の結果）でも受けられる。
export function splitRuns(text: string, levels: ArrayLike<number>, has: HasGlyph): Run[] {
  const runs: { text: string; level: number; font: FontClass }[] = [];
  let previous: FontClass | undefined;
  let index = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    let font: FontClass;
    if (previous !== undefined && isAttached(ch)) font = previous;
    else if (previous !== undefined && isNeutral(ch) && has(previous, cp)) font = previous;
    else font = pickFont(cp, has);
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

/**
 * 空白類を正規化する。SVG（`escapeXml`）と同じ: タブ・改行・復帰は空白 1 つにし、使えない制御文字は除く。
 *
 * 【なぜ】改行や制御文字をそのまま整形すると、字形番号 0（豆腐）や不要な幅が出る。
 *
 * @param text - ラベルの文字列
 * @returns 正規化した文字列
 */
export function normalizeLabelText(text: string): string {
  return (
    text
      .replace(/[\t\n\r]/g, ' ')
      // eslint-disable-next-line no-control-regex -- 制御文字を検出するのが目的
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

/** 整形した字形（フォントの座標のまま）。 */
export interface ShapedGlyph {
  readonly gid: number;
  readonly xAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
  /** 輪郭。字形ごとに 1 回だけ解析して共有する（書き換えない）。 */
  readonly commands: readonly OutlineCommand[];
}

// 書体 1 つ分の整形の道具を作る。
// 【TS】戻り値の型は書かず、返すオブジェクトから推論させる（`ReturnType<typeof makeFace>` で参照できる）。
function makeFace(hb: HarfBuzzModule, bytes: ArrayBuffer, name: FontClass) {
  const blob = new hb.Blob(bytes);
  const face = new hb.Face(blob);
  const font = new hb.Font(face);
  // 【なぜ】バッファは 1 つを使い回す。字形の数だけ作ると、wasm のメモリの確保と解放が重い。
  // 向き・文字種の推定は `reset()` で初期化しないと前の文字列のものが残るため、clearContents ではなく reset を使う。
  const buffer = new hb.Buffer();
  const cache = new Map<number, readonly OutlineCommand[]>();
  let unicodes: Set<number> | undefined;
  return {
    upem: face.upem,
    has(cp: number): boolean {
      // 【なぜ】字形を持つ文字の集合は、初めて聞かれたときに 1 度だけ作る（日本語のフォントは数万字）。
      unicodes ??= new Set(face.collectUnicodes());
      return unicodes.has(cp);
    },
    shape(text: string, rtl: boolean): ShapedGlyph[] {
      buffer.reset();
      buffer.addText(text);
      // 【なぜ】文字から文字種（script）と言語を推定してから、向きだけ上書きする。向きは bidi が決めたレベルに従う。
      buffer.guessSegmentProperties();
      buffer.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
      hb.shape(font, buffer);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      return infos.map((info, i) => {
        const gid = info.codepoint; // 整形後は字形の番号（名前は codepoint のまま）
        let commands = cache.get(gid);
        if (commands === undefined) {
          // フォントの座標のまま（倍率 1、移動なし）。y は反転して SVG と同じ下向きにする。
          commands = parseGlyphPath(font.glyphToPath(gid), 1, 0, 0);
          cache.set(gid, commands);
        }
        const p = positions[i];
        return {
          gid,
          xAdvance: p?.xAdvance ?? 0,
          xOffset: p?.xOffset ?? 0,
          yOffset: p?.yOffset ?? 0,
          commands,
        };
      });
    },
    name,
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
  /** 文字ごとに選ばれるフォント（テスト用）。 */
  readonly fontOf: (codePoint: number) => FontClass;
  /** そのフォントが字形を持つか（テスト用）。 */
  readonly has: HasGlyph;
}

/**
 * フォントを読み込んで、ラベルの整形の道具を作る。
 *
 * @param hb - harfbuzzjs のモジュール
 * @param fonts - フォントのバイト列
 * @returns 整形の道具
 */
export function createTextShaper(hb: HarfBuzzModule, fonts: PdfFontBytes): TextShaper {
  const faces = {
    latin: makeFace(hb, fonts.latin, 'latin'),
    japanese: makeFace(hb, fonts.japanese, 'japanese'),
    arabic: makeFace(hb, fonts.arabic, 'arabic'),
  };
  const has: HasGlyph = (font, cp) => faces[font].has(cp);
  const bidi = bidiFactory();
  const shapeVisual: TextShaper['shapeVisual'] = (raw, direction) => {
    const text = normalizeLabelText(raw);
    // 【なぜ】段落の向きは、ラベルの向き（`detectDirection`）に合わせて明示する。
    const { levels } = bidi.getEmbeddingLevels(text, direction);
    const runs = splitRuns(text, levels, has);
    return visualOrder(runs.map((r) => r.level)).flatMap((i) => {
      const run = runs[i];
      if (run === undefined) return [];
      const rtl = run.level % 2 === 1;
      return [{ font: run.font, rtl, glyphs: faces[run.font].shape(run.text, rtl) }];
    });
  };
  const outline = (text: string, fontSize: number, direction: 'ltr' | 'rtl'): TextOutline => {
    const glyphs: PlacedGlyph[] = [];
    let pen = 0;
    for (const run of shapeVisual(text, direction)) {
      const face = faces[run.font];
      const scale = fontSize / face.upem;
      for (const g of run.glyphs) {
        // 空白など輪郭の無い字形は置かない（幅だけ進める）。
        if (g.commands.length > 0)
          glyphs.push({
            id: `${run.font}:${String(g.gid)}`,
            commands: g.commands,
            x: pen + g.xOffset * scale,
            y: -g.yOffset * scale,
            scale,
          });
        pen += g.xAdvance * scale;
      }
    }
    return { width: pen, glyphs };
  };
  const measure = (text: string, font: string): number => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
    return outline(text, size, detectDirection(normalizeLabelText(text))).width;
  };
  return { outline, shapeVisual, measure, fontOf: (cp) => pickFont(cp, has), has };
}
