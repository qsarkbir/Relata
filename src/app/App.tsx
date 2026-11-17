import { DEFAULT_LOCALE, translate } from '../i18n';
import type { Locale } from '../i18n';

// 【なぜ】言語は今は日本語で固定する。言語の切り替えの画面とストアは T1-16 で作り、
//       そのとき `pickLocale(navigator.languages)` と保存した設定から決める。
const LOCALE: Locale = DEFAULT_LOCALE;

/**
 * アプリ全体の最上位コンポーネント。
 *
 * いまは見出しと「準備中」の表示だけを出す。画面の配置は後のタスクで作る。
 * 文言は `src/i18n/` の辞書から取る（FR-UI-01）。
 *
 * @returns 見出しと説明文を含む要素
 */
// 【TS】`.tsx` は JSX（HTML に似た記法）を書ける TypeScript のファイル。
//       戻り値の型は、TypeScript が JSX の中身から推論するので書かなくてよい。
export function App() {
  return (
    <main>
      <h1>{translate(LOCALE, 'app.title')}</h1>
      <p>{translate(LOCALE, 'app.underConstruction')}</p>
    </main>
  );
}
