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
 * 右から左のブロックにあって、強い向きを持たない文字（Bidi_Class が R、AL 以外）の範囲。
 * 結合記号（NSM）と書式文字（BN）は、別に `\p{M}` と `\p{Cf}` で読み飛ばすので、ここには入れない。
 *
 * Unicode 15.1 の UnicodeData（Python の unicodedata.bidirectional）から作った表。
 * 主なもの: アラビア・インド数字（AN、EN）、数の印（U+0600〜0605、AN）、
 * 立方根・四乗根（U+0606〜0607、ON）、パーミル（U+0609〜060A、ET）、アラビア文字のコンマ（U+060C、CS）、
 * パーセント（U+066A、ET）、ルブゥ・ル・ヒズブとサジダの印（U+06DE、U+06E9、ON）、
 * 装飾の括弧（U+FD3E〜FD4F、ON）、バスマラなどの合字（U+FDCF、U+FDFD〜FDFF、ON）。
 */
// 【TS】`readonly (readonly [number, number])[]` は「変更できない、2 要素の組の配列」。
//       組（タプル）にすると、各要素が [始め, 終わり] の 2 つの数だと型で表せる。
const WEAK_IN_RTL_BLOCKS: readonly (readonly [number, number])[] = [
  [0x0600, 0x0607], // AN（数の印）、ON（立方根・四乗根）
  [0x0609, 0x060a], // ET（パーミル）
  [0x060c, 0x060c], // CS（アラビア文字のコンマ）
  [0x060e, 0x060f], // ON（詩の印）
  [0x0660, 0x066c], // AN（アラビア・インド数字、小数点、千の区切り）、ET（パーセント）
  [0x06dd, 0x06de], // AN（アーヤの終わり）、ON（ルブゥ・ル・ヒズブ）
  [0x06e9, 0x06e9], // ON（サジダの印）
  [0x06f0, 0x06f9], // EN（ペルシア語などの数字）
  [0x07f6, 0x07f9], // ON（NKo の記号）
  [0x0890, 0x0891], // AN（ポンドなどの印）
  [0x08e2, 0x08e2], // AN
  [0xfb29, 0xfb29], // ES（ヘブライ文字の代替の正符号）
  [0xfd3e, 0xfd4f], // ON（装飾の括弧など）
  [0xfdcf, 0xfdcf], // ON
  [0xfdfd, 0xfdff], // ON（バスマラなどの合字）
  [0x1091f, 0x1091f], // ON（フェニキア文字の語の区切り）
  [0x10b39, 0x10b3f], // ON（アヴェスター文字の記号）
  [0x10d30, 0x10d39], // AN（ハニーフィー・ロヒンギャ文字の数字）
  [0x10e60, 0x10e7e], // AN（ルーミー数字）
  [0x1eef0, 0x1eef1], // ON（アラビア文字の数学記号）
];

/**
 * 右から左のブロックにあっても、強い向きを持たない文字か（数字、記号、句読点の一部）。
 *
 * @param cp - コードポイント
 * @returns 強い向きを持たないなら true
 */
// 【なぜ】数字や「‰」「؆」で始まるラベル（例: 「؉100 Ibn」）を、先頭の記号ではなく、
//       その後の最初の文字（ここでは I）で判定するため。表は 20 区間なので線形に探す。
function isWeakInRtlBlock(cp: number): boolean {
  return WEAK_IN_RTL_BLOCKS.some(([a, b]) => cp >= a && cp <= b);
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
 * 右から左のブロックでは、結合記号、空白、制御・書式文字と、Unicode の表で強い向きを持たない
 * 文字（数字、‰ や ؆ などの記号、アラビア文字のコンマ。`WEAK_IN_RTL_BLOCKS`）を除くすべて
 * （N'Ko の数字、アラビア文字のセミコロンと疑問符などは R/AL）を強い R/AL とする。
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
      // シリア文字の略記の印（U+070F）は書式文字（Cf）だが、Bidi_Class は AL（強い）。
      if (cp === 0x070f) return 'rtl';
      if (MARK.test(ch) || NON_STRONG.test(ch) || isWeakInRtlBlock(cp)) continue;
      return 'rtl';
    }
    if (LETTER.test(ch)) return 'ltr';
  }
  return 'ltr';
}
