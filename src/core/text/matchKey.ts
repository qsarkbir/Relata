// 照合キー（FR-FL-12、設計書 §5.2、D-20）。
// 検索、ファセットの値の照合、日付の月名の解析で共通に使う。元の表記は書き換えず、
// 比較のためだけの文字列（照合キー）を作る。

/**
 * 照合キーの作り方。手順ごとに真偽値で切り替える。
 *
 * 適用の順序は、設定に関係なく常に
 * 「compat（NFKC、でなければ NFC）→ arabic → diacritics → digits → caseFold → invisibles → spaces」。
 * 各設定は独立していて、他の設定の値には影響されない。
 */
// 【TS】`readonly` を付けたプロパティは、作ったあとで書き換えられない。
//       プリセットを誰かが書き換えて、全体の既定が変わる事故を防ぐ。
export interface MatchOptions {
  /** true なら NFKC（全角と半角、表示形などを通常の文字にそろえる）、false なら NFC */
  readonly compat: boolean;
  /** アラビア文字の揺れをそろえる（ハムザ付きの文字、ター・マルブータ、ヤー、カーフ、母音記号、タトウィール） */
  readonly arabic: boolean;
  /** 転写の補助記号を除く（ā→a、ḥ→h、ʿ と ʾ を除く）。日本語の濁点は除かない */
  readonly diacritics: boolean;
  /** アラビア・インド数字とペルシア数字を算用数字にする */
  readonly digits: boolean;
  /** 小文字にそろえる */
  readonly caseFold: boolean;
  /** ゼロ幅の文字、双方向の制御文字、ソフトハイフン、BOM を除く */
  readonly invisibles: boolean;
  /** 連続する空白を 1 つにして前後を除く */
  readonly spaces: boolean;
}

/** ゆるい照合（既定）。すべての手順を適用し、NFKC から始める。 */
export const LOOSE_MATCH: MatchOptions = {
  compat: true,
  arabic: true,
  diacritics: true,
  digits: true,
  caseFold: true,
  invisibles: true,
  spaces: true,
};

/**
 * 厳密な照合。NFC 正規化だけを行う。
 *
 * 【なぜ】「見た目が同じなら同じ」までにとどめる。NFKC は全角と半角を同一視するなど、
 * 見た目の違うものまで同じにするため、ここでは使わない。
 */
export const STRICT_MATCH: MatchOptions = {
  compat: false,
  arabic: false,
  diacritics: false,
  digits: false,
  caseFold: false,
  invisibles: false,
  spaces: false,
};

// 【なぜ】範囲は D-20 のとおり。広げると、別の文字を同じに扱ってしまう。
// 母音記号（ファトハ、カスラ、ダンマ、シャッダ、スクーンなど、U+064B〜U+065F。
// ハムザ上下（U+0654、U+0655）とマッダ（U+0653）を含む。ه + U+0654（ペルシア語のエザーフェ、
// 「خانهٔ」のような書き方）が ه になるのはこのため）と短剣アリフ（U+0670）、
// コーランの記号（U+06D6〜U+06ED）、タトウィール（U+0640、文字を横に伸ばす飾り）。
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu;

// 【なぜ】アラビア文字の写本・刊本・入力方法では、同じ語がこれらの異なる文字で書かれる。
// ペルシア語・ウルドゥー語の文字（ی ک ۀ ە）も、アラビア語の文字にそろえて照合する。
// 【TS】`Record<K, V>` は「キーが K、値が V のオブジェクト」を表すユーティリティ型。
//       `Readonly<…>` で包むと、あとからキーの値を書き換えられなくなる。
const ARABIC_LETTER_MAP: Readonly<Record<string, string>> = {
  '\u0623': '\u0627', // أ（ハムザ上）→ ا
  '\u0625': '\u0627', // إ（ハムザ下）→ ا
  '\u0622': '\u0627', // آ（マッダ）→ ا
  '\u0671': '\u0627', // ٱ（ワスラ付き）→ ا
  '\u0624': '\u0648', // ؤ（ハムザ付きのワーウ）→ و
  '\u0626': '\u064A', // ئ（ハムザ付きのヤー）→ ي
  '\u0629': '\u0647', // ة（ター・マルブータ）→ ه
  '\u06C0': '\u0647', // ۀ → ه
  '\u06D5': '\u0647', // ە → ه
  '\u0649': '\u064A', // ى（アリフ・マクスーラ）→ ي
  '\u06CC': '\u064A', // ی（ペルシア文字のヤー）→ ي
  '\u06A9': '\u0643', // ک（ペルシア文字のカーフ）→ ك
};
const ARABIC_LETTERS =
  /[\u0623\u0625\u0622\u0671\u0624\u0626\u0629\u06C0\u06D5\u0649\u06CC\u06A9]/gu;

// 【なぜ】転写の ʿ（アイン）と ʾ（ハムザ）は、資料によって記号が違う（ʻ ʼ ‘ ’ ' `）うえ、
// 入力されないことも多い。そのため、すべて除く。
// ʹ（U+02B9）、ˊ ˋ（U+02CA、U+02CB）、′（U+2032）は、ʼ の代用として使われることがある。
// ʕ ʔ ˁ ˀ（U+0295、U+0294、U+02C1、U+02C0）は、言語学式の転写でアインとハムザを表す。
const TRANSLIT_MARKS =
  /[\u02BF\u02BE\u02BB\u02BC\u02B9\u02CA\u02CB\u2032\u2018\u2019'`\u0295\u0294\u02C1\u02C0]/gu;

// 【なぜ】Mu´awiya の ´（U+00B4）のように、補助記号が単独の文字として書かれることがある。
// NFKC は ´ を「空白 + U+0301」に変えるので、空白ごと除かないと「mu awiya」になる。
// compat を切ると NFKC が働かず ´ のまま残るため、単独の文字（´ ¨ ¯ ¸ ˆ ˘ ˙ ˚ ˛ ˜ ˝）も直接除く。
const SPACING_MARKS = /[\u00B4\u00A8\u00AF\u00B8\u02C6\u02D8-\u02DD]| [\u0300-\u036F]+/gu;

// 【なぜ】NFD で分解したあと、U+0300〜U+036F（ラテン文字などの結合用補助記号）だけを除く。
// 日本語の濁点（U+3099）と半濁点（U+309A）は範囲の外なので残り、「が」と「か」は別のキーになる。
const LATIN_COMBINING = /[\u0300-\u036F]/gu;

// 【なぜ】ZWNJ（U+200C）はペルシア語で語中に入れたり入れなかったりする（می‌روم と میروم）。
// ZWJ、ZWSP、双方向の制御文字（U+200E、U+200F、U+202A〜U+202E、U+2066〜U+2069）、
// ソフトハイフン（U+00AD）も、見えないのでコピーの際に紛れ込む。
// U+061C（アラビア文字用の方向印）、U+2060（WORD JOINER）、U+FEFF（BOM）も同様。
// U+FEFF は `\s` に含まれるため、先に除かないと空白に変わってしまう。
const INVISIBLES =
  /[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069\u00AD\u061C\u2060\uFEFF]/gu;

/**
 * 文字列から照合キーを作る。
 *
 * 同じキーになる文字列は「照合上は同じ」とみなせる。元の文字列は変えない。
 *
 * 制約: 小文字化は `toLowerCase` で、完全な case folding ではない（ß と ss、語末のシグマ ς と σ は別）。
 * ł ø đ ħ は NFD で分解できないので、そのまま残る（l、o、d、h にはならない）。
 *
 * @param text - 元の文字列
 * @param options - 手順ごとの設定。省略すると {@link LOOSE_MATCH}
 * @returns 照合キー
 *
 * @example
 * ```ts
 * matchKey('ʿAbbās') === matchKey('abbas'); // true
 * matchKey('أحمد') === matchKey('احمد'); // true
 * matchKey('が') === matchKey('か'); // false（濁点は除かない）
 * matchKey('ʿAbbās', STRICT_MATCH); // 'ʿAbbās'（NFC だけ）
 * ```
 */
export function matchKey(text: string, options: MatchOptions = LOOSE_MATCH): string {
  // 【なぜ】全角英数字（Ａ１）や、アラビア文字の表示形（ﻻ など）を通常の文字にそろえるのは NFKC の役目。
  // 一方、NFKC は見た目の違う文字まで同じにするので、厳密な照合では NFC に限る。
  let s = text.normalize(options.compat ? 'NFKC' : 'NFC');

  if (options.arabic) {
    // 【なぜ】文字の置換を、補助記号の除去（diacritics）より先に行う。
    // NFD では أ が ا + U+0654 に分解されるが、先に ا にそろえておけば順序によらず結果が同じになる。
    s = s.replace(ARABIC_MARKS, '').replace(ARABIC_LETTERS, (c) => ARABIC_LETTER_MAP[c] ?? c);
  }

  if (options.diacritics) {
    // 【なぜ】単独の補助記号を先に除く。NFD で分解した後では、空白が残ってしまう。
    // そのあと NFD → 除去 → NFC。arabic を切っているときは、أ が分解されても
    // U+0654 が範囲の外なので残り、NFC で أ に戻る（アラビア文字は勝手に変わらない）。
    s = s
      .replace(SPACING_MARKS, '')
      .normalize('NFD')
      .replace(LATIN_COMBINING, '')
      .normalize('NFC')
      .replace(TRANSLIT_MARKS, '')
      // 【なぜ】トルコ語の ı（点なしの i）は分解できない文字なので、個別に i にする。
      .replace(/\u0131/gu, 'i');
  }

  if (options.digits) {
    // 【なぜ】アラビア・インド数字（U+0660〜0669）とペルシア数字（U+06F0〜06F9）は、
    // 年代（1050 など）の照合で算用数字と同じに扱いたいため。
    s = s.replace(/[\u0660-\u0669\u06F0-\u06F9]/gu, (c) => {
      const code = c.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
  }

  if (options.caseFold) {
    // 【なぜ】toLowerCase は地域設定に依らない。diacritics が先に走るので、İ は i になる。
    s = s.toLowerCase();
  }

  // 【なぜ】invisibles は spaces より先。U+FEFF などが `\s` に含まれ、空白に化けるのを防ぐ。
  if (options.invisibles) {
    s = s.replace(INVISIBLES, '');
  }

  if (options.spaces) {
    s = s.replace(/\s+/gu, ' ').trim();
  }

  return s;
}

/**
 * 照合キーどうしの部分一致を判定する。
 *
 * @param haystack - 探される側の文字列
 * @param needle - 探す文字列。照合キーが空なら true
 * @param options - 手順ごとの設定。省略すると {@link LOOSE_MATCH}
 * @returns haystack のキーに needle のキーが含まれるなら true
 *
 * @example
 * ```ts
 * matchIncludes('Ḥasan al-Baṣrī', 'basri'); // true
 * ```
 */
export function matchIncludes(
  haystack: string,
  needle: string,
  options: MatchOptions = LOOSE_MATCH,
): boolean {
  // 【なぜ】空の検索語は「絞り込まない」意味で true。String.includes('') も true なので特別扱い不要。
  return matchKey(haystack, options).includes(matchKey(needle, options));
}
