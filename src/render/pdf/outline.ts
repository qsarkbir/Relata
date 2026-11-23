/**
 * 文字の輪郭（アウトライン）の型と、SVG のパス文字列の解析（FR-OUT-04、NFR-09、設計書 §11.2）。
 *
 * PDF のラベルは、整形（アラビア文字の連結、右から左の並び）を済ませた「字形の輪郭」を図形として描く。
 * 整形そのものは harfbuzzjs（io 側）が行い、render は輪郭の形だけを受け取る。
 */

/** 輪郭の命令。座標は絶対値。`Z` は現在の輪郭を閉じる。 */
// 【TS】判別共用体。`type` の値で、持つ座標が決まる。
export type OutlineCommand =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | {
      readonly type: 'Q';
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'C';
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'Z' };

/**
 * 整形したラベルの中の、字形 1 つの置き場所。
 *
 * 輪郭の命令は、フォントの座標（単位数 upem のまま、y は SVG と同じ下向き）で持ち、同じ字形で共有する。
 * 【なぜ】同じ字形（フォントと字形番号）は、PDF では 1 回だけ図形（Form XObject）として定義し、
 * 置き場所の行列（`s 0 0 s x y cm`）で何度も置く。字形ごとに輪郭を書き並べると、ラベルが多い図で
 * ファイルが巨大になり、作成も遅くなる。
 */
export interface PlacedGlyph {
  /** 字形の識別子（フォントと字形番号で一意）。同じなら同じ輪郭。 */
  readonly id: string;
  /** 輪郭（フォントの座標。呼ぶ側は書き換えない）。 */
  readonly commands: readonly OutlineCommand[];
  /** 文字列の見た目の左端のベースラインを原点とした、字形の原点の位置（px、y は下向き）。 */
  readonly x: number;
  readonly y: number;
  /** フォントの座標から px への倍率（文字の大きさ ÷ upem）。 */
  readonly scale: number;
}

/** 整形した 1 つのラベルの輪郭。 */
export interface TextOutline {
  /** 見た目の幅（px）。 */
  readonly width: number;
  /**
   * 字形の置き場所。左から右へ並べ済み（右から左の文字列でも、見た目の並びになっている）。
   * 空白など、輪郭の無い字形は含めない。
   */
  readonly glyphs: readonly PlacedGlyph[];
}

/**
 * ラベルを整形して輪郭にする関数。
 *
 * 【なぜ】render は、フォントも整形ライブラリも知らない。幅を測る関数（`MeasureText`）と同じく、
 * 呼ぶ側（io）が関数として渡す（設計書 §8.1、D-17）。
 *
 * @param text - 文字列（論理順）
 * @param fontSize - 文字の大きさ（px）
 * @param direction - 段落の向き（`detectDirection` の結果）。右から左のラベルは `rtl`
 * @returns 輪郭
 */
export type TextOutliner = (
  text: string,
  fontSize: number,
  direction: 'ltr' | 'rtl',
) => TextOutline;

/**
 * HarfBuzz が返す SVG のパス文字列（`M` `L` `Q` `C` `Z`、絶対座標）を、命令の列にする。
 *
 * 座標に `scale` を掛け、y を反転して（フォントは y が上向き、SVG と PDF の本図は下向き）、
 * `(ox, oy)` だけ平行移動する。計算量は文字列の長さに比例。
 *
 * @param d - パス文字列
 * @param scale - 倍率（フォントの大きさ ÷ フォントの単位数）
 * @param ox - x の平行移動（px）
 * @param oy - ベースラインの y（px）
 * @returns 命令の列。解釈できない命令があれば、そこで止める
 */
export function parseGlyphPath(d: string, scale: number, ox: number, oy: number): OutlineCommand[] {
  const out: OutlineCommand[] = [];
  const tokens = d.match(/[MLQCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const px = (v: number): number => ox + v * scale;
  const py = (v: number): number => oy - v * scale;
  while (i < tokens.length) {
    const op = tokens[i++]?.toUpperCase();
    if (op === 'M') {
      const x = num();
      out.push({ type: 'M', x: px(x), y: py(num()) });
    } else if (op === 'L') {
      const x = num();
      out.push({ type: 'L', x: px(x), y: py(num()) });
    } else if (op === 'Q') {
      const cx = num();
      const cy = num();
      const x = num();
      out.push({ type: 'Q', cx: px(cx), cy: py(cy), x: px(x), y: py(num()) });
    } else if (op === 'C') {
      const c1x = num();
      const c1y = num();
      const c2x = num();
      const c2y = num();
      const x = num();
      out.push({
        type: 'C',
        c1x: px(c1x),
        c1y: py(c1y),
        c2x: px(c2x),
        c2y: py(c2y),
        x: px(x),
        y: py(num()),
      });
    } else if (op === 'Z') {
      out.push({ type: 'Z' });
    } else {
      break;
    }
  }
  return out;
}
