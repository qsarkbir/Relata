import { expect, it } from 'vitest';
import { translate } from '../../i18n';
import { describeDay, describeDayRange, gregorianToJdn, hijriToJdn } from '../../core/time';
import { renderingsText } from './timeText';
import type { Translate } from './labels';

const ja: Translate = (key, params) => translate('ja', key, params);
const en: Translate = (key, params) => translate('en', key, params);

const range = (a: number, b: number) => ({ earliest: a, latest: b });

it('FR-TM-09: 西暦の範囲を日英の文字にする（年の精度は年だけを出す）', () => {
  const r = describeDayRange(
    range(gregorianToJdn(1500, 1, 1), gregorianToJdn(1510, 12, 31)),
    'gregorian',
  );
  expect(renderingsText(ja, r)).toBe('1500年〜1510年');
  expect(renderingsText(en, r)).toBe('1500–1510');
});
it('FR-TM-09: 日の精度は月名つき（ja は「3月15日」、en は月の略称）', () => {
  const r = describeDay(gregorianToJdn(1500, 3, 15), 'gregorian');
  expect(renderingsText(ja, r)).toBe('1500年3月15日');
  expect(renderingsText(en, r)).toBe('15 Mar 1500');
});
it('FR-TM-09: 天文学的な年 0 を紀元前 1 年と書く', () => {
  const r = describeDay(gregorianToJdn(-43, 3, 15), 'gregorian');
  expect(renderingsText(ja, r)).toBe('紀元前44年3月15日');
  expect(renderingsText(en, r)).toBe('15 Mar 44 BCE');
});
it('FR-TM-09: ヒジュラ暦は AH と月の転写名を付ける', () => {
  const r = describeDay(hijriToJdn(905, 9, 3), 'hijri');
  expect(renderingsText(ja, r)).toBe('3 Ramaḍān 905 AH');
  expect(renderingsText(en, r)).toBe('3 Ramaḍān 905 AH');
});
it('FR-TM-09: 両方を選ぶと西暦にヒジュラ暦を併記する', () => {
  const r = describeDayRange(range(hijriToJdn(905, 1, 1), hijriToJdn(906, 1, 1) - 1), 'both');
  expect(renderingsText(en, r)).toMatch(/^.+ \(905 AH\)$/);
  expect(renderingsText(ja, r)).toMatch(/^.+（905 AH）$/);
});
