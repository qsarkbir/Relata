/**
 * 外から来た値（`unknown`）を検査して FilterState に組み立て直す（D-21 (8)、D-24）。
 *
 * プロジェクトファイル（FR-PJ-01）の `view.filter` で使う。`parseDataset` と同じ流儀で、
 * 入力をそのまま信じず、必要な項目だけを読んで新しいオブジェクトを作る。
 * そのため余分な項目は落ち、`__proto__` のような項目も引き継がない。
 * 壊れた箇所は `path`（例: `filters[2].include[0].reason`）で返す。
 *
 * 【なぜ】`edgeRule` と `showIsolated` は、無ければ既定値で補う（D-24: 任意の項目の追加では
 * 版を上げず、無い項目は既定値で補う）。あるのに型が違えば失敗にする。
 */
import {
  isMissingReason,
  isPlainObject,
  toNodeId,
  toNodeTypeId,
  type DayNumber,
  type NodeId,
  type NodeTypeId,
  type ParseResult,
} from '../model';
import {
  DEFAULT_FILTER_STATE,
  toFilterId,
  CERTAINTY_KEYS,
  type CategoryKey,
  type CertaintyKey,
  type EdgeRule,
  type FilterDef,
  type FilterId,
  type FilterState,
  type MissingPolicy,
  type Target,
  type TextMatching,
  type TimeMatch,
  type TimeSource,
} from './types';

// 失敗と成功の結果を作る。
//
function fail(path: string, reason: string): { ok: false; path: string; reason: string } {
  return { ok: false, path, reason };
}
function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// 経路の組み立て。
//
function child(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}
function at(path: string, index: number): string {
  return `${path}[${String(index)}]`;
}

// 自分自身の項目だけを読む（constructor などの継承した項目を読まない）。
//
function get(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

// 列挙の値（一覧のどれか）を要求する。
// 【TS】`<T extends string>` は「T は文字列のどれかの型」というジェネリクスの制約。
//       allowed に渡した配列の要素の型（'node' | 'edge' など）がそのまま戻り値の型になる。
//
function needOneOf<T extends string>(
  x: unknown,
  path: string,
  allowed: readonly T[],
): ParseResult<T> {
  const found = allowed.find((a) => a === x);
  return found === undefined
    ? fail(path, `次のどれかが必要です: ${allowed.join(', ')}`)
    : ok(found);
}

// 文字列を要求する。
//
function needString(x: unknown, path: string, nonEmpty = false): ParseResult<string> {
  if (typeof x !== 'string') return fail(path, '文字列が必要です');
  if (nonEmpty && x.length === 0) return fail(path, '空文字は使えません');
  return ok(x);
}

// 有限の数を要求する。
//
function needFinite(x: unknown, path: string): ParseResult<number> {
  return typeof x === 'number' && Number.isFinite(x) ? ok(x) : fail(path, '有限の数が必要です');
}

// 安全な整数（日の値）を要求する。
//
function needDay(x: unknown, path: string): ParseResult<DayNumber> {
  return typeof x === 'number' && Number.isSafeInteger(x)
    ? ok(x)
    : fail(path, '安全な整数が必要です');
}

// 日の値が無くてもよいとき（開いた端）。無ければ undefined、あれば安全な整数。
//
function optionalDay(x: unknown, path: string): ParseResult<DayNumber | undefined> {
  return x === undefined ? ok(undefined) : needDay(x, path);
}

// 配列の各要素を組み立てる。最初に失敗した要素で止める。
//
function parseArray<T>(
  x: unknown,
  path: string,
  parseItem: (item: unknown, itemPath: string) => ParseResult<T>,
): ParseResult<T[]> {
  if (!Array.isArray(x)) return fail(path, '配列が必要です');
  const out: T[] = [];
  // 理由: Array.isArray は any[] を返すので、unknown の配列に狭める
  for (const [i, item] of (x as readonly unknown[]).entries()) {
    const r = parseItem(item, at(path, i));
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

// ファセットの項目を組み立てる。
//
function parseCategoryKey(x: unknown, path: string): ParseResult<CategoryKey> {
  if (!isPlainObject(x)) return fail(path, 'オブジェクトが必要です');
  const kind = get(x, 'kind');
  if (kind === 'value') {
    const value = needString(get(x, 'value'), child(path, 'value'));
    return value.ok ? ok({ kind: 'value', value: value.value }) : value;
  }
  if (kind === 'missing') {
    const reason = get(x, 'reason');
    if (!isMissingReason(reason))
      return fail(child(path, 'reason'), '欠損の理由が正しくありません');
    return ok({ kind: 'missing', reason });
  }
  return fail(child(path, 'kind'), "'value' か 'missing' が必要です");
}

const TARGETS = ['node', 'edge'] as const satisfies readonly Target[];
const MISSING_POLICIES = ['include', 'exclude'] as const satisfies readonly MissingPolicy[];
const TIME_MATCHES = ['overlaps', 'within'] as const satisfies readonly TimeMatch[];
const TEXT_MATCHINGS = ['loose', 'strict'] as const satisfies readonly TextMatching[];
const EDGE_RULES = ['both-ends', 'either-end'] as const satisfies readonly EdgeRule[];

// 任意の数（min、max）を読む。無ければ undefined（項目を作らない）。
//
function parseOptionalNumber(
  o: Record<string, unknown>,
  key: string,
  path: string,
): ParseResult<number | undefined> {
  const raw = get(o, key);
  if (raw === undefined) return ok(undefined);
  return needFinite(raw, child(path, key));
}

// 時間フィルタの出どころ（D-35）を組み立てる。
//
function parseTimeSource(x: unknown, path: string): ParseResult<TimeSource> {
  if (!isPlainObject(x)) return fail(path, 'オブジェクトが必要です');
  const kind = get(x, 'kind');
  if (kind === 'span') return ok({ kind: 'span' });
  if (kind === 'attr') {
    const attr = needString(get(x, 'attr'), child(path, 'attr'), true);
    return attr.ok ? ok({ kind: 'attr', attr: attr.value }) : attr;
  }
  return fail(child(path, 'kind'), "'span' か 'attr' が必要です");
}

// フィルタ 1 つを組み立てる。
//
function parseFilterDef(x: unknown, path: string): ParseResult<FilterDef> {
  if (!isPlainObject(x)) return fail(path, 'オブジェクトが必要です');
  const idRaw = needString(get(x, 'id'), child(path, 'id'), true);
  if (!idRaw.ok) return idRaw;
  const id = toFilterId(idRaw.value);
  const kind = get(x, 'kind');
  switch (kind) {
    case 'category': {
      const target = needOneOf(get(x, 'target'), child(path, 'target'), TARGETS);
      if (!target.ok) return target;
      const attr = needString(get(x, 'attr'), child(path, 'attr'));
      if (!attr.ok) return attr;
      const include = parseArray(get(x, 'include'), child(path, 'include'), parseCategoryKey);
      if (!include.ok) return include;
      return ok({
        id,
        kind: 'category',
        target: target.value,
        attr: attr.value,
        include: include.value,
      });
    }
    case 'range': {
      const target = needOneOf(get(x, 'target'), child(path, 'target'), TARGETS);
      if (!target.ok) return target;
      const attr = needString(get(x, 'attr'), child(path, 'attr'));
      if (!attr.ok) return attr;
      const min = parseOptionalNumber(x, 'min', path);
      if (!min.ok) return min;
      const max = parseOptionalNumber(x, 'max', path);
      if (!max.ok) return max;
      const missing = needOneOf(get(x, 'missing'), child(path, 'missing'), MISSING_POLICIES);
      if (!missing.ok) return missing;
      // 【なぜ】逆転した範囲は壊れた入力として拒否する（D-21 (6)）。
      if (min.value !== undefined && max.value !== undefined && min.value > max.value)
        return fail(child(path, 'max'), 'max は min 以上でなければなりません');
      return ok({
        id,
        kind: 'range',
        target: target.value,
        attr: attr.value,
        // 【TS】条件つきのスプレッド。値があるときだけ項目を足し、無いときは項目そのものを作らない
        //       （`min: undefined` を持たせると、JSON の往復で項目の有無が食い違うため）。
        ...(min.value === undefined ? {} : { min: min.value }),
        ...(max.value === undefined ? {} : { max: max.value }),
        missing: missing.value,
      });
    }
    case 'time': {
      const target = needOneOf(get(x, 'target'), child(path, 'target'), TARGETS);
      if (!target.ok) return target;
      // 【なぜ】source は必須。版 1 のファイルには io の移行関数が `{ kind: 'span' }` を補う（D-36）。
      //   ここで黙って補うと、版の番号と中身の対応が崩れる。
      const source = parseTimeSource(get(x, 'source'), child(path, 'source'));
      if (!source.ok) return source;
      // 【なぜ】開いた端は項目を省いて保存する（JSON に Infinity は書けない）。両方なしは検査（check）で報告する。
      const from = optionalDay(get(x, 'from'), child(path, 'from'));
      if (!from.ok) return from;
      const to = optionalDay(get(x, 'to'), child(path, 'to'));
      if (!to.ok) return to;
      const match = needOneOf(get(x, 'match'), child(path, 'match'), TIME_MATCHES);
      if (!match.ok) return match;
      const missing = needOneOf(get(x, 'missing'), child(path, 'missing'), MISSING_POLICIES);
      if (!missing.ok) return missing;
      if (from.value !== undefined && to.value !== undefined && from.value > to.value)
        return fail(child(path, 'to'), 'to は from 以上でなければなりません');
      return ok({
        id,
        kind: 'time',
        target: target.value,
        source: source.value,
        ...(from.value === undefined ? {} : { from: from.value }),
        ...(to.value === undefined ? {} : { to: to.value }),
        match: match.value,
        missing: missing.value,
      });
    }
    case 'text': {
      const target = needOneOf(get(x, 'target'), child(path, 'target'), TARGETS);
      if (!target.ok) return target;
      const query = needString(get(x, 'query'), child(path, 'query'));
      if (!query.ok) return query;
      const matching = needOneOf(get(x, 'matching'), child(path, 'matching'), TEXT_MATCHINGS);
      if (!matching.ok) return matching;
      return ok({
        id,
        kind: 'text',
        target: target.value,
        query: query.value,
        matching: matching.value,
      });
    }
    case 'nodeType': {
      const include = parseArray<NodeTypeId>(
        get(x, 'include'),
        child(path, 'include'),
        (item, itemPath) => {
          const s = needString(item, itemPath, true);
          return s.ok ? ok(toNodeTypeId(s.value)) : s;
        },
      );
      if (!include.ok) return include;
      return ok({ id, kind: 'nodeType', include: include.value });
    }
    case 'nodeSet': {
      const include = parseArray<NodeId>(
        get(x, 'include'),
        child(path, 'include'),
        (item, itemPath) => {
          const s = needString(item, itemPath, true);
          return s.ok ? ok(toNodeId(s.value)) : s;
        },
      );
      if (!include.ok) return include;
      return ok({ id, kind: 'nodeSet', include: include.value });
    }
    case 'certainty': {
      const target = needOneOf(get(x, 'target'), child(path, 'target'), TARGETS);
      if (!target.ok) return target;
      const include = parseArray<CertaintyKey>(
        get(x, 'include'),
        child(path, 'include'),
        (item, itemPath) => needOneOf(item, itemPath, CERTAINTY_KEYS),
      );
      if (!include.ok) return include;
      return ok({ id, kind: 'certainty', target: target.value, include: include.value });
    }
    default:
      return fail(child(path, 'kind'), 'フィルタの種類が正しくありません');
  }
}

/**
 * 外から来た値を FilterState に組み立て直す。
 *
 * 構造（必須の項目、種類、数値の型）と、フィルタの ID が重複しないことを検査する。
 * 入力は書き換えない。例外は投げない。
 *
 * @param x - JSON.parse の結果など、中身が分からない値
 * @returns 成功なら組み立てた FilterState、失敗なら壊れた箇所の経路と理由
 *
 * @example
 * ```ts
 * const r = parseFilterState(JSON.parse(text));
 * if (r.ok) applyFilters(dataset, r.value);
 * ```
 */
export function parseFilterState(x: unknown): ParseResult<FilterState> {
  if (!isPlainObject(x)) return fail('', 'オブジェクトが必要です');
  const filters = parseArray(get(x, 'filters'), 'filters', parseFilterDef);
  if (!filters.ok) return filters;
  // 【なぜ】ID の重複を拒否する。一覧（FR-FL-08）の個別の解除が、どれを指すか決まらなくなるため。
  const seen = new Set<FilterId>();
  for (const [i, f] of filters.value.entries()) {
    if (seen.has(f.id))
      return fail(child(at('filters', i), 'id'), 'フィルタの ID が重複しています');
    seen.add(f.id);
  }
  const edgeRuleRaw = get(x, 'edgeRule');
  const edgeRule =
    edgeRuleRaw === undefined
      ? ok(DEFAULT_FILTER_STATE.edgeRule)
      : needOneOf(edgeRuleRaw, 'edgeRule', EDGE_RULES);
  if (!edgeRule.ok) return edgeRule;
  const showRaw = get(x, 'showIsolated');
  if (showRaw !== undefined && typeof showRaw !== 'boolean')
    return fail('showIsolated', '真偽値が必要です');
  return ok({
    filters: filters.value,
    edgeRule: edgeRule.value,
    showIsolated: showRaw ?? DEFAULT_FILTER_STATE.showIsolated,
  });
}
