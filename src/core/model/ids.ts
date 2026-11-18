/**
 * 識別子の型と、その作成関数（FR-DM-01）。
 *
 * ノードは必ず ID で識別する（ラベルでは照合しない）。ID の型を文字列と別物にして、
 * 取り違えをコンパイル時に防ぐ。
 */

// 【TS】「ブランド型」。`string & { readonly __brand: 'NodeId' }` は「文字列であり、
//       かつ __brand という印を持つ」型。実行時には印は存在せず、ただの文字列である。
//       しかし型の上では、ふつうの `string` を NodeId として渡すことも、
//       NodeId と EdgeId を取り違えることもできなくなる。
// 【TS】`readonly` は「後から書き換えない」ことを表す修飾子。
// 【TS】外から来た値を検査する型ガード（parse.ts の `isDataset` など）を通った値でも、
//       ID はブランド型になる。型ガードは「この値はこの型だ」と型に伝える仕組みで、
//       parse.ts は toNodeId などを呼んで ID を組み立てるため、印を付ける入口は変わらない。
/** ノードの識別子。 */
export type NodeId = string & { readonly __brand: 'NodeId' };
/** エッジの識別子。多重エッジを区別するため、エッジにも ID を持たせる（FR-DM-08）。 */
export type EdgeId = string & { readonly __brand: 'EdgeId' };
/** ノード型（k-partite の「部」）の識別子。 */
export type NodeTypeId = string & { readonly __brand: 'NodeTypeId' };

// 【なぜ】空文字の ID は例外を投げて拒否する。空の ID は「ID が無い」状態と区別できず、
//       欠損を空文字で表さない規約（CLAUDE.md）にも反する。しかも黙って通すと、
//       複数の行が同じ ID '' にまとまって、別人が 1 つのノードに合流してしまう。
//       呼び出す側（読み込み処理）は、列の空欄を見つけた時点で行を報告できるので、
//       Result を返して毎回分岐させるより、プログラムの誤りとして例外にするほうが単純である。
//       読み込み前の検査には isValidId を使う。

/**
 * ID として使える文字列かを判定する（空文字でなければ可）。
 *
 * @param s - 検査する文字列
 * @returns 使えるなら true
 */
export function isValidId(s: string): boolean {
  return s.length > 0;
}

/**
 * 文字列を検査して返す共通の下請け。
 *
 * @param s - 文字列
 * @param name - エラーメッセージに入れる ID の種類
 * @returns 同じ文字列
 * @throws RangeError 空文字のとき
 */
function requireId(s: string, name: string): string {
  if (!isValidId(s)) {
    throw new RangeError(`${name} は空文字にできません`);
  }
  return s;
}

// 【TS】`as` は型アサーション（「この値はこの型だ」と型検査に約束する）。ふつうは避けるが、
//       ブランド型を作る瞬間だけは避けられない（印は実行時に存在しないため）。
//       CLAUDE.md の規約により、`as` を使う理由をここに書く。
//       ブランド型への変換は、この 3 関数（make… と parseNodeId はこれらを呼ぶ）だけで行う。
//       他の場所で `as NodeId` と書いてはならない。

/**
 * 文字列を NodeId にする（低水準の関数）。
 *
 * 読み込み処理では、これを直接使わず `makeNodeIdFromTypeAndKey` か
 * `makeNodeIdFromTypeAndLabel` を使う（型ごとの名前空間に入れるため。D-19）。
 * この関数は、すでに作られた ID の文字列を NodeId に戻すときなどに使う。
 *
 * @param s - ID の文字列（空文字は不可）
 * @returns NodeId
 * @throws RangeError 空文字のとき
 */
export function toNodeId(s: string): NodeId {
  return requireId(s, 'NodeId') as NodeId; // 理由: ブランドは型の上だけの印で、ここが唯一の変換点
}

/**
 * 文字列を EdgeId にする。
 *
 * @param s - ID の文字列（空文字は不可）
 * @returns EdgeId
 * @throws RangeError 空文字のとき
 */
export function toEdgeId(s: string): EdgeId {
  return requireId(s, 'EdgeId') as EdgeId; // 理由: toNodeId と同じ
}

/**
 * 文字列を NodeTypeId にする。
 *
 * @param s - ID の文字列（空文字は不可）
 * @returns NodeTypeId
 * @throws RangeError 空文字のとき
 */
export function toNodeTypeId(s: string): NodeTypeId {
  return requireId(s, 'NodeTypeId') as NodeTypeId; // 理由: toNodeId と同じ
}

// 【なぜ】ノード ID は「型ごとの名前空間」に入れる（D-19）。k-partite の表では、人物と地名が
//       それぞれ 1, 2, 3… という番号を使うことが多く、そのまま ID にすると別の型のノードが衝突する。
//       また、表の ID 列から作る ID（K）と、ラベルから作る ID（L）が同じ文字列を元にしても
//       混ざらないよう、先頭に印を付ける。形は `<印><型の長さ>:<型>:<本文>`。
//       型の長さを前に付けるので、型や本文に `:` や数字が入っても一意に読み戻せる
//       （長さは UTF-16 のコード単位。サロゲートペアも slice と同じ単位で数えるので矛盾しない）。

/** ID の作り方の種類。`key`: 表の ID 列から、`label`: ラベルから。 */
export type NodeIdSource = 'key' | 'label';

/** 先頭の印。 */
const SOURCE_MARK = { key: 'K', label: 'L' } as const satisfies Record<NodeIdSource, string>;

/**
 * 型と本文から、名前空間つきの NodeId の文字列を組み立てる。
 *
 * @param source - 作り方の種類
 * @param type - ノード型の ID
 * @param text - 本文（キーまたはラベル。空文字は不可）
 * @returns NodeId
 * @throws RangeError 本文が空文字のとき
 */
function makeNodeId(source: NodeIdSource, type: NodeTypeId, text: string): NodeId {
  requireId(text, source === 'key' ? 'キー' : 'ラベル');
  return toNodeId(`${SOURCE_MARK[source]}${String(type.length)}:${type}:${text}`);
}

/**
 * 表の ID 列の値（キー）と型から NodeId を作る（FR-DM-01）。表に ID の列があるときに使う。
 *
 * 同じ型・同じキーなら同じ ID。別の型なら、同じキーでも別の ID になる。
 * キーは書き換えない（前後の空白の除去は読み込み処理 io の担当）。
 *
 * @param type - ノード型の ID
 * @param key - ID 列の値（空文字は不可）
 * @returns NodeId（`K<型の長さ>:<型>:<キー>`）
 * @throws RangeError キーが空文字のとき
 */
export function makeNodeIdFromTypeAndKey(type: NodeTypeId, key: string): NodeId {
  return makeNodeId('key', type, key);
}

/**
 * 型とラベルから NodeId を作る（FR-DM-01）。ID の列が無い表データの読み込みで使う。
 *
 * 同じ型・同じラベルなら同じ ID になる。区切りが衝突しないよう、型の長さを前に付ける
 * （`"L<型の長さ>:<型>:<ラベル>"`）。例えば型 `a:b`・ラベル `c` は `L3:a:b:c`、
 * 型 `a`・ラベル `b:c` は `L1:a:b:c` となり、混ざらない。
 *
 * 【なぜ】ラベルには Unicode の NFC 正規化だけをかける。見た目が同じ「合成済み」と
 * 「分解済み」の文字（例: é と e + 結合記号）を別人にしないため。照合キー
 * （`src/core/text/`、ハムザやター・マルブータの統一など）は使わない。
 * 照合キーで ID を作ると、綴りの違う別の人物（同名異人）まで同じ ID にまとまって
 * しまい、元に戻せないからである。同じラベルで本当に別人なら、ID の列を持つ
 * データで区別するか、読み込み後に利用者が ID を分ける。
 * ここは「同一の綴りなら同一人物」とみなす最小限の既定にとどめる。
 * 型は呼び出し側が決めた ID なので、変換しない。
 *
 * @param type - ノード型の ID
 * @param label - ラベル（空文字は不可）
 * @returns NodeId
 * @throws RangeError ラベルが空文字のとき
 *
 * @example
 * ```ts
 * makeNodeIdFromTypeAndLabel(toNodeTypeId('person'), 'Ibn Khaldūn'); // "L6:person:Ibn Khaldūn"
 * ```
 */
export function makeNodeIdFromTypeAndLabel(type: NodeTypeId, label: string): NodeId {
  return makeNodeId('label', type, label.normalize('NFC'));
}

/**
 * `makeNodeIdFromTypeAndKey` / `makeNodeIdFromTypeAndLabel` で作った ID から、元の型と本文を読み戻す。
 *
 * 書き出しで、元の ID 列の値やラベルを復元するために使う。
 *
 * @param id - ノード ID
 * @returns 作り方の種類、型、本文。この形で作られた ID でなければ undefined
 */
export function parseNodeId(
  id: NodeId,
): { source: NodeIdSource; type: NodeTypeId; text: string } | undefined {
  const m = /^([KL])(\d+):/.exec(id);
  if (m === null) return undefined;
  const mark = m[1];
  const length = Number(m[2]);
  const typeStart = m[0].length;
  const typeEnd = typeStart + length;
  // 型は空でなく、直後に ':' と 1 文字以上の本文が続かなければならない
  if (length === 0 || id.charAt(typeEnd) !== ':' || id.length <= typeEnd + 1) return undefined;
  return {
    source: mark === 'K' ? 'key' : 'label',
    type: toNodeTypeId(id.slice(typeStart, typeEnd)),
    text: id.slice(typeEnd + 1),
  };
}
