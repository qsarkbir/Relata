import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// 【TS】`getElementById` の戻り値は `HTMLElement | null`。null かもしれないので、
//       そのまま使うとコンパイルエラーになる。
const container = document.getElementById('root');

// 【なぜ】`!`（非 null アサーション）で黙らせず、無ければ原因が分かる例外を投げる。
//       index.html の id を書き換えた場合などに、画面が真っ白になる理由をすぐ特定できる。
if (container === null) {
  throw new Error('index.html に id="root" の要素が見つかりません。');
}
// 【TS】上の if で例外を投げて抜けるため、ここから先では container は HTMLElement と絞り込まれている。

// 【なぜ】StrictMode は開発中だけ、副作用の書き方の誤りを見つけやすくする検査を追加する（本番の動作は変わらない）。
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
