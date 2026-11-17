import type { Locale } from './locale';
import { en } from './messages/en';
import { ja } from './messages/ja';
import type { MessageKey } from './messages/ja';

/** 差し込みの値。数値は `String()` で文字列にして入れる。 */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * 言語ごとの辞書。
 */
// 【TS】`Record<Locale, Readonly<Record<MessageKey, string>>>` は、言語を足して辞書を足し忘れると
//       型エラーになる。
const DICTIONARIES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { ja, en };

/**
 * キーに対応する文言を、指定した言語で返す。
 *
 * 文言の中の `{name}` は、`params.name` で置き換える。`params` に無い差し込みはそのまま残す
 * （訳し漏れや渡し忘れが、画面で見つけやすいため）。
 *
 *
 * 差し込み名は ASCII の英数字と `_` だけ（正規表現の `\w`）。
 * 表示の向きの隔離は呼ぶ側の責任。画面では `<bdi>`、書き出しでは render で扱う。
 * この関数は文字列を書き換えない（NFR-09）。
 *
 * @param locale - 表示言語
 * @param key - 翻訳キー（辞書に無いキーは型エラーになる）
 * @param params - 差し込む値
 * @returns 翻訳した文字列
 * @example
 * translate('ja', 'app.title'); // 'Relata'
 */
// 【なぜ】React のフックや Zustand に依存しない純粋関数にする。画面だけでなく、`render`（書き出しの
//       ラベル）やテスト、Worker からも同じ関数で使えるため（設計書 D-15、§4.1）。
//       言語は呼ぶ側が引数で渡す。
// 【TS】`key` の型を `MessageKey`（キーの文字列リテラルの和集合）にすると、辞書に無いキーは型エラーになる。
//       将来、キーごとに差し込みの型を変えたくなったら、`<K extends MessageKey>` のジェネリクスにする。
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template: string = DICTIONARIES[locale][key];
  return interpolate(template, params);
}

/**
 * 文字列の中の `{name}` を、`params` の値で置き換える。
 *
 * `params` に無い差し込みはそのまま残す。数値は `String()` で文字列にする。
 *
 * 差し込み名は ASCII の英数字と `_` だけ（正規表現の `\w`）。
 * 表示の向きの隔離は呼ぶ側の責任。画面では `<bdi>`、書き出しでは render で扱う。
 * この関数は文字列を書き換えない（NFR-09）。
 *
 * @param template - `{name}` を含む文字列
 * @param params - 差し込む値
 * @returns 置き換え後の文字列
 * @example
 * interpolate('Hello, {name}', { name: 'Ibn Khaldun' }); // 'Hello, Ibn Khaldun'
 */
// 【なぜ】辞書に依存しない関数として分けた。差し込みの規則だけを単体で検査できる。
export function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template;
  // 【なぜ】1 回の置換で全部を処理する。順に置換すると、差し込んだ値の中の `{x}` を
  //       次の置換が書き換えてしまう（人名などの値に波括弧があっても壊れない）。
  return template.replace(/\{(\w+)\}/g, (whole: string, name: string) => {
    // 【なぜ】`name in params` だと `toString` などの継承されたプロパティに当たるので、自身のプロパティだけを見る。
    if (!Object.hasOwn(params, name)) return whole;
    return String(params[name]);
  });
}
