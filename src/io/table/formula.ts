/**
 * 先頭の空白や制御文字の後に式候補があるかを調べる。
 * @param value - 原文
 * @returns 式候補または先頭のタブ・改行ならtrue
 */
function needsProtection(value: string): boolean {
  if (value.startsWith('\t') || value.startsWith('\r') || value.startsWith('\n')) return true;
  let index = 0;
  // 空白・制御文字を挟んで式が始まるセルも保護する。時間 O(先頭の空白文字数)。
  while (index < value.length && (value.charCodeAt(index) < 32 || /\s/u.test(value.charAt(index))))
    index++;
  return '=+-@'.includes(value.charAt(index)) && index < value.length;
}
/**
 * 文字列セルを式として解釈されにくくし、既存の先頭アポストロフィも区別して保存する。
 * @param value - 原文
 * @returns 必要なときだけ先頭へ1個のアポストロフィを付けた文字列
 */
export function protectFormula(value: string): string {
  return value.startsWith("'") || needsProtection(value) ? "'" + value : value;
}
/**
 * Relata の式保護を1回だけ戻す。利用者が明示指定した読み込みだけが呼ぶ。
 * @param value - CSVセル
 * @returns 元の文字列
 */
export function unprotectFormula(value: string): string {
  if (!value.startsWith("'")) return value;
  const tail = value.slice(1);
  return tail.startsWith("'") || needsProtection(tail) ? tail : value;
}
