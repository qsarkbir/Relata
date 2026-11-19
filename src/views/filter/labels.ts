import type { CategoryKey } from '../../core/filter';
import type { AttributeDef, MissingReason } from '../../core/model';
import type { MessageKey, MessageParams } from '../../i18n';

/** 翻訳関数の型。 */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

// 【TS】`Record<MissingReason, MessageKey>` は、理由を足すと対応する文言を書き忘れた時点で型エラーになる。
const MISSING_KEYS: Readonly<Record<MissingReason, MessageKey>> = {
  unrecorded: 'filter.missing.unrecorded',
  lost: 'filter.missing.lost',
  illegible: 'filter.missing.illegible',
  'not-applicable': 'filter.missing.not-applicable',
};

/**
 * ファセットの項目を、画面に出す文字列にする。
 *
 * 値は元の表記のまま返す（書き換えない。NFR-09）。画面に出すときは呼ぶ側が `<bdi>` で囲む。
 * 欠損は、理由ごとの文言（FR-FL-06）。
 *
 * @param t - 翻訳関数
 * @param key - ファセットの項目
 * @param def - 属性の定義（真偽値の「true」「false」を訳すために使う）
 * @returns 表示用の文字列
 */
export function categoryKeyText(
  t: Translate,
  key: CategoryKey,
  def: AttributeDef | undefined,
): string {
  if (key.kind === 'missing') return t(MISSING_KEYS[key.reason]);
  // 【なぜ】真偽値の値は `String(true)` で "true" と持つ（D-21）。利用者には訳した語で見せる。
  if (def?.valueType === 'boolean') {
    if (key.value === 'true') return t('filter.bool.true');
    if (key.value === 'false') return t('filter.bool.false');
  }
  return key.value;
}
