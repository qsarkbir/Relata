import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite の設定。
 *
 * 【なぜ】`base` を `/relata/` にする。GitHub Pages のサイトは `https://<利用者>.github.io/<リポジトリ名>/`
 * という、リポジトリ名の下に置かれる。`base` が `/` のままだと、`index.html` が JS や CSS を
 * `/assets/…`（サイトの根）から探してしまい、404 になって画面が真っ白になる。
 * 開発サーバー（`npm run dev`）も `http://localhost:5173/relata/` で開くようになる。
 */
// 【TS】`defineConfig` は、設定オブジェクトに型を付けるだけの補助関数。
//       これを通すと、エディタが設定項目名を補完し、綴りの誤りを指摘してくれる。
export default defineConfig({
  base: '/relata/',
  // React の JSX 変換と、開発中の即時反映（Fast Refresh）を有効にする。
  plugins: [react()],
  // 【なぜ】Worker の出力を ES モジュールにする。client は `new Worker(url, { type: 'module' })` で
  // 起動する（開発サーバーでも同じ）ので、build の出力も同じ形式に揃える。既定の 'iife' は、
  // Worker が複数になったとき共通部分を共有できず、各 Worker に同じコードが複製される（設計書 §7.3、D-17）。
  worker: { format: 'es' },
});
