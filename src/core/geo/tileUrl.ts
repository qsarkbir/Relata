/**
 * 利用者が指定する地図タイルの URL（XYZ 形式）の検査と、鍵の除去（D-51、D-52、FR-MP-01、NFR-02）。
 *
 * 【なぜ】`URL` クラスを使わず、文字列で処理する。core は DOM なしの型（lib は ES2022 だけ）で検査し、
 * Worker と Node.js のどちらでも同じ結果にする必要があるため。また、`{z}` `{x}` `{y}` は
 * `URL` に通すと `%7Bz%7D` に符号化されてしまい、そのままではタイルの URL の雛形として使えない。
 */

// 【TS】`as const` は配列を「読み取り専用の、リテラルの組」にする。要素の型が `string` ではなく
//       `'{z}' | '{x}' | '{y}'` になり、書き間違いを型で防げる。
/** 雛形に必須の置き換え記号。 */
export const TILE_PLACEHOLDERS = ['{z}', '{x}', '{y}'] as const;

// 【TS】文字列リテラルの共用体型。書ける値を列挙に限るので、画面側の `switch` で `assertNever` により
//       「理由を足したのに文言を書き忘れた」をコンパイル時に検出できる。
/** タイルの URL を受け付けない理由。 */
export type TileUrlProblem =
  /** `https:` で始まっていない（http、相対 URL、他の方式）。 */
  | 'not-https'
  /** `{z}`、`{x}`、`{y}` のどれかが無い。 */
  | 'missing-placeholder'
  /**
   * `{s}`（サブドメインの雛形。`a`、`b`、`c` に置き換える形式）を含む。対応しない。
   * 【なぜ】`{s}` を置き換える規則はサービスごとに違い、勝手に決めると存在しないホストへ通信する。
   * `{s}` を取り除いた（サブドメインなしの）URL を使うよう、利用者に伝える。
   */
  | 'subdomain-placeholder'
  /** ホストが無い、空白や制御文字を含む、ユーザー名・パスワードを含む、など。 */
  | 'invalid';

/** タイルの URL の検査結果。 */
export type TileUrlCheck =
  { readonly ok: true } | { readonly ok: false; readonly problem: TileUrlProblem };

// 空白、制御文字、DEL を含むか。
// 【なぜ】URL に紛れ込んだ改行や空白は、貼り付けの失敗の典型で、タイルの要求が壊れる。
// eslint-disable-next-line no-control-regex -- 制御文字の検出が目的
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f]/u;

const HTTPS_PREFIX = 'https://';

/**
 * タイルの URL が使えるか検査する。
 *
 * 条件: `https:` で始まる（D-51。外部への通信を安全な経路に限る）、`{s}` を含まない、
 * `{z}` `{x}` `{y}` をすべて含む、ホストが空でなく `{` を含まない、
 * 空白・制御文字・ユーザー情報（`user:pass@`）を含まない。スキーム名の大小は問わない。
 *
 * @param url - 利用者が入力した URL
 * @returns 使えるなら `{ ok: true }`、使えなければ理由
 */
export function checkTileUrl(url: string): TileUrlCheck {
  if (url.slice(0, HTTPS_PREFIX.length).toLowerCase() !== HTTPS_PREFIX)
    return { ok: false, problem: 'not-https' };
  if (UNSAFE_CHARS.test(url)) return { ok: false, problem: 'invalid' };
  if (url.includes('{s}')) return { ok: false, problem: 'subdomain-placeholder' };
  const rest = url.slice(HTTPS_PREFIX.length);
  const hostEnd = rest.search(/[/?#]/u);
  const authority = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
  // 【なぜ】`https://user:pass@host/` は、資格情報が URL に残ってファイルに保存されるため受け付けない。
  if (authority === '' || authority.includes('@') || authority.includes('{'))
    return { ok: false, problem: 'invalid' };
  if (!TILE_PLACEHOLDERS.every((p) => url.includes(p)))
    return { ok: false, problem: 'missing-placeholder' };
  return { ok: true };
}

// 名前の末尾がこれなら鍵とみなす（正規化後の名前。`_`、`-` を除き小文字にしたもの）。
const SECRET_SUFFIXES: readonly string[] = [
  'key',
  'token',
  'secret',
  'signature',
  'credential',
  'password',
  'passwd',
];
// 名前がこれと一致したら鍵とみなす。末尾の判定では拾えない短い名前（署名、アプリケーションコード）。
const SECRET_EXACT: readonly string[] = ['sig', 'appcode'];

/**
 * 鍵らしい名前か。大小、`_`、`-` を無視して比べる。
 *
 * 名前の前後の空白と、末尾の `[]`（`key[]=` の形）を除いてから判定する。末尾が `key`、`token`、`secret`、
 * `signature`、`credential`、`password`、`passwd` のもの（`api_key`、`apikey`、`api-key`、`access_token`、
 * `accessToken`、`X-Amz-Signature`、`X-Amz-Credential` など）と、`sig`、`app_code` に一致するものを鍵とみなす。
 * 【なぜ】「漏れるよりは除く」を優先する。除きすぎた場合は、利用者に除いた名前を示して入れ直してもらえる。
 *
 * @param name - クエリの項目名（復号済み）
 * @returns 鍵らしければ true
 */
export function isSecretParamName(name: string): boolean {
  const n = name
    .trim()
    .replace(/(?:\[\])+$/u, '')
    .toLowerCase()
    .replace(/[-_]/gu, '');
  return SECRET_EXACT.includes(n) || SECRET_SUFFIXES.some((s) => n.endsWith(s));
}

// 項目名を復号する。壊れた % 表記は、そのままの文字列で判定する。
//
function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/gu, ' '));
  } catch {
    // 【TS】`catch` に変数を書かない形（`catch {`）は、投げられた値を使わないときの書き方。
    //       `catch (e)` の `e` は `unknown` で、型を絞らないと使えない。
    return raw;
  }
}

/**
 * 値の無い項目（`?pk.eyJ1…` のように `=` が無い）を除いたときに、`removed` へ入れる印。
 *
 * 【なぜ】`=` の無い部分は、名前ではなく値そのもの（トークン）のことがある。名前として保存すると
 * 鍵が `removedParams` に残ってしまうので、固定の印にする。文言（「値のない項目」など）は ui が付ける。
 */
export const VALUELESS_PARAM = '(valueless)';

/** 鍵の除去の結果。 */
export interface StripTileKeysResult {
  /** 鍵らしい項目とフラグメントを除いた URL。何も除かなければ入力と同じ文字列。 */
  readonly url: string;
  /** 除いた項目名（URL に書かれていた表記のまま、重複なし、出てきた順）。`=` の無い項目は `VALUELESS_PARAM`。 */
  readonly removed: readonly string[];
  /** フラグメント（`#` 以降）を落としたか。 */
  readonly droppedFragment: boolean;
}

/**
 * タイルの URL から、鍵らしいクエリの項目とフラグメントを除く。
 *
 * クエリ（`?` から `#` の手前まで）を `&` と `;` で区切り、項目名が `isSecretParamName` に当たるものを除く。
 * 残る項目の順序と表記（`{z}` などの雛形を含む）は変えない。残る項目をつなぎ直すときは、元の区切りの文字
 * （`&` か `;`）を残す（`?layers=a;b&key=X` は `?layers=a;b` になる）。除いた結果クエリが空になれば `?` も除く。
 * フラグメント（`#` 以降）は丸ごと落とす。【なぜ】タイルの要求には使われず、`#access_token=…` のように
 * 鍵が入りうるため。パスに埋め込まれた鍵（`/tiles/KEY/{z}/{x}/{y}.png`）は、見分けられないので除けない。
 *
 * @param url - タイルの URL
 * @returns 除いた後の URL と、除いた項目名、フラグメントを落としたか
 *
 * @example
 * ```ts
 * stripTileKeys('https://t.example/{z}/{x}/{y}.png?style=a&API_KEY=xyz');
 * // => { url: 'https://t.example/{z}/{x}/{y}.png?style=a', removed: ['API_KEY'], droppedFragment: false }
 * ```
 */
export function stripTileKeys(url: string): StripTileKeysResult {
  const hashAt = url.indexOf('#');
  const droppedFragment = hashAt !== -1;
  const beforeHash = droppedFragment ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return { url: beforeHash, removed: [], droppedFragment };
  const base = beforeHash.slice(0, queryAt);
  // 【なぜ】区切りの文字ごと分ける（`split` の正規表現を丸括弧で囲むと、区切りも結果に入る）。
  //   偶数番目が項目、奇数番目が区切り。
  const tokens = beforeHash.slice(queryAt + 1).split(/([&;])/u);
  let kept = '';
  const removed: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const part = tokens[i] ?? '';
    const sepBefore = i === 0 ? '' : (tokens[i - 1] ?? '&');
    if (part === '') continue;
    const eq = part.indexOf('=');
    const rawName = eq === -1 ? part : part.slice(0, eq);
    if (isSecretParamName(decodeName(rawName))) {
      const recorded = eq === -1 ? VALUELESS_PARAM : rawName;
      if (!removed.includes(recorded)) removed.push(recorded);
    } else {
      kept += (kept === '' ? '' : sepBefore) + part;
    }
  }
  if (removed.length === 0) return { url: beforeHash, removed: [], droppedFragment };
  return { url: base + (kept === '' ? '' : '?' + kept), removed, droppedFragment };
}
