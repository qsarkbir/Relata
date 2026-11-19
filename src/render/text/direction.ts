/**
 * 文字の向きの判定（NFR-09、設計書 §8.6）。
 */
/** 文字の向き。 */
export type TextDirection = 'ltr' | 'rtl';

// 【TS】`\p{L}` は Unicode の「文字」。`u` フラグが必要。
const LETTER = /^\p{L}$/u;

/**
 * 右から左へ書く文字の範囲（Unicode の Bidi_Class が R または AL のブロック）。
 * ヘブライ文字、シリア文字、アラビア文字、ターナ文字、NKo、サマリア文字、マンダ文字、
 * アラビア文字の補助・拡張、表示形（FB1D〜FDFF、FE70〜FEFF）、補助面の右から左のブロック。
 *
 * @param cp - コードポイント
 * @returns 右から左のブロックなら true
 */
function isRtlBlock(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x08ff) ||
    (cp >= 0xfb1d && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff) ||
    (cp >= 0x10800 && cp <= 0x10fff) ||
    (cp >= 0x1e800 && cp <= 0x1efff)
  );
}

/**
 * アラビア・インド数字など、右から左のブロックにあっても強い向きでない文字（Bidi_Class AN）か。
 *
 * @param cp - コードポイント
 * @returns AN なら true
 */
function isArabicNumber(cp: number): boolean {
  return (
    (cp >= 0x0660 && cp <= 0x0669) ||
    cp === 0x066b ||
    cp === 0x066c ||
    (cp >= 0x06f0 && cp <= 0x06f9) ||
    (cp >= 0x0600 && cp <= 0x0605) ||
    cp === 0x06dd ||
    cp === 0x08e2
  );
}

const MARK = /^\p{M}$/u;
const NON_STRONG = /^[\p{Z}\p{Cc}\p{Cf}]$/u;

/**
 * 最初の「強い向きの文字」で、文字列の向きを判定する。
 *
 * Unicode Bidirectional Algorithm（UAX #9）の規則 P2、P3 と同じ考え方で、
 * 最初に現れる強い向きの文字（Bidi_Class の L、R、AL）が右から左なら `rtl`、左から右なら `ltr` とする。
 * 数字、記号、空白、結合記号は強い向きを持たないので読み飛ばす。強い文字が無ければ `ltr`。
 * 向きの印（U+200F、U+061C は rtl、U+200E は ltr）は強い文字として数える。
 * アイソレート（U+2066〜2068）は、対応する U+2069 まで読み飛ばす（P2）。
 *
 * 【なぜ】JavaScript の正規表現は Bidi_Class を直接は扱えない。そこで近似する。
 * 右から左のブロックでは、結合記号、AN の数字、空白、制御・書式文字を除くすべて
 * （N'Ko の数字、アラビア文字の句読点などを含む）を強い R/AL とする。
 * それ以外のブロックでは、文字（\p{L}）を L とする。
 * 歴史資料では「Ibn al-Athir (ابن الأثير)」のように混在するが、先頭の強い文字で決める。
 *
 * 計算量: 最初の強い文字までの長さ。
 *
 * @param text - ラベルの文字列
 * @returns `rtl` または `ltr`
 */
export function detectDirection(text: string): TextDirection {
  let isolateDepth = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp >= 0x2066 && cp <= 0x2068) {
      isolateDepth += 1;
      continue;
    }
    if (cp === 0x2069) {
      if (isolateDepth > 0) isolateDepth -= 1;
      continue;
    }
    if (isolateDepth > 0) continue;
    if (cp === 0x200f || cp === 0x061c) return 'rtl';
    if (cp === 0x200e) return 'ltr';
    if (isRtlBlock(cp)) {
      if (MARK.test(ch) || NON_STRONG.test(ch) || isArabicNumber(cp)) continue;
      return 'rtl';
    }
    if (LETTER.test(ch)) return 'ltr';
  }
  return 'ltr';
}
