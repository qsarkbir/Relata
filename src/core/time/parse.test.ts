import { describe, expect, it } from 'vitest';
import { gregorianToJdn as g, hijriToJdn as h } from './calendars';
import { hijriMonthFromName, HIJRI_MONTH_LABELS, replaceHijriMonthNames } from './months';
import { matchKey } from '../text';
import { parseDate, parseTimeSpan } from './index';
import type { DateParseResult } from './index';

/**
 * 成功を前提に値を取り出す。失敗なら理由を含めてテストを落とす。
 *
 * @param text - 日付の文字列
 * @param options - 解析の選択肢
 * @returns 成功の結果
 */
function ok(text: string, options = {}) {
  const r: DateParseResult = parseDate(text, options);
  if (!r.ok) throw new Error(`「${text}」が失敗: ${r.reason.code} ${r.reason.message}`);
  return r;
}
function range(text: string, options = {}): [number, number] {
  const v = ok(text, options).value;
  return [v.earliest, v.latest];
}
function failure(text: string, options = {}) {
  const r = parseDate(text, options);
  if (r.ok) throw new Error(`「${text}」が成功してしまった`);
  return r.reason;
}

describe('要件 §6.4 西暦の書式', () => {
  it('FR-DM-05: 年は 1 月 1 日〜12 月 31 日の幅', () => {
    const r = ok('1650');
    expect([r.value.earliest, r.value.latest]).toEqual([g(1650, 1, 1), g(1650, 12, 31)]);
    expect(r.value.certainty).toBe('certain');
    expect(r.value.calendar).toBe('gregorian');
    expect(r.value.label).toBe('1650');
    expect(r.warnings).toEqual([]);
  });

  it('FR-DM-05: 年月は月初〜月末、年月日は 1 日', () => {
    expect(range('1650-03')).toEqual([g(1650, 3, 1), g(1650, 3, 31)]);
    expect(range('1650-02')).toEqual([g(1650, 2, 1), g(1650, 2, 28)]);
    expect(range('1650-03-15')).toEqual([g(1650, 3, 15), g(1650, 3, 15)]);
  });

  it('FR-DM-05: 頃（c.、ca.、頃、~）は前後 5 年、確からしさ probable', () => {
    for (const t of ['c.1650', 'c. 1650', 'ca. 1650', 'ca.1650', 'circa 1650', '1650頃', '~1650']) {
      const r = ok(t);
      expect([r.value.earliest, r.value.latest]).toEqual([g(1645, 1, 1), g(1655, 12, 31)]);
      expect(r.value.certainty).toBe('probable');
      expect(r.value.label).toBe(t);
    }
  });

  it('FR-DM-05: 頃の幅は設定で変えられる', () => {
    expect(range('c.1650', { circaYears: 10 })).toEqual([g(1640, 1, 1), g(1660, 12, 31)]);
    expect(range('c.1650', { circaYears: 0 })).toEqual([g(1650, 1, 1), g(1650, 12, 31)]);
    // 不正な設定は既定に戻す（例外は投げない）
    expect(range('c.1650', { circaYears: -3 })).toEqual([g(1645, 1, 1), g(1655, 12, 31)]);
    expect(range('c.1650', { circaYears: Number.NaN })).toEqual([g(1645, 1, 1), g(1655, 12, 31)]);
  });

  it('FR-DM-05: ? は 1650 年の幅で、確からしさ possible', () => {
    const r = ok('1650?');
    expect([r.value.earliest, r.value.latest]).toEqual([g(1650, 1, 1), g(1650, 12, 31)]);
    expect(r.value.certainty).toBe('possible');
    expect(ok('c.1650?').value.certainty).toBe('possible');
    expect(ok('1650？').value.certainty).toBe('possible');
  });

  it('FR-DM-05: 範囲（/、-、〜、～）は始まりの年初から終わりの年末まで', () => {
    for (const t of [
      '1640/1660',
      '1640-1660',
      '1640〜1660',
      '1640～1660',
      '1640 - 1660',
      '1640 / 1660',
    ]) {
      expect(range(t)).toEqual([g(1640, 1, 1), g(1660, 12, 31)]);
    }
    expect(range('1640-03/1660-05')).toEqual([g(1640, 3, 1), g(1660, 5, 31)]);
    expect(range('1640-03-05-1660-05-07')).toEqual([g(1640, 3, 5), g(1660, 5, 7)]);
  });

  it('FR-DM-05: 範囲の確からしさは弱い方、期間の両端がそれぞれ頃を取れる', () => {
    const r = ok('c.1640-1660');
    expect([r.value.earliest, r.value.latest]).toEqual([g(1635, 1, 1), g(1660, 12, 31)]);
    expect(r.value.certainty).toBe('probable');
    expect(ok('c.1640/1660?').value.certainty).toBe('possible');
  });

  it('FR-DM-05: 1640-12 は年月、1640-1660 は範囲（区別する）', () => {
    expect(range('1640-12')).toEqual([g(1640, 12, 1), g(1640, 12, 31)]);
    expect(range('1640-1660')).toEqual([g(1640, 1, 1), g(1660, 12, 31)]);
    expect(range('1640-12-31')).toEqual([g(1640, 12, 31), g(1640, 12, 31)]);
    // 右が 3 桁以上なら月ではなく範囲（右が左より前なので失敗する）
    expect(failure('1640-123').code).toBe('range-reversed');
  });

  it('FR-DM-05: 紀元前（BC44、前44、紀元前44年）は天文学的な年で -43 年', () => {
    for (const t of [
      'BC44',
      'bc 44',
      '44 BC',
      '44BC',
      '44 BCE',
      '前44',
      '紀元前44',
      '紀元前44年',
      '前44年',
    ]) {
      expect(range(t)).toEqual([g(-43, 1, 1), g(-43, 12, 31)]);
    }
    // 紀元前 1 年は 0 年
    expect(range('BC1')).toEqual([g(0, 1, 1), g(0, 12, 31)]);
    expect(range('BC144-03-15')).toEqual([g(-143, 3, 15), g(-143, 3, 15)]);
    expect(range('BC44-BC40')).toEqual([g(-43, 1, 1), g(-39, 12, 31)]);
    expect(range('44/40 BC')).toEqual([g(-43, 1, 1), g(-39, 12, 31)]);
    expect(range('前44〜前40')).toEqual([g(-43, 1, 1), g(-39, 12, 31)]);
  });

  it('FR-DM-05: 紀元後の印（CE、AD、西暦）は付けても同じ', () => {
    for (const t of ['1650 CE', 'CE 1650', 'AD 1650', '1650 AD', '西暦1650年']) {
      const r = ok(t, { calendar: 'hijri' });
      expect(r.value.calendar).toBe('gregorian');
      expect([r.value.earliest, r.value.latest]).toEqual([g(1650, 1, 1), g(1650, 12, 31)]);
    }
  });
});

describe('要件 §6.4 ヒジュラ暦の書式', () => {
  it('FR-TM-06: 1050 AH は 1640-04-23〜1641-04-11', () => {
    for (const t of [
      '1050 AH',
      '1050AH',
      '1050H',
      '1050 H',
      'AH 1050',
      'AH1050',
      '1050 هـ',
      '١٠٥٠ هـ',
      '۱۰۵۰ هـ',
      '1050 ه',
    ]) {
      const r = ok(t);
      expect(r.value.calendar).toBe('hijri');
      expect([r.value.earliest, r.value.latest]).toEqual([g(1640, 4, 23), g(1641, 4, 11)]);
    }
  });

  it('FR-TM-06: 月名（転写の揺れ、アラビア文字）は月初〜月末', () => {
    const expected = [h(1050, 9, 1), h(1050, 9, 30)];
    for (const t of [
      'Ramaḍān 1050',
      'Ramadan 1050',
      'ramadhan 1050',
      'RAMAZAN 1050',
      'Ramaḍān 1050 AH',
      'Ramaḍān, 1050',
      'رمضان ١٠٥٠',
      'رمضان 1050 هـ',
    ]) {
      expect(range(t)).toEqual(expected);
    }
  });

  it('FR-TM-06: 年月日は前後 2 日の幅（15 Ramaḍān 1050 ＝ 1640-12-29 の前後）', () => {
    for (const t of [
      '15 Ramaḍān 1050',
      '15 Ramadan 1050 AH',
      '15 رمضان ١٠٥٠',
      '1050-09-15 AH',
      'Ramadan 15, 1050',
    ]) {
      expect(range(t)).toEqual([g(1640, 12, 27), g(1640, 12, 31)]);
      expect(ok(t).value.calendar).toBe('hijri');
    }
    expect(range('1050-09-15 AH', { hijriDayMargin: 0 })).toEqual([
      g(1640, 12, 29),
      g(1640, 12, 29),
    ]);
    expect(range('15 Ramadan 1050', { hijriDayMargin: 5 })).toEqual([
      g(1640, 12, 24),
      g(1641, 1, 3),
    ]);
  });

  it('FR-TM-06: 月名の綴りの揺れと、al- を含む名前のハイフンは範囲と取り違えない', () => {
    expect(hijriMonthFromName('Dhū al-Qaʿda')).toBe(11);
    expect(hijriMonthFromName("Dhu'l-Qa'da")).toBe(11);
    expect(hijriMonthFromName('dhul qada')).toBe(11);
    expect(hijriMonthFromName('ذو القعدة')).toBe(11);
    expect(hijriMonthFromName('ذو الحجة')).toBe(12);
    expect(hijriMonthFromName('Dhū al-Ḥijja')).toBe(12);
    expect(hijriMonthFromName('Rabīʿ al-Awwal')).toBe(3);
    expect(hijriMonthFromName('Rabi II')).toBe(4);
    expect(hijriMonthFromName('Jumādā al-Ūlā')).toBe(5);
    expect(hijriMonthFromName('Jumada II')).toBe(6);
    expect(hijriMonthFromName('Shaʿbān')).toBe(8);
    expect(hijriMonthFromName('محرم')).toBe(1);
    expect(hijriMonthFromName('Ramadan 1050')).toBeUndefined();
    expect(hijriMonthFromName('March')).toBeUndefined();
    expect(range('Dhū al-Qaʿda 1050')).toEqual([h(1050, 11, 1), h(1050, 11, 30)]);
    expect(range('1 Dhu al-Hijja 1050')).toEqual([h(1050, 12, 1) - 2, h(1050, 12, 1) + 2]);
    // すべての IJMES 式の月名が、自分の番号に戻る
    HIJRI_MONTH_LABELS.forEach((label, i) => {
      expect(hijriMonthFromName(label)).toBe(i + 1);
    });
  });

  it('FR-TM-06: 頃（c. 1050 AH、1050 AH 頃）は前後 5 年', () => {
    for (const t of ['c. 1050 AH', '1050 AH 頃', 'c.1050 هـ']) {
      const r = ok(t);
      expect(r.value.calendar).toBe('hijri');
      expect(r.value.certainty).toBe('probable');
      expect([r.value.earliest, r.value.latest]).toEqual([h(1045, 1, 1), h(1056, 1, 1) - 1]);
    }
  });

  it('FR-IN-05: 列の暦がヒジュラ暦なら、印が無くてもヒジュラ暦で読む', () => {
    expect(range('1050', { calendar: 'hijri' })).toEqual([g(1640, 4, 23), g(1641, 4, 11)]);
    expect(ok('1050', { calendar: 'hijri' }).value.calendar).toBe('hijri');
    expect(range('1050-09-15', { calendar: 'hijri' })).toEqual([g(1640, 12, 27), g(1640, 12, 31)]);
    // 西暦の列でも、印があればヒジュラ暦
    expect(ok('1050 AH', { calendar: 'gregorian' }).value.calendar).toBe('hijri');
  });

  it('FR-TM-06: ヒジュラ暦の範囲（片方の印を共有する）', () => {
    expect(range('1050/1060 AH')).toEqual([h(1050, 1, 1), h(1061, 1, 1) - 1]);
    expect(range('1050 AH - 1060')).toEqual([h(1050, 1, 1), h(1061, 1, 1) - 1]);
    expect(ok('1050 AH - 1060').value.calendar).toBe('hijri');
  });
});

describe('併記（FR-TM-06）', () => {
  it('FR-TM-06: 1050 AH / 1640 CE はヒジュラ暦の値を採り、重なれば警告しない', () => {
    for (const t of [
      '1050 AH / 1640 CE',
      '1640 CE / 1050 AH',
      '1050 AH (1640 CE)',
      '1050 AH - 1640 CE',
    ]) {
      const r = ok(t);
      expect(r.value.calendar).toBe('hijri');
      expect([r.value.earliest, r.value.latest]).toEqual([g(1640, 4, 23), g(1641, 4, 11)]);
      expect(r.value.label).toBe(t);
      expect(r.warnings).toEqual([]);
    }
  });

  it('FR-TM-06: 併記が食い違えば警告する（値は作る）', () => {
    const r = ok('1050 AH / 1700 CE');
    expect(r.warnings.map((w) => w.code)).toEqual(['parallel-mismatch']);
    expect([r.value.earliest, r.value.latest]).toEqual([g(1640, 4, 23), g(1641, 4, 11)]);
    // 日付まで書かれた併記
    expect(ok('15 Ramadan 1050 / 1640-12-29 CE').warnings).toEqual([]);
    expect(ok('15 Ramadan 1050 / 1640-12-01 CE').warnings.length).toBe(1);
    // 紀元前の西暦との併記
    expect(ok('1050 AH / 44 BC').warnings.length).toBe(1);
  });
});

describe('アラビア・インド数字とペルシア数字（要件 §6.4）', () => {
  it('FR-TM-06: 西暦でも読める', () => {
    expect(range('١٦٥٠')).toEqual([g(1650, 1, 1), g(1650, 12, 31)]);
    expect(range('۱۶۵۰-۰۳-۱۵')).toEqual([g(1650, 3, 15), g(1650, 3, 15)]);
    expect(range('١٦٤٠/١٦٦٠')).toEqual([g(1640, 1, 1), g(1660, 12, 31)]);
  });
});

describe('解析できない書式（失敗と理由）', () => {
  it('FR-DM-05: 空は empty', () => {
    expect(failure('').code).toBe('empty');
    expect(failure('   ').code).toBe('empty');
  });

  it('FR-DM-05: 入力ごとの期待（成功なら値、失敗ならコード）。例外は投げない', () => {
    // 全角の数字は NFKC で半角になるので、成功する。
    const table: [string, string][] = [
      ['abc', 'unrecognized'],
      ['March 1650', 'unrecognized'],
      ['1650-', 'unrecognized'],
      ['-1650', 'unrecognized'],
      ['/1650', 'unrecognized'],
      ['1650/', 'unrecognized'],
      ['１６５０', 'ok'],
      ['１６５０年３月', 'ok'],
      ['c.', 'unrecognized'],
      ['1650 AH 1640', 'unrecognized'],
      ['17th century', 'unrecognized'],
      ['1650s', 'unrecognized'],
      ['1650年代', 'unrecognized'],
      ['〜1650', 'open-range-unsupported'],
      ['～1650', 'open-range-unsupported'],
      ['1650〜', 'unrecognized'],
      ['10/1050', 'ambiguous-slash'],
      ['1650/3', 'ambiguous-slash'],
    ];
    for (const [text, expected] of table) {
      const r = parseDate(text);
      if (expected === 'ok') {
        expect(r.ok, text).toBe(true);
      } else {
        expect(r.ok, text).toBe(false);
        if (!r.ok) {
          expect(r.reason.code, text).toBe(expected);
          expect(r.reason.message).not.toBe('');
        }
      }
    }
  });

  it('FR-DM-05: 月、日、年の誤り', () => {
    expect(failure('1640-13').code).toBe('invalid-month');
    expect(failure('1640-00').code).toBe('invalid-month');
    expect(failure('1650-02-30').code).toBe('invalid-day');
    expect(failure('1900-02-29').code).toBe('invalid-day');
    expect(parseDate('2000-02-29').ok).toBe(true);
    expect(failure('1051-12-30 AH').code).toBe('invalid-day');
    expect(failure('0').code).toBe('invalid-year');
    expect(failure('BC0').code).toBe('invalid-year');
    expect(failure('12345678').code).toBe('invalid-year');
    expect(failure('30 Safar 1050').code).toBe('invalid-day');
  });

  it('FR-DM-05: 紀元前とヒジュラ暦、暦の食い違い、範囲の誤り', () => {
    expect(failure('44 BC AH').code).toBe('unrecognized');
    expect(failure('Ramadan 1050 BC').code).toBe('bc-with-hijri');
    expect(failure('Ramadan 1050 CE').code).toBe('calendar-conflict');
    expect(failure('1660-1640').code).toBe('range-reversed');
    expect(failure('1640/1650/1660').code).toBe('too-many-ranges');
    expect(failure('1640-1650-1660').code).toBe('too-many-ranges');
  });

  it('FR-DM-05: 範囲の片方の誤りも失敗として返す', () => {
    expect(failure('1640/abc').code).toBe('unrecognized');
    expect(failure('1640-02-30/1650').code).toBe('invalid-day');
    expect(failure('1640/1650-13').code).toBe('invalid-month');
  });
});

describe('parseTimeSpan（FR-DM-05、D-19）', () => {
  it('FR-DM-05: 終点の列が無ければ end を持たない', () => {
    const r = parseTimeSpan('1650-03-15');
    if (!r.ok) throw new Error('失敗');
    expect(r.value.kind).toBe('span');
    expect(r.value.end).toBeUndefined();
    expect(r.value.start.earliest).toBe(g(1650, 3, 15));
  });

  it('FR-DM-05: 終点が空なら Missing（終わりが分からない）', () => {
    for (const e of ['', '  ']) {
      const r = parseTimeSpan('1650', e);
      if (!r.ok) throw new Error('失敗');
      expect(r.value.end).toEqual({ kind: 'missing', reason: 'unrecorded' });
    }
  });

  it('FR-DM-05: 始点と終点がそれぞれ幅を持てる（c.1650 から c.1660 まで）', () => {
    const r = parseTimeSpan('c.1650', 'c.1660', { circaYears: 5 });
    if (!r.ok) throw new Error('失敗');
    expect(r.value.start.latest).toBe(g(1655, 12, 31));
    const end = r.value.end;
    if (end === undefined || !('earliest' in end)) throw new Error('終点が無い');
    expect(end.earliest).toBe(g(1655, 1, 1));
    expect(r.warnings).toEqual([]);
  });

  it('FR-DM-05: 失敗はどちらの入力かを field で示す', () => {
    const a = parseTimeSpan('abc', '1650');
    expect(!a.ok && a.reason.field).toBe('start');
    const b = parseTimeSpan('1650', 'abc');
    expect(!b.ok && b.reason.field).toBe('end');
    expect(!b.ok && b.reason.code).toBe('unrecognized');
  });

  it('FR-DM-05: 終点が始点より前なら警告する', () => {
    const r = parseTimeSpan('1660', '1650');
    if (!r.ok) throw new Error('失敗');
    expect(r.warnings.map((w) => w.code)).toEqual(['span-reversed']);
    // 年が重なる（同じ年）なら警告しない
    const same = parseTimeSpan('1650', '1650');
    if (!same.ok) throw new Error('失敗');
    expect(same.warnings).toEqual([]);
  });

  it('FR-DM-05: 始点が空や空白だけなら empty の失敗（終点の空とは扱いが違う）', () => {
    for (const x of ['', '   ']) {
      const r = parseTimeSpan(x, '1650');
      expect(!r.ok && r.reason.code, JSON.stringify(x)).toBe('empty');
      expect(!r.ok && r.reason.field, JSON.stringify(x)).toBe('start');
    }
  });

  it('FR-TM-06: 始点と終点の暦が違っても、JDN で前後を判定する', () => {
    // 1050 AH は 1640-04-23〜1641-04-11。終点 1640 年（〜1640-12-31）は始点の最初の日より後なので警告なし。
    const ok1 = parseTimeSpan('1050 AH', '1640');
    if (!ok1.ok) throw new Error('失敗');
    expect(ok1.value.start.calendar).toBe('hijri');
    const end1 = ok1.value.end;
    expect(end1 !== undefined && 'calendar' in end1 && end1.calendar).toBe('gregorian');
    expect(ok1.warnings).toEqual([]);
    // 1060 AH（1649〜1650 年）の後に 1640 年は来ないので警告する。値は作る。
    const rev = parseTimeSpan('1060 AH', '1640');
    if (!rev.ok) throw new Error('失敗');
    expect(rev.warnings.map((w) => w.code)).toEqual(['span-reversed']);
    expect(rev.warnings[0]?.message).toContain('1060 AH');
    // 逆向き（始点が西暦、終点がヒジュラ暦）でも同じ
    const rev2 = parseTimeSpan('1650', '1050 AH');
    if (!rev2.ok) throw new Error('失敗');
    expect(rev2.warnings.map((w) => w.code)).toEqual(['span-reversed']);
  });

  it('FR-TM-06: ヒジュラ暦の列の期間（暦の選択肢が両端に効く）', () => {
    const r = parseTimeSpan('1050', '1060', { calendar: 'hijri' });
    if (!r.ok) throw new Error('失敗');
    expect(r.value.start.calendar).toBe('hijri');
  });
});

describe('併記と範囲の判定（D-29 補足 1〜4、7）', () => {
  it('FR-TM-06: 片側だけの印で併記と推測する（parallel-inferred）', () => {
    for (const x of [
      '1050 AH / 1640',
      '1050 AH (1640)',
      '1050 (1640 CE)',
      'Ramaḍān 1050 / 1640',
      '15 Ramadan 1050 / c.1640',
    ]) {
      const r = ok(x);
      expect(r.value.calendar, x).toBe('hijri');
      expect(r.value.earliest, x).toBeGreaterThanOrEqual(h(1050, 1, 1) - 5);
    }
    expect(ok('1050 AH / 1640').warnings.map((w) => w.code)).toEqual(['parallel-inferred']);
    // 括弧は常に併記なので、推測の警告は付かない
    expect(ok('1050 AH (1640)').warnings).toEqual([]);
    expect(range('1050 (1640 CE)')).toEqual([h(1050, 1, 1), h(1051, 1, 1) - 1]);
  });

  it('FR-DM-05: 重ならなければ同じ暦の範囲（1050/1060 AH、44/40 BC）', () => {
    expect(range('1050/1060 AH')).toEqual([h(1050, 1, 1), h(1061, 1, 1) - 1]);
    expect(range('44/40 BC')).toEqual([g(-43, 1, 1), g(-39, 12, 31)]);
    expect(range('1050 AH / 1060')).toEqual([h(1050, 1, 1), h(1061, 1, 1) - 1]);
    expect(ok('1050/1060 AH').warnings).toEqual([]);
  });

  it('FR-DM-05: 年月と読むのは左の年が 3 桁以上のときだけ', () => {
    expect(range('8-10 AH')).toEqual([h(8, 1, 1), h(11, 1, 1) - 1]);
    expect(range('1-12 AH')).toEqual([h(1, 1, 1), h(13, 1, 1) - 1]);
    expect(range('10-5 BC')).toEqual([g(-9, 1, 1), g(-4, 12, 31)]);
    // 5-10 BC は範囲（年月ではない）なので、始まりが終わりより後で失敗する
    expect(failure('5-10 BC').code).toBe('range-reversed');
    expect(range('8-10', { calendar: 'hijri' })).toEqual([h(8, 1, 1), h(11, 1, 1) - 1]);
    expect(range('1611-12')).toEqual([g(1611, 12, 1), g(1611, 12, 31)]);
  });

  it('FR-DM-05: en ダッシュ、em ダッシュ、〜、～ は常に範囲。en ダッシュは略記を補う', () => {
    expect(range('1640–41')).toEqual([g(1640, 1, 1), g(1641, 12, 31)]);
    expect(range('1049–50 AH')).toEqual([h(1049, 1, 1), h(1051, 1, 1) - 1]);
    expect(range('1640—1660')).toEqual([g(1640, 1, 1), g(1660, 12, 31)]);
    expect(range('1640–1660')).toEqual([g(1640, 1, 1), g(1660, 12, 31)]);
    expect(range('1640-12–1641-01')).toEqual([g(1640, 12, 1), g(1641, 1, 31)]);
    const r = ok('1050 AH / 1640–41 CE');
    expect(r.value.calendar).toBe('hijri');
    expect(r.warnings).toEqual([]);
    expect([r.value.earliest, r.value.latest]).toEqual([h(1050, 1, 1), h(1051, 1, 1) - 1]);
  });

  it('FR-DM-05: 併記の確からしさは両側の弱い方', () => {
    expect(ok('1050 AH / 1640 CE ?').value.certainty).toBe('possible');
    expect(ok('c.1050 AH / 1640 CE').value.certainty).toBe('probable');
    expect(ok('1050 AH / 1640 CE').value.certainty).toBe('certain');
  });

  it('FR-DM-05: 括弧の併記が同じ暦なら失敗', () => {
    expect(failure('1050 AH (1051 AH)').code).toBe('calendar-conflict');
  });
});

describe('「頃」の幅の作り直し（D-29 補足 6）と選択肢の上限（補足 8）', () => {
  it('FR-DM-05: 月の精度は、ずらした年の同じ月で作り直す（閏年の末日が欠けない）', () => {
    expect(range('c.1651-02')).toEqual([g(1646, 2, 1), g(1656, 2, 29)]);
    expect(range('c.1050 AH')).toEqual([h(1045, 1, 1), h(1056, 1, 1) - 1]);
  });

  it('FR-DM-05: 頃は紀元前や、ヒジュラ暦の紀元より前に及んでもよい', () => {
    expect(range('c.3')).toEqual([g(-2, 1, 1), g(8, 12, 31)]);
    expect(range('c.2 AH')).toEqual([h(-3, 1, 1), h(8, 1, 1) - 1]);
  });

  it('FR-DM-05: 上限を超えた選択肢は既定値に戻す', () => {
    expect(range('c.1650', { circaYears: 1001 })).toEqual([g(1645, 1, 1), g(1655, 12, 31)]);
    expect(range('c.1650', { circaYears: 1000 })).toEqual([g(650, 1, 1), g(2650, 12, 31)]);
    expect(range('1050-09-15 AH', { hijriDayMargin: 367 })).toEqual(range('1050-09-15 AH'));
    expect(range('1050-09-15 AH', { hijriDayMargin: 366 })[0]).toBe(h(1050, 9, 15) - 366);
  });
});

describe('月名と年の書き方（D-29 補足 9）', () => {
  it('FR-TM-06: 数字つきの月名、オスマン語の綴り、Jumada al-Akhir', () => {
    const cases: [string, number][] = [
      ['Jumada al-Akhir', 6],
      ['Rabi 1', 3],
      ['Rabi 2', 4],
      ['Jumada 1', 5],
      ['Jumada 2', 6],
      ['Muharrem', 1],
      ['Safer', 2],
      ['Rebiülevvel', 3],
      ['Rebiülahir', 4],
      ['Cemaziyelevvel', 5],
      ['Cemaziyelahir', 6],
      ['Recep', 7],
      ['Şaban', 8],
      ['Ramazan', 9],
      ['Şevval', 10],
      ['Zilkade', 11],
      ['Zilhicce', 12],
    ];
    for (const [name, month] of cases) {
      expect(hijriMonthFromName(name), name).toBe(month);
    }
    // 数字つきの月名のあとの年は、月名の一部にならない（「Rabi 1」＋「1050」）
    expect(range('Rabi 1 1050')).toEqual([h(1050, 3, 1), h(1050, 3, 30)]);
    expect(hijriMonthFromName('Rabi 1050')).toBeUndefined();
  });

  it('FR-TM-06: 年の前の سنة、前置の هـ、H.、ه.ق', () => {
    const y1050 = [h(1050, 1, 1), h(1051, 1, 1) - 1];
    for (const x of ['سنة ١٠٥٠ هـ', 'هـ 1050', 'هـ ١٠٥٠', '1050 H.', '1050 ه.ق', '1050 ه.ق.']) {
      expect(range(x), x).toEqual(y1050);
    }
    expect(range('١٥ رمضان سنة ١٠٥٠')).toEqual([h(1050, 9, 15) - 2, h(1050, 9, 15) + 2]);
    expect(range('رمضان سنة ١٠٥٠')).toEqual([h(1050, 9, 1), h(1050, 9, 30)]);
  });

  it('FR-DM-05: 日本語の年月日', () => {
    expect(range('1650年3月')).toEqual([g(1650, 3, 1), g(1650, 3, 31)]);
    expect(range('1650年3月15日')).toEqual([g(1650, 3, 15), g(1650, 3, 15)]);
    expect(range('50年3月')).toEqual([g(50, 3, 1), g(50, 3, 31)]);
    expect(range('前44年3月15日')).toEqual([g(-43, 3, 15), g(-43, 3, 15)]);
  });

  it('FR-DM-05: 利用者の入力の #9# は月名の印と衝突しない', () => {
    expect(failure('#9# 1050').code).toBe('unrecognized');
  });

  it('FR-DM-05: 入力の私用領域の文字（内部の印に使う U+E000〜）は、月名や併記の印と取り違えない', () => {
    // 【なぜ】解析は U+E000〜U+E003 を月名や括弧の併記の印に使う。入力にあれば空白に替えて無効にする。
    expect(failure('\uE0009\uE001 1050 AH').code).toBe('unrecognized');
    expect(failure('15 \uE0009\uE001 1050 AH').code).toBe('unrecognized');
    expect(failure('1050 \uE002 1640').code).toBe('unrecognized');
    expect(hijriMonthFromName('\uE0009\uE001')).toBeUndefined();
    // 印の文字があっても、本物の月名はこれまでどおり読む
    expect(range('Ramadan\uE000 1050 AH')).toEqual([h(1050, 9, 1), h(1050, 9, 30)]);
    // 内部の印すべて（月名 U+E000/E001、括弧の併記 U+E002、結合 U+E003）と、私用領域の他の文字は、
    // 空白と同じに扱われる（読み取った範囲が、空白を入れたときと一致する。label は元の文字列のまま）。
    const outcome = (text: string) => {
      const r = parseDate(text);
      return r.ok ? [r.value.earliest, r.value.latest, r.value.calendar] : r.reason.code;
    };
    for (const pua of ['\uE000', '\uE001', '\uE002', '\uE003', '\uF8FF']) {
      for (const [a, b] of [
        ['1050', '1640'],
        ['15', 'Ramadan 1050 AH'],
        ['1050 AH', '(1640)'],
      ] as const) {
        const at = `${a} + U+${pua.codePointAt(0)?.toString(16) ?? ''} + ${b}`;
        expect(outcome(`${a}${pua}${b}`), at).toEqual(outcome(`${a} ${b}`));
      }
    }
  });

  it('FR-TM-06: 月名の後ろに a〜z 以外の文字（ß、ø、œ、ł、キリル文字、ギリシア文字）が続けば、月名とみなさない', () => {
    // 【なぜ】照合キーは ü、ş、ç、ı などを a〜z にそろえるが、これらの文字はそのまま残る。
    for (const tail of ['ß', 'ø', 'œ', 'ł', 'ж', 'ψ']) {
      // 単語の途中を境界とみなして、月名の印に置き換えたりしない（文字列はそのまま）
      for (const word of [`Ramazan${tail}`, `${tail}Ramazan`]) {
        expect(replaceHijriMonthNames(matchKey(word)), word).toBe(matchKey(word));
      }
      expect(hijriMonthFromName(`Ramazan${tail}`), tail).toBeUndefined();
      expect(hijriMonthFromName(`${tail}Ramazan`), tail).toBeUndefined();
      expect(failure(`Ramazan${tail} 1050 AH`).code, tail).toBe('unrecognized');
    }
    // トルコ語の文字は a〜z にそろうので、その綴りの月名として読む（Şaban ＝ 8 月）
    expect(hijriMonthFromName('Şaban')).toBe(8);
    expect(hijriMonthFromName('Ramazanı')).toBeUndefined();
    // 数字は文字に含めない（月名の直後の年は、これまでどおり読む）
    expect(range('Ramadan1050 AH')).toEqual([h(1050, 9, 1), h(1050, 9, 30)]);
  });
});

describe('読まずに失敗する書式（D-29 補足 13）', () => {
  it('FR-DM-05: 年-月-日 の後にさらに「-」と数字が続くと、範囲と読まず unrecognized で失敗する', () => {
    for (const x of ['1640-12-3-5', '1640-12-03-05', '1050-9-15-2 AH']) {
      const r = failure(x);
      expect(r.code, x).toBe('unrecognized');
      expect(r.message, x).toContain('年-月-日 の後に');
    }
    // 年-月-日 の後の 3 桁以上の年は、これまでどおり範囲（補足 (2)）
    expect(range('1640-12-31-1641')).toEqual([g(1640, 12, 31), g(1641, 12, 31)]);
    // 範囲の記号が 2 つ以上なら、これまでどおり too-many-ranges
    expect(failure('1640-1650-1660').code).toBe('too-many-ranges');
  });

  it('FR-TM-06: 括弧の併記は末尾の 1 組だけ。入れ子、後ろの補足の括弧、先頭の括弧は読まずに失敗する', () => {
    // 末尾の 1 組は併記として読む（補足 (1)）
    expect(ok('1050 AH (1640)').value.calendar).toBe('hijri');
    for (const x of [
      '1050 AH (1640 (CE))',
      '1050 AH ((1640))',
      '1050 AH (1640) (uncertain)',
      '1050 AH (1640) ?',
      '(1640) 1050 AH',
      '1050 (AH) (1640)',
    ]) {
      expect(failure(x).code, x).toBe('unrecognized');
    }
  });
});

describe('en ダッシュの略記と / の組み合わせ（D-29 補足 3、4）', () => {
  it('FR-DM-05: 1 桁の略記も上位の桁を補い、/ の桁数の判定には関わらない', () => {
    // 略記の展開（1640–5 ＝ 1640〜1645）
    expect(range('1640–5')).toEqual(range('1640–1645'));
    expect(range('1640–45')).toEqual(range('1640–1645'));
    // / の片側が略記つきの範囲なら、/ の桁数の判定（補足 3）は使わない（両側が 1 つの年のときだけ）。
    // 略記の範囲とヒジュラ暦の年は、これまでどおり併記として読む。
    const p = parseDate('1640–5 / 1050 AH');
    expect(p.ok && p.value.calendar).toBe('hijri');
    expect(p.warnings.map((w) => w.code)).toEqual(['parallel-inferred']);
    // / の片側が 1〜2 桁の数で、もう片側が略記つきの範囲なら、範囲の記号が多すぎるとして失敗
    // （展開した 4 桁の年を使って「月/年」と読んだりしない）。
    for (const x of ['10/1640–5', '5/1640–5', '1640/1641–2']) {
      expect(failure(x).code, x).toBe('too-many-ranges');
    }
  });
});

describe('末尾の「頃」と「?」の繰り返し（D-29 補足 14）', () => {
  it('FR-DM-05: 末尾の ? や 頃 の繰り返しは 1 つと同じに読む', () => {
    expect(range('1650??')).toEqual(range('1650?'));
    expect(range('1650 ? ?')).toEqual(range('1650?'));
    expect(ok('1650??').value.certainty).toBe('possible');
    expect(range('1650頃頃')).toEqual(range('1650頃'));
    expect(ok('1650頃頃').value.certainty).toBe('probable');
    // 頃 と ? の両方があれば、幅を広げて、確からしさは弱い方（possible）
    expect(range('1650?頃')).toEqual(range('1650頃'));
    expect(ok('1650?頃').value.certainty).toBe('possible');
  });
  it('FR-DM-05: 先頭の「頃」の印の繰り返しは読まずに失敗する', () => {
    for (const x of ['c. c. 1650', '~~1650']) expect(failure(x).code, x).toBe('unrecognized');
  });
});

describe('末尾の暦・紀元の印と終止符（D-29 補足 15）', () => {
  it('FR-TM-06: 印の後ろの終止符は 0 個か 1 個で、どの印でも同じに読み、年の桁は欠けない', () => {
    const y1050 = range('1050 AH');
    for (const x of [
      '1050 A.H.',
      '1050 a.h',
      '1050 A.H. ',
      '1050 AH.',
      '1050AH',
      '1050 H',
      '1050 H.',
    ]) {
      expect(range(x), x).toEqual(y1050);
    }
    for (const x of ['1050 ه', '1050 هـ', '1050 ه.ق', '1050 ه.ق.', '١٠٥٠ هـ']) {
      expect(range(x), x).toEqual(y1050);
    }
    const bc44 = range('44 BC');
    for (const x of ['44 B.C.', '44 b.c', '44 BCE', '44 BCE.', '44 B.C.E.']) {
      expect(range(x), x).toEqual(bc44);
    }
    const ce1640 = range('1640');
    for (const x of ['1640 CE', '1640 CE.', '1640 C.E.', '1640 c.e', '1640 AD', '1640 A.D.']) {
      expect(range(x), x).toEqual(ce1640);
    }
    // 年の桁が欠けない（3 桁の年と 4 桁の年を取り違えない）
    expect(range('105 AH')).toEqual([h(105, 1, 1), h(106, 1, 1) - 1]);
    expect(range('105 A.H.')).toEqual([h(105, 1, 1), h(106, 1, 1) - 1]);
  });
  it('FR-TM-06: 終止符が 2 個以上、印の重なり、未対応のアラビア語の印は失敗する', () => {
    for (const x of [
      '1050 A.H..',
      '1050 H..',
      '44 B.C..',
      '1050 ه.ق..',
      '1050 ah ah',
      '1050 bc ah',
      '1050 هجري',
      '1050 هجرية',
      '1050 للهجرة',
      '1050 ق',
    ]) {
      expect(failure(x).code, x).toBe('unrecognized');
    }
  });
});

describe('選択肢の値（D-29 補足 8）', () => {
  it('FR-DM-05: 整数でない、負、上限を超える幅は既定値に戻す（切り捨てない）', () => {
    const width = (circaYears: number) => {
      const r = parseDate('c. 1650', { circaYears });
      return r.ok ? r.value.latest - r.value.earliest : NaN;
    };
    const margin = (hijriDayMargin: number) => {
      const r = parseDate('15 Ramadan 1050 AH', { hijriDayMargin });
      return r.ok ? r.value.latest - r.value.earliest : NaN;
    };
    const defaultWidth = width(5);
    for (const v of [2.5, 2.9, -1, NaN, Infinity, 1001])
      expect(width(v), String(v)).toBe(defaultWidth);
    expect(width(2)).toBeLessThan(defaultWidth);
    for (const v of [0.5, -1, NaN, 367]) expect(margin(v), String(v)).toBe(4);
    expect(margin(0)).toBe(0);
  });
});

describe('ハイフンの異体（D-29 補足 12）', () => {
  // 【なぜ】Word や Excel の貼り付けでは、ハイフンが似た別の文字になることがある。
  // 照合キーのあと、U+2010〜2012、U+2212、U+FF0D（NFKC で U+002D になる）、U+FE63 は
  // ASCII のハイフンと同じに扱う。en ダッシュ（U+2013）と em ダッシュ（U+2014）は別扱い。
  // 【TS】文字列の中の `\uXXXX` は Unicode の符号位置で書いた 1 文字。見た目の区別がつかない文字を確実に書くため。
  const variants = ['\u2010', '\u2011', '\u2012', '\u2212', '\uFF0D', '\uFE63'];

  it('FR-DM-05 D-29: 異体のハイフンでも 1640-12 と同じ年月（1640 年 12 月）', () => {
    for (const v of variants) {
      expect(range(`1640${v}12`), `U+${v.charCodeAt(0).toString(16)}`).toEqual([
        g(1640, 12, 1),
        g(1640, 12, 31),
      ]);
    }
  });

  it('FR-DM-05 D-29: 異体のハイフンでも 4 桁どうしは範囲', () => {
    for (const v of variants) {
      expect(range(`1640${v}1660`), `U+${v.charCodeAt(0).toString(16)}`).toEqual([
        g(1640, 1, 1),
        g(1660, 12, 31),
      ]);
    }
  });

  it('FR-DM-05 D-29: en ダッシュと em ダッシュは常に範囲（1640\u201312 は 1640〜1612 で失敗）', () => {
    expect(failure('1640\u201312').code).toBe('range-reversed');
    expect(failure('1640\u201412').code).toBe('range-reversed');
    expect(range('1640\u201341')).toEqual([g(1640, 1, 1), g(1641, 12, 31)]);
  });
});

describe('parseDate: 紀元前・ヒジュラ以前の月日つき（FR-DM-05、FR-FL-03）', () => {
  it('FR-DM-05: 44-03-15 BC と 44-03 BC を年月日・年月に読む（-43 年）', () => {
    expect(range('44-03-15 BC')).toEqual([g(-43, 3, 15), g(-43, 3, 15)]);
    expect(range('44-03 BC')).toEqual([g(-43, 3, 1), g(-43, 3, 31)]);
    expect(range('BC44-03-15')).toEqual([g(-43, 3, 15), g(-43, 3, 15)]);
    expect(range('前44-03-15')).toEqual([g(-43, 3, 15), g(-43, 3, 15)]);
    expect(range('5-3-1 BC')).toEqual([g(-4, 3, 1), g(-4, 3, 1)]);
  });
  it('FR-DM-05: 既存の BC の読みは変わらない（範囲、年だけ）', () => {
    expect(range('44 BC')).toEqual([g(-43, 1, 1), g(-43, 12, 31)]);
    expect(range('44-40 BC')).toEqual([g(-43, 1, 1), g(-39, 12, 31)]);
    expect(range('BC44-BC40')).toEqual([g(-43, 1, 1), g(-39, 12, 31)]);
    expect(failure('5-10 BC').code).toBe('range-reversed');
  });
  it('FR-DM-05: 月日つきの紀元前の失敗の理由', () => {
    expect(failure('44-13-01 BC').code).toBe('invalid-month');
    expect(failure('44-02-30 BC').code).toBe('invalid-day');
  });
  it('FR-DM-05: BH（ヒジュラ以前）。0 年以前のヒジュラ暦として年・年月日を読む', () => {
    expect(range('23 BH')).toEqual([h(-22, 1, 1), h(-21, 1, 1) - 1]);
    expect(ok('23 BH').value.calendar).toBe('hijri');
    expect(range('23-03-15 BH')).toEqual([h(-22, 3, 15) - 2, h(-22, 3, 15) + 2]);
    expect(range('23-03 BH')).toEqual([h(-22, 3, 1), h(-22, 4, 1) - 1]);
    expect(range('BH 23')).toEqual([h(-22, 1, 1), h(-21, 1, 1) - 1]);
    expect(range('1 BH')).toEqual([h(0, 1, 1), h(1, 1, 1) - 1]);
  });
  it('FR-DM-05: BH と西暦の印の混在、BH の 0 年は失敗', () => {
    expect(failure('23 BH CE').code).toBe('unrecognized');
    expect(failure('0 BH').code).toBe('invalid-year');
  });
});
