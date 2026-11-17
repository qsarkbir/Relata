/**
 * 判別共用体の「すべての場合を扱った」ことを型で確かめ、実行時にも守る関数。
 *
 * switch の default などで呼ぶ。実行時にここへ来たら、値を含むエラーを投げる。
 *
 * @param x - 扱い残した値。型は `never`（本来は到達しない）
 * @param message - メッセージの先頭に付ける説明。既定の 'Unexpected value' を置き換える（省略すると 'Unexpected value' になる）
 * @returns 戻らない（常に例外を投げる）
 * @throws Error 常に。メッセージには `x` の JSON 表現が含まれる。JSON にできない値なら `String()` の結果が入る。
 *   200 字を超える場合は切り詰め、末尾に「…」を付ける
 *
 * @example
 * ```ts
 * type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number };
 * function area(s: Shape): number {
 *   switch (s.kind) {
 *     case 'circle':
 *       return Math.PI * s.r ** 2;
 *     case 'square':
 *       return s.side ** 2;
 *     default:
 *       // Shape に新しい種類を足して case を書き忘れると、ここで型エラーになる
 *       return assertNever(s, 'Shape');
 *   }
 * }
 * ```
 */
// 【TS】`never` は「値が存在し得ない」型。どんな型の値も `never` には代入できない。
//       switch で `s.kind` の case を全部書くと、default に来る `s` は
//       「どの case にも当たらなかった残り」= `never` に絞り込まれる。
//       case を 1 つ書き忘れると、残りが `never` ではなくなり、
//       `assertNever(s)` の引数で型エラーになる。これが網羅性の検査の仕組み。
// 【なぜ】ESLint の switch-exhaustiveness-check でも網羅は検査できるが、
//       それは開発時だけ。default で assertNever を呼べば、型を信じて読み込んだ
//       古いプロジェクトファイルなど、実行時に想定外の値が来たときにも気づける。
//       両者は役割が違うので併用する。
export function assertNever(x: never, message?: string): never {
  const prefix = message ?? 'Unexpected value';
  throw new Error(`${prefix}: ${truncate(safeStringify(x))}`);
}

// 【なぜ】Dataset 全体を指すオブジェクトなどが渡ると、JSON が数 MB になり、
//       エラー表示やログを埋め尽くす。原因の見当がつく長さ（200 字）で切る。
const MAX_VALUE_LENGTH = 200;

/**
 * 長すぎる文字列を MAX_VALUE_LENGTH 字で切り、末尾に「…」を付ける。
 *
 * @param text - 対象の文字列
 * @returns 上限以内ならそのまま、超えていれば切り詰めた文字列
 */
function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/**
 * エラー表示用に値を文字列にする。失敗しても例外を出さない。
 *
 * @param value - 文字列にする値
 * @returns JSON 文字列。変換できなければ `String(value)`、それも失敗なら固定の文字列
 */
function safeStringify(value: unknown): string {
  try {
    // 【なぜ】循環参照や BigInt では JSON.stringify が例外を投げる。
    //       エラーを作る途中で別のエラーを出すと、元の原因が隠れてしまう。
    //       undefined や関数は JSON.stringify が undefined を返すので、その場合も下へ回す。
    // 【TS】lib の型は string だが、実際は undefined を返し得る。その事実を `as` で型に反映する。
    const json = JSON.stringify(value) as string | undefined;
    if (json !== undefined) return json;
  } catch {
    // 下の代替表示へ進む
  }
  try {
    return String(value);
  } catch {
    // Symbol.toPrimitive が例外を投げるオブジェクトなどへの最後の備え
    return '[unprintable value]';
  }
}
