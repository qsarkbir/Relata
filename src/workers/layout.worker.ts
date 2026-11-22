/** レイアウトの計算をメインスレッドから分離する（FR-VG-01、D-17）。 */
import { expose } from 'comlink';
import { createLayoutSession, type LayoutJob, type LayoutSession } from '../core/layout';
let session: LayoutSession | null = null;
const api = {
  /**
   * 新しい計算を始め、初期配置を返す。
   * @param job - グラフと設定
   * @returns 初期配置
   */
  start(job: LayoutJob) {
    session = createLayoutSession(job);
    return session.step(0);
  },
  /**
   * 指定した回数だけ続きを計算する。中止は client が Worker を terminate する。
   * @param iterations - 反復回数
   * @returns 途中の座標
   */
  step(iterations: number) {
    if (session === null) throw new Error('レイアウトを開始してください。');
    return session.step(iterations);
  },
};
/** Comlink の公開 API の型。 */
export type LayoutWorkerApi = typeof api;
expose(api);
