import type { ReactNode } from 'react';
import './ui.css';

/** {@link Field} の props。 */
interface FieldProps {
  /** 欄の名前。入力欄には必ずラベルを付ける。 */
  readonly label: string;
  /** true なら、ラベルを入力の右に横並びにする（チェックボックス向け）。 */
  readonly inline?: boolean;
  /** 入力の部品（select、input など）。 */
  readonly children: ReactNode;
}

/**
 * ラベルつきの欄。`<label>` で入力を包み、ラベルの文字を押すと入力に移る。
 *
 * @param props - ラベル、並べ方、入力の部品
 * @returns label 要素
 */
export function Field({ label, inline = false, children }: FieldProps) {
  return (
    <label className={inline ? 'rl-field rl-field-inline' : 'rl-field'}>
      {inline && children}
      <span className="rl-field-label">{label}</span>
      {!inline && children}
    </label>
  );
}
