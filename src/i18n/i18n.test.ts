import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  interpolate,
  isLocale,
  pickLocale,
  translate,
} from './index';
import { en } from './messages/en';
import { ja } from './messages/ja';

describe('辞書', () => {
  it('FR-UI-01: 日英の辞書のキーが一致する（実行時）', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  it('FR-UI-01: 同じキーの差し込み名の集合が日英でそろっている', () => {
    const names = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    // Object.keys は string[] を返すので、辞書のキー型に限定するために as を使う（キーは辞書自身から取っている）。
    for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
      expect(names(en[key])).toEqual(names(ja[key]));
    }
  });

  it('FR-UI-01: どの文言も空でない', () => {
    for (const dict of [ja, en]) {
      for (const v of Object.values(dict)) expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe('translate', () => {
  it('FR-UI-01: 言語ごとの文言を返す', () => {
    expect(translate('ja', 'app.underConstruction')).toBe('準備中です。');
    expect(translate('en', 'app.underConstruction')).toBe('Coming soon.');
  });

  it('FR-UI-01: 差し込みの無い文言に params を渡しても変わらない', () => {
    expect(translate('en', 'app.title', { name: 'x' })).toBe('Relata');
  });
});

describe('interpolate', () => {
  it('FR-UI-01: {name} を値で置き換え、数値は文字列にする', () => {
    expect(interpolate('{name} は {n} 件', { name: '甲', n: 3 })).toBe('甲 は 3 件');
  });

  it('FR-UI-01: 足りない差し込みはそのまま残る', () => {
    expect(interpolate('{a} と {b}', { a: 'x' })).toBe('x と {b}');
    expect(interpolate('{a}')).toBe('{a}');
  });

  it('FR-UI-01: toString のような継承プロパティ名は置換しない', () => {
    expect(interpolate('{toString}', {})).toBe('{toString}');
  });

  it('FR-UI-01: 値の中の {…} は再度置換されない', () => {
    expect(interpolate('{a} {b}', { a: '{b}', b: 'B' })).toBe('{b} B');
  });

  it('FR-UI-01、NFR-09: アラビア文字の値が 1 文字も変わらずに含まれる', () => {
    const name = 'ابن خلدون';
    const out = interpolate('人物: {name}', { name });
    expect(out).toBe('人物: ابن خلدون');
  });
});

describe('isLocale', () => {
  it('FR-UI-01: ja と en だけが true', () => {
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });

  it('FR-UI-01: 数値、null、undefined、未対応の言語、大文字は false', () => {
    for (const v of [1, null, undefined, 'fr', 'EN', '', {}, ['ja']]) {
      expect(isLocale(v)).toBe(false);
    }
  });
});

describe('pickLocale', () => {
  it('FR-UI-01: 地域つきのタグは主言語で判定する', () => {
    expect(pickLocale(['en-GB'])).toBe('en');
    expect(pickLocale(['en-US'])).toBe('en');
    expect(pickLocale(['ja-JP'])).toBe('ja');
  });

  it('FR-UI-01: 大文字小文字を区別しない', () => {
    expect(pickLocale(['EN-us'])).toBe('en');
    expect(pickLocale(['JA'])).toBe('ja');
  });

  it('FR-UI-01: 先頭から見て最初に当たった言語を選ぶ', () => {
    expect(pickLocale(['fr-FR', 'en-US', 'ja'])).toBe('en');
  });

  it('FR-UI-01: 空の配列なら既定の言語', () => {
    expect(pickLocale([])).toBe(DEFAULT_LOCALE);
  });

  it('FR-UI-01: 未対応の言語だけなら FALLBACK_LOCALE（en）', () => {
    expect(FALLBACK_LOCALE).toBe('en');
    expect(pickLocale(['ar', 'fa'])).toBe('en');
    expect(pickLocale(['fr-FR', 'ar-SA'])).toBe('en');
  });

  it('FR-UI-01: 未対応の言語のあとに ja があれば ja', () => {
    expect(pickLocale(['ar', 'ja'])).toBe('ja');
  });
});
