/** ブラウザの時計を state の指標 controller に渡す。 */
import { createMetricsController } from '../../state/metricsController';
import { metricsClient } from '../../workers/metrics.client';
/** アプリ全体で共有する指標の一時キャッシュ。 */
export const metricsController = createMetricsController(metricsClient, {
  delay: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
});
