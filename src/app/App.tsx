/**
 * アプリ全体の最上位コンポーネント。
 *
 * いまは見出しと「準備中」の表示だけを出す。画面の配置は後のタスクで作る。
 *
 * @returns 見出しと説明文を含む要素
 */
// 【TS】`.tsx` は JSX（HTML に似た記法）を書ける TypeScript のファイル。
//       戻り値の型は、TypeScript が JSX の中身から推論するので書かなくてよい。
export function App() {
  return (
    <main>
      <h1>Relata</h1>
      <p>準備中です。</p>
    </main>
  );
}
