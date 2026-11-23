import { assertNever } from '../../core/util/assertNever';
import './ui.css';

/**
 * 画面に出す状態の区別。
 *
 * 【なぜ】処理中、データなし、絞り込みで 0 件、エラーは、利用者にとって別の事情で、次にすべき
 * ことも違う。1 つの型で区別し、取り違えた表示を作れなくする（フェーズ 2 の方針 §8）。
 */
// 【TS】判別共用体。`kind` の値で、他の項目の有無が決まる。
export type StatusState =
  | { readonly kind: 'loading'; readonly message: string }
  | { readonly kind: 'empty'; readonly message: string; readonly hint?: string }
  | { readonly kind: 'no-results'; readonly message: string; readonly hint?: string }
  | { readonly kind: 'error'; readonly message: string; readonly hint?: string };

/** {@link StatusMessage} の props。 */
interface StatusMessageProps {
  readonly state: StatusState;
  /**
   * 読み上げ（role）を付けるか。既定は付ける。
   * 【なぜ】すでに role="status" や role="alert" の入れ物の中に置くときは、二重に読み上げないよう false にする。
   */
  readonly announce?: boolean;
}

/**
 * 状態の表示。種類ごとに読み上げの役割を変える（処理中は status、エラーは alert、他は付けない）。
 *
 * @param props - 状態と、読み上げの有無
 * @returns 段落の要素
 */
export function StatusMessage({ state, announce = true }: StatusMessageProps) {
  const role = !announce
    ? undefined
    : state.kind === 'loading'
      ? 'status'
      : state.kind === 'error'
        ? 'alert'
        : undefined;
  switch (state.kind) {
    case 'loading':
      return (
        <p className="rl-status" data-kind="loading" role={role}>
          {state.message}
        </p>
      );
    case 'empty':
    case 'no-results':
    case 'error':
      return (
        <p className="rl-status" data-kind={state.kind} role={role}>
          {state.message}
          {state.hint !== undefined && <span className="rl-status-hint">{state.hint}</span>}
        </p>
      );
    default:
      return assertNever(state, 'StatusState');
  }
}
