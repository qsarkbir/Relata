// util の入口。共通の小道具をここから re-export する。
// 【TS】値（関数）の re-export は `export { … }`。型だけなら `export type { … }` と書く
//       （verbatimModuleSyntax が有効なため、型と値を区別して書く必要がある）。
export { assertNever } from './assertNever';
