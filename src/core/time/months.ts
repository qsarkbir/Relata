/**
 * ヒジュラ暦の月名（FR-TM-06、要件 §6.4「月の名前」、D-29）。
 *
 * アラビア文字の表記と、転写（IJMES 式、補助記号の有無、よくある綴りの揺れ）の両方を受け付ける。
 * 照合は照合キー（`matchKey`、D-20）を通して行うので、Ramaḍān、Ramadan、ʿ の有無、
 * アラビア文字の補助記号や ة と ه の違いは、ここでは区別されない。
 *
 * 【歴史の事情】同じ月でも、アラビア語圏（Ramaḍān）、ペルシア語圏（Ramażān）、
 * オスマン語・トルコ語（Ramazan）などで綴りが違う。「Dhū al-Qaʿda」のような「al-」を含む名前は、
 * 「Dhu'l-Qa'da」「Dhul Qaada」のように、ハイフンや空白の入れ方も揺れる。
 */
import { matchKey } from '../text';

/**
 * 月名を置き換える印の前後（私用領域の文字）。
 * 【なぜ】利用者の入力に `#9#` のような文字列があっても、印と衝突しないようにする。
 */
export const MONTH_OPEN = '\uE000';
export const MONTH_CLOSE = '\uE001';

/** IJMES 式の月名（表示用。FR-TM-09）。添字 0 が 1 月。 */
export const HIJRI_MONTH_LABELS = [
  'Muḥarram',
  'Ṣafar',
  'Rabīʿ al-Awwal',
  'Rabīʿ al-Thānī',
  'Jumādā al-Ūlā',
  'Jumādā al-Thāniya',
  'Rajab',
  'Shaʿbān',
  'Ramaḍān',
  'Shawwāl',
  'Dhū al-Qaʿda',
  'Dhū al-Ḥijja',
] as const;

// 月ごとの綴り。添字 0 が 1 月。単語は空白で区切って書く（ハイフンと空白は照合で同じに扱う）。
// 【TS】`readonly (readonly string[])[]` は「中身も変えられない文字列の配列」の配列。
//       外側と内側の両方に readonly を付けないと、内側の配列は書き換えられてしまう。
const SPELLINGS: readonly (readonly string[])[] = [
  ['Muḥarram', 'Moharram', 'Muharrem', 'محرم'],
  ['Ṣafar', 'Saphar', 'Safer', 'صفر'],
  [
    'Rabīʿ al-Awwal',
    'Rabi I',
    'Rabi al-Ula',
    'Rabiʿ ul Awwal',
    'Rabia al-Awwal',
    'Rabi al-Avval',
    'Rabi 1',
    'Rebiülevvel',
    'Rebiyülevvel',
    'ربيع الأول',
    'ربيع الاول',
  ],
  [
    'Rabīʿ al-Thānī',
    'Rabīʿ al-Ākhir',
    'Rabi II',
    'Rabi al-Tani',
    'Rabi al-Akhar',
    'Rabiʿ ul Akhir',
    'Rabi 2',
    'Rebiülahir',
    'Rebiyülahir',
    'Rabi ul Thani',
    'ربيع الثاني',
    'ربيع الآخر',
    'ربيع الاخر',
  ],
  [
    'Jumādā al-Ūlā',
    'Jumada I',
    'Jumada al-Awwal',
    'Jumada l-Ula',
    'Jumada ul Ula',
    'Jamadi al-Awwal',
    'Jumada 1',
    'Cemaziyelevvel',
    'Cemaziyülevvel',
    'جمادى الأولى',
    'جمادى الاولى',
    'جمادي الاولي',
  ],
  [
    'Jumādā al-Thāniya',
    'Jumādā al-Ākhira',
    'Jumada II',
    'Jumada al-Thani',
    'Jumada al-Tani',
    'Jumada al-Akhira',
    'Jumada al-Akhir',
    'Jumada 2',
    'Cemaziyelahir',
    'Cemaziyülahir',
    'Jumada al-Akhirah',
    'Jumada l-Akhira',
    'Jumada ul Akhira',
    'Jumada al-Thaniyah',
    'Jamadi al-Thani',
    'جمادى الآخرة',
    'جمادى الثانية',
    'جمادى الاخرة',
    'جمادي الاخرة',
  ],
  ['Rajab', 'Recep', 'رجب'],
  ['Shaʿbān', 'Shaaban', 'Shabaan', 'Şaban', 'شعبان'],
  ['Ramaḍān', 'Ramadhan', 'Ramazan', 'Ramzan', 'Ramadaan', 'Ramathan', 'رمضان'],
  ['Shawwāl', 'Shawal', 'Shavval', 'Shawwaal', 'Şevval', 'شوال'],
  [
    'Dhū al-Qaʿda',
    'Dhu al-Qadah',
    'Dhu l-Qada',
    'Dhu l-Qadah',
    'Dhul Qada',
    'Dhul Qadah',
    'Dhu al-Qida',
    'Dhul Qida',
    'Zu al-Qada',
    'Zul Qada',
    'Zilqada',
    'Zilkad',
    'Zilkade',
    'ذو القعدة',
    'ذي القعدة',
  ],
  [
    'Dhū al-Ḥijja',
    'Dhu al-Hijjah',
    'Dhu l-Hijja',
    'Dhu l-Hijjah',
    'Dhul Hijja',
    'Dhul Hijjah',
    'Zu al-Hijja',
    'Zul Hijja',
    'Zilhijja',
    'Zilhajj',
    'Zilhicce',
    'ذو الحجة',
    'ذي الحجة',
  ],
];

interface MonthPattern {
  readonly month: number;
  /** 単語ごとに照合キーにしたもの（ハイフンや空白で分けた単語） */
  readonly words: readonly string[];
  /** 長さの降順に試すための、単語の合計の長さ */
  readonly length: number;
}

/**
 * 正規表現の特別な文字をエスケープする。
 *
 * @param s - 文字列
 * @returns そのまま照合できる正規表現の断片
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// 【なぜ】照合キーに通してから単語に分ける。matchKey が ʿ や補助記号、アラビア文字の揺れを
// そろえるので、表の側と入力の側で同じ形になる。
const PATTERNS: readonly MonthPattern[] = SPELLINGS.flatMap((names, i) =>
  names.map((name) => {
    const words = matchKey(name)
      .split(/[\s-]+/u)
      .filter((w) => w !== '');
    return { month: i + 1, words, length: words.join('').length };
  }),
).sort((a, b) => b.length - a.length);

/** 文字（ラテン文字とアラビア文字）の境界。月名の前後に文字が続く場合は、別の単語の一部とみなす。 */
const LETTER = 'a-z\\u0600-\\u06ff';

const COMPILED: readonly { readonly month: number; readonly re: RegExp }[] = PATTERNS.map((p) => {
  // 【なぜ】「Rabi 1」のように数字で終わる綴りは、後ろに数字が続くとき（「Rabi 1050」）は月名ではない。
  const endsWithDigit = /\d$/u.test(p.words.join(''));
  const after = endsWithDigit ? `${LETTER}\\d` : LETTER;
  return {
    month: p.month,
    re: new RegExp(
      `(?<![${LETTER}])${p.words.map(escapeRegExp).join('[\\s-]*')}(?![${after}])`,
      'gu',
    ),
  };
});

/**
 * 照合キーにした文章の中のヒジュラ暦の月名を、月の番号を挟んだ印（私用領域の文字で挟む）に置き換える。
 *
 * 長い綴りから先に置き換える（「jumada ii」を「jumada i」より先に）。解析（parse.ts）が、
 * 月名の中のハイフン（al-Qaʿda）を範囲の記号と取り違えないために、最初に呼ぶ。
 * 計算量は、綴りの数を P、文字列の長さを n として O(P·n)。
 *
 * @param key - `matchKey` を通した文字列
 * @returns 月名を印に置き換えた文字列（前後に空白を足す）
 */
export function replaceHijriMonthNames(key: string): string {
  let s = key;
  for (const { month, re } of COMPILED)
    s = s.replace(re, ` ${MONTH_OPEN}${String(month)}${MONTH_CLOSE} `);
  return s.replace(/\s+/gu, ' ').trim();
}

/**
 * ヒジュラ暦の月名から月の番号（1〜12）を引く。
 *
 * @param name - 月名（アラビア文字でも転写でもよい）
 * @returns 1〜12。月名でなければ undefined
 *
 * @example
 * ```ts
 * hijriMonthFromName('Ramaḍān'); // 9
 * hijriMonthFromName('رمضان'); // 9
 * hijriMonthFromName('Ramadan 1050'); // undefined（月名だけを渡す）
 * ```
 */
export function hijriMonthFromName(name: string): number | undefined {
  const replaced = replaceHijriMonthNames(matchKey(name));
  const m = new RegExp(`^${MONTH_OPEN}(\\d+)${MONTH_CLOSE}$`, 'u').exec(replaced);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}
