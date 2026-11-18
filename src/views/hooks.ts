import { useCallback } from 'react';
import { useStore } from 'zustand';
import { translate } from '../i18n';
import type { MessageKey, MessageParams } from '../i18n';
import { dataStore, uiStore } from '../state';
import type { DataState, UiState } from '../state';

/**
 * uiStore の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
// 【TS】`<T>` はジェネリクス。「selector が返す型 T を、そのまま戻り値の型にする」という関係を表す。
//       呼ぶ側で `useUi((s) => s.locale)` と書くと、T は Locale と推論される。
// 【なぜ】値の一部だけを購読すると、その値が変わったときだけ再描画される。
export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}

/**
 * dataStore の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useData<T>(selector: (s: DataState) => T): T {
  return useStore(dataStore, selector);
}

/**
 * 現在の言語で翻訳する関数を返す。
 *
 * @returns `t(key, params)`
 */
export function useT(): (key: MessageKey, params?: MessageParams) => string {
  const locale = useUi((s) => s.locale);
  return useCallback((key, params) => translate(locale, key, params), [locale]);
}
