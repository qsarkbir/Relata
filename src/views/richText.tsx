import type { ReactNode } from 'react';
import { Fragment } from 'react';
import type { MessageKey, MessageParams } from '../i18n';

/** 翻訳の関数の型。 */
type Translate = (key: MessageKey, params?: MessageParams) => string;

// 【なぜ】差し込む値が私的利用領域の文字を含むことはまず無い。値の位置の目印として使う。
const OPEN = '';
const CLOSE = '';

/**
 * 翻訳した文の中の、利用者の値（題名、ID、path など）だけを `<bdi>` で囲んで返す（NFR-09、D-33 (7)）。
 *
 * 【なぜ】アラビア文字の題名を文に埋め込むと、前後の記号（「」や括弧）の並びが向きの規則で崩れる。
 * `<bdi>` は中身の向きを周りから隔離する。文言の辞書は文字列なので、いったん目印を入れて翻訳し、
 * 目印の位置で分けて要素にする。
 *
 * @param t - 翻訳の関数
 * @param key - 翻訳キー
 * @param plain - そのまま差し込む値（数、固定の語）
 * @param isolated - `<bdi>` で隔離して差し込む利用者の値
 * @returns 文の要素
 */
export function tRich(
  t: Translate,
  key: MessageKey,
  plain: MessageParams = {},
  isolated: Readonly<Record<string, string>> = {},
): ReactNode {
  const names = Object.keys(isolated);
  const markers: Record<string, string> = {};
  names.forEach((name, i) => {
    markers[name] = `${OPEN}${String(i)}${CLOSE}`;
  });
  const text = t(key, { ...plain, ...markers });
  // 【TS】正規表現の括弧（キャプチャ）を `split` に使うと、区切りの部分も結果に残る。
  const parts = text.split(new RegExp(`${OPEN}(\\d+)${CLOSE}`));
  return (
    <>
      {parts.map((part, i) => {
        // 奇数番目が目印の番号。
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const name = names[Number(part)];
        return <bdi key={i}>{name === undefined ? '' : isolated[name]}</bdi>;
      })}
    </>
  );
}
