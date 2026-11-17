import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite の設定。
 *
 * 【なぜ】`base`（公開先の URL の途中のパス）はここでは設定しない。
 * GitHub Pages への配信設定は別のタスク（T0-10）で行う。
 */
// 【TS】`defineConfig` は、設定オブジェクトに型を付けるだけの補助関数。
//       これを通すと、エディタが設定項目名を補完し、綴りの誤りを指摘してくれる。
export default defineConfig({
  // React の JSX 変換と、開発中の即時反映（Fast Refresh）を有効にする。
  plugins: [react()],
});
