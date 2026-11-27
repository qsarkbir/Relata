/** Edge bundling の計算をメインスレッドから分離する（FR-VG-13、D-55、D-17）。 */
import { expose } from 'comlink';
import {
  createBundlingSession,
  type BundlingSession,
  type BundleEdge,
  type BundlingInfo,
  type BundlingProgress,
  type BundlingResult,
  type BundlingSettings,
} from '../render/bundling';

/** Worker へ渡す仕事。structured clone で送れる型だけで作る（関数を含まない）。版番号は含めない（D-17）。 */
export interface BundlingJob {
  readonly edges: readonly BundleEdge[];
  readonly settings?: Partial<BundlingSettings>;
}
/** step の戻り値。最後の段階だけ result を持つ（途中の折れ線は重いので送らない）。 */
export interface BundlingStepResult extends BundlingProgress {
  readonly result: BundlingResult | null;
}

// 【TS】`X | null` は「まだ無いとき null」を型で表す。使う前に null を除く確認が必須になる。
let session: BundlingSession | null = null;
const api = {
  /**
   * 新しい計算を始める。設定や入力が不正なら例外（client の run が reject される）。
   * @param job - エッジと設定
   * @returns 準備で分かった情報（段階の数、束ねる本数など）
   */
  start(job: BundlingJob): BundlingInfo {
    session = createBundlingSession(job.edges, job.settings);
    return session.info;
  },
  /**
   * 次の段階を 1 つ進める。中止は client が Worker を terminate する。
   * @returns 進み具合。done のとき result に折れ線が入る
   */
  step(): BundlingStepResult {
    if (session === null) throw new Error('束ねる計算を開始してください。');
    const progress = session.step();
    return { ...progress, result: progress.done ? session.result() : null };
  },
};
// 【TS】`typeof api` は、値 api から型を取り出す。client が import type でこの型だけを読み、
//   Comlink の wrap に渡すと、Worker の関数を型つきで呼べる（実行時には何も import されない）。
/** Comlink の公開 API の型。 */
export type BundlingWorkerApi = typeof api;
expose(api);
