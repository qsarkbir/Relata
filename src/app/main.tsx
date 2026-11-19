import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { uiStore } from '../state';
import { App } from './App';
import { translate } from '../i18n';
import type { Locale } from '../i18n';
import { autosave, startTabWatch } from './autosaveService';
import { applyDocumentLocale, resolveInitialLocale, saveLocale } from './locale';

// 【TS】`getElementById` の戻り値は `HTMLElement | null`。null かもしれないので、
//       そのまま使うとコンパイルエラーになる。
const container = document.getElementById('root');

// 【なぜ】`!`（非 null アサーション）で黙らせず、無ければ原因が分かる例外を投げる。
//       index.html の id を書き換えた場合などに、画面が真っ白になる理由をすぐ特定できる。
if (container === null) {
  throw new Error('index.html に id="root" の要素が見つかりません。');
}
// 【TS】上の if で例外を投げて抜けるため、ここから先では container は HTMLElement と絞り込まれている。

// 【なぜ】言語は「保存した選択 → ブラウザの言語」の順で、描画の前に決める（D-25）。
uiStore.getState().setLocale(resolveInitialLocale());

// 【なぜ】言語に伴うブラウザ側の更新（保存、<html lang dir>、<title>）は、ここ 1 か所で行う。
//       画面の部品が対で呼ぶと、呼び忘れる。`subscribe` は、状態が変わるたびに呼ばれる。
let appliedLocale: Locale | null = null;
function syncLocale(): void {
  const { locale } = uiStore.getState();
  // 【なぜ】言語以外（進行表示など）の変化では何もしない。
  if (locale === appliedLocale) return;
  // 起動直後の 1 回は、保存し直す必要が無い（navigator から決めた値を、利用者の選択として保存しない）。
  if (appliedLocale !== null) saveLocale(locale);
  appliedLocale = locale;
  applyDocumentLocale(locale);
  document.title = translate(locale, 'app.documentTitle');
}
uiStore.subscribe(syncLocale);
syncLocale();

// 【なぜ】StrictMode は開発中だけ、副作用の書き方の誤りを見つけやすくする検査を追加する（本番の動作は変わらない）。
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 【なぜ】見張りは最初から張る。復元の読み取りが遅い間に利用者がファイルを開けば、その作業も保存される。
//       復元の適用そのものは、`restore` が見張りから外す。復元は描画の後に行い、IndexedDB が遅くても画面は先に出る。
//       失敗しても `restore` は例外を投げない。
autosave.start();
void autosave.restore();
startTabWatch();
// 【なぜ】1 秒待つ間にタブを閉じても失われないよう、非表示になるときに今すぐ保存する。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void autosave.flush();
});
