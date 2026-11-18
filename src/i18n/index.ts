// 【TS】`verbatimModuleSyntax` が有効なので、型だけの export は `export type` と書く。
//       値と型を分けて書くと、ビルド後に消える部分がはっきりする。
export {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  TEXT_DIRECTION,
  isLocale,
  pickLocale,
} from './locale';
export type { Locale } from './locale';
export { interpolate, translate } from './translate';
export type { MessageParams } from './translate';
export type { MessageKey } from './messages/ja';
