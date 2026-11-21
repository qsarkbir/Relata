import { expect, it } from 'vitest';
import { translate } from '../../i18n';
import { gregorianToJdn } from '../../core/time';
import { timeText } from './timeText';
import type { Translate } from './labels';

const ja: Translate = (key, params) => translate('ja', key, params);
const en: Translate = (key, params) => translate('en', key, params);

it('FR-FL-08: 閏日を含む時間フィルタをJDN番号でなく日英のグレゴリオ暦で示す', () => {
  const from = gregorianToJdn(2000, 2, 29);
  const to = gregorianToJdn(2000, 3, 1);
  expect(timeText(ja, from, to)).toBe('グレゴリオ暦 2000年02月29日〜2000年03月01日');
  expect(timeText(en, from, to)).toBe('Gregorian 2000-02-29 to 2000-03-01');
});
it('FR-FL-08: 天文学的な年0を紀元前1年とし、年0と表示しない', () => {
  expect(timeText(ja, gregorianToJdn(0, 12, 31), gregorianToJdn(1, 1, 1))).toBe(
    'グレゴリオ暦 紀元前1年12月31日〜1年01月01日',
  );
  expect(timeText(en, gregorianToJdn(-43, 3, 15), gregorianToJdn(-43, 3, 15))).toBe(
    'Gregorian 44 BCE, 03-15 to 44 BCE, 03-15',
  );
});
