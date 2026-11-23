// text の入口。照合キーに関するものをここから re-export する。
export { matchKey, matchIncludes, LOOSE_MATCH, STRICT_MATCH } from './matchKey';
// 【TS】型だけの export は `export type`。実行時には消える（verbatimModuleSyntax のため区別が必要）。
export type { MatchOptions } from './matchKey';
export { normalizeDecimal, parseDecimal } from './numeric';
