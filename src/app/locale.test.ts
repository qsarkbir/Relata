import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSavedLocale, resolveInitialLocale, saveLocale } from './locale';

function stubBrowser(languages: string[], storage: Partial<Storage> | null): void {
  vi.stubGlobal('navigator', { languages });
  vi.stubGlobal('window', { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('起動時の言語の決め方', () => {
  it('FR-UI-01: 保存した値があれば navigator より優先する', () => {
    stubBrowser(['en-US'], { getItem: () => 'ja' });
    expect(resolveInitialLocale()).toBe('ja');
  });

  it('FR-UI-01: 保存が無ければ navigator.languages から選ぶ', () => {
    stubBrowser(['fr', 'en-GB'], { getItem: () => null });
    expect(resolveInitialLocale()).toBe('en');
  });

  it('FR-UI-01: 保存した値が不正なら無視する', () => {
    stubBrowser(['ja'], { getItem: () => 'xx' });
    expect(resolveInitialLocale()).toBe('ja');
  });

  it('FR-UI-01: localStorage が例外を投げても動く', () => {
    const boom = (): never => {
      throw new Error('denied');
    };
    stubBrowser(['ar'], { getItem: boom, setItem: boom });
    expect(readSavedLocale()).toBeUndefined();
    expect(() => {
      saveLocale('en');
    }).not.toThrow();
    expect(resolveInitialLocale()).toBe('en');
  });
});
