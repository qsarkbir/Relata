import { describe, expect, it } from 'vitest';
import { LOOSE_MATCH, STRICT_MATCH, matchIncludes, matchKey, type MatchOptions } from './index';

// 【TS】`keyof MatchOptions` は MatchOptions のプロパティ名の共用体型。
// `{ ...A, [k]: v }` は A をコピーして 1 つだけ上書きする。
const only = (k: keyof MatchOptions): MatchOptions => ({ ...STRICT_MATCH, [k]: true });
const without = (k: keyof MatchOptions): MatchOptions => ({ ...LOOSE_MATCH, [k]: false });

describe('matchKey: アラビア文字', () => {
  it('FR-FL-12: ハムザ付きのアリフ・ワスラ付きを素のアリフと同じに扱う', () => {
    for (const c of ['\u0623', '\u0625', '\u0622', '\u0671']) expect(matchKey(c)).toBe('\u0627');
  });
  it('FR-FL-12: ター・マルブータをハーに、ۀ と ە もハーに', () => {
    expect(matchKey('مدينة')).toBe(matchKey('مدينه'));
    expect(matchKey('\u06C0')).toBe('\u0647');
    expect(matchKey('\u06D5')).toBe('\u0647');
  });
  it('FR-FL-12: アリフ・マクスーラとペルシア文字のヤーをヤーに', () => {
    expect(matchKey('مصطفى')).toBe(matchKey('مصطفي'));
    expect(matchKey('ایران')).toBe(matchKey('ايران'));
  });
  it('FR-FL-12: ペルシア文字のカーフをカーフに', () => {
    expect(matchKey('کتاب')).toBe(matchKey('كتاب'));
  });
  it('FR-FL-12: 母音記号とタトウィールを除く', () => {
    expect(matchKey('مُحَمَّد')).toBe('محمد');
    expect(matchKey('محـــمد')).toBe('محمد');
    expect(matchKey('ٱلله')).toBe('الله');
  });
  it('FR-FL-12: ZWNJ を除く（ペルシア語の表記の揺れ）', () => {
    expect(matchKey('می\u200Cروم')).toBe(matchKey('میروم'));
  });
  it('FR-FL-12: ؤ を و に、ئ を ي に', () => {
    expect(matchKey('\u0624')).toBe('\u0648');
    expect(matchKey('\u0626')).toBe('\u064A');
  });
  it('FR-FL-12: ه + U+0654（エザーフェ）は ه になる', () => {
    expect(matchKey('\u0647\u0654')).toBe('\u0647');
  });
  it('FR-FL-12: 補助記号の除去と順序によらず、أ は ا になる', () => {
    expect(matchKey('\u0623حمد')).toBe('احمد');
    expect(matchKey('\u0623حمد', { ...LOOSE_MATCH, diacritics: false })).toBe('احمد');
  });
  it('FR-FL-12: arabic を切ると、diacritics が有効でも أ は残る', () => {
    expect(matchKey('\u0623', without('arabic'))).toBe('\u0623');
  });
  it('FR-FL-12: 分解形の入力でも合成形と同じキーになる', () => {
    expect(matchKey('\u0627\u0654')).toBe(matchKey('\u0623'));
    expect(matchKey('h\u0323')).toBe(matchKey('\u1E25'));
    expect(matchKey('h\u0323', STRICT_MATCH)).toBe('\u1E25');
    expect(matchKey('\u0627\u0654', STRICT_MATCH)).toBe('\u0623');
  });
});

describe('matchKey: 転写', () => {
  it('FR-FL-12: ʿ と ʾ を除き、補助記号を落とす', () => {
    expect(matchKey('ʿAbbās')).toBe('abbas');
    expect(matchKey('Ḥasan')).toBe('hasan');
    expect(matchKey('Ṣalāḥ al-Dīn')).toBe('salah al-din');
    expect(matchKey('Mūsā')).toBe('musa');
    expect(matchKey('Qur\u2019ān')).toBe('quran');
    expect(matchKey('Ibn Ḥayyān ʾAbū')).toBe('ibn hayyan abu');
  });
  it('FR-FL-12: ʹ ʕ ʔ などの転写記号を除く', () => {
    expect(matchKey('a\u02B9b\u0295c\u0294d\u02C1e\u02C0f\u2032g\u02CAh\u02CBi')).toBe('abcdefghi');
  });
  it('FR-FL-12: 単独の補助記号を空白ごと除く', () => {
    expect(matchKey('Mu\u00B4awiya')).toBe('muawiya');
    expect(matchKey('Mu\u00B4awiya', without('compat'))).toBe('muawiya');
    expect(matchKey('a\u00A8b\u00AFc\u02D8d')).toBe('abcd');
  });
  it('FR-FL-12: ı を i に、İ を i に', () => {
    expect(matchKey('Isparta ılık')).toBe('isparta ilik');
    expect(matchKey('İstanbul')).toBe('istanbul');
  });
  it('FR-FL-12: 日本語の濁点・半濁点を除かない', () => {
    expect(matchKey('が')).not.toBe(matchKey('か'));
    expect(matchKey('ぱ')).not.toBe(matchKey('は'));
    expect(matchKey('か\u3099')).toBe('が'); // 分解形は合成形にそろう
  });
});

describe('matchKey: 数字・全角・大文字小文字・空白', () => {
  it('FR-FL-12: アラビア・インド数字とペルシア数字を算用数字に', () => {
    expect(matchKey('١٠٥٠')).toBe('1050');
    expect(matchKey('۱۰۵۰')).toBe('1050');
    expect(matchKey('٠۹')).toBe('09');
  });
  it('FR-FL-12: 全角英数字を NFKC で半角に', () => {
    expect(matchKey('ＡＢＣ１２３')).toBe('abc123');
  });
  it('FR-FL-12: 大文字小文字を無視する', () => {
    expect(matchKey('AbBAs')).toBe('abbas');
  });
  it('FR-FL-12: 連続する空白を 1 つにし、前後を除く。ゼロ幅の文字も除く', () => {
    expect(matchKey('  a \t\n b\u00A0 c  ')).toBe('a b c');
    expect(matchKey('a\u200Bb\u00ADc\u202Ad')).toBe('abcd');
  });
  it('FR-FL-12: U+061C、U+2060、U+FEFF を除き、空白に化けない', () => {
    expect(matchKey('a\u061Cb')).toBe('ab');
    expect(matchKey('a\u2060b')).toBe('ab');
    expect(matchKey('a\uFEFFb')).toBe('ab');
  });
  it('FR-FL-12: 空文字は空のまま', () => {
    expect(matchKey('')).toBe('');
  });
});

describe('matchKey: 厳密な照合と個別の設定', () => {
  it('FR-FL-12: 厳密な照合では区別が残る', () => {
    expect(matchKey('ʿAbbās', STRICT_MATCH)).toBe('ʿAbbās');
    expect(matchKey('\u0623', STRICT_MATCH)).not.toBe(matchKey('\u0627', STRICT_MATCH));
    expect(matchKey('١', STRICT_MATCH)).toBe('١');
    expect(matchKey('Ａ', STRICT_MATCH)).toBe('Ａ');
    expect(matchKey(' a  b ', STRICT_MATCH)).toBe(' a  b ');
    expect(matchKey('a\u200Cb', STRICT_MATCH)).toBe('a\u200Cb');
  });
  it('FR-FL-12: 厳密な照合は NFC だけ行う', () => {
    expect(matchKey('a\u0304', STRICT_MATCH)).toBe('ā');
  });
  it('FR-FL-12: 既定は LOOSE_MATCH', () => {
    expect(matchKey('Ḥ')).toBe(matchKey('Ḥ', LOOSE_MATCH));
  });
  it('FR-FL-12: compat だけ有効', () => {
    expect(matchKey('Ａ\u00A0b', only('compat'))).toBe('A b');
  });
  it('FR-FL-12: compat だけ切ると全角が残る（ほかの手順は働く）', () => {
    expect(matchKey('Ａ１', without('compat'))).toBe('ａ１');
  });
  it('FR-FL-12: diacritics だけ有効', () => {
    expect(matchKey('Ḥasan', only('diacritics'))).toBe('Hasan');
  });
  it('FR-FL-12: digits だけ有効', () => {
    expect(matchKey('Ａ١', only('digits'))).toBe('Ａ1');
  });
  it('FR-FL-12: caseFold だけ有効', () => {
    expect(matchKey('ĀB', only('caseFold'))).toBe('āb');
  });
  it('FR-FL-12: invisibles だけ有効', () => {
    expect(matchKey(' a\u200Cb ', only('invisibles'))).toBe(' ab ');
  });
  it('FR-FL-12: invisibles だけ切ると ZWNJ が残る', () => {
    expect(matchKey('a\u200Cb', without('invisibles'))).toBe('a\u200Cb');
  });
  it('FR-FL-12: spaces だけ有効', () => {
    expect(matchKey(' A  b ', only('spaces'))).toBe('A b');
  });
  it('FR-FL-12: arabic だけ有効', () => {
    expect(matchKey('\u0623\u064E', only('arabic'))).toBe('\u0627');
  });
  it('FR-FL-12: 各設定を切ると、その手順だけが無効になる', () => {
    expect(matchKey('Ḥ', without('diacritics'))).toBe('ḥ');
    expect(matchKey('١', without('digits'))).toBe('١');
    expect(matchKey('A', without('caseFold'))).toBe('A');
    expect(matchKey(' a  b ', without('spaces'))).toBe(' a  b ');
  });
});

describe('matchIncludes', () => {
  it('FR-FL-12: 部分一致する', () => {
    expect(matchIncludes('Ḥasan al-Baṣrī', 'basri')).toBe(true);
    expect(matchIncludes('Ḥasan', 'zayd')).toBe(false);
  });
  it('FR-FL-12: 空の検索語は true', () => {
    expect(matchIncludes('abc', '')).toBe(true);
    expect(matchIncludes('abc', ' \u200C')).toBe(true);
    expect(matchIncludes('', '')).toBe(true);
  });
  it('FR-FL-12: 厳密な照合を指定できる', () => {
    expect(matchIncludes('Ḥasan', 'hasan', STRICT_MATCH)).toBe(false);
    expect(matchIncludes('Ḥasan', 'Ḥas', STRICT_MATCH)).toBe(true);
  });
});
