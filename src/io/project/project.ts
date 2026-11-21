import { parseGraphView, type ProjectWarning } from '../../core/project';
/**
 * プロジェクトファイルの保存と読み込み（FR-PJ-01、FR-IN-08、D-24、設計書 §11.3）。
 *
 * 読み込みの手順: JSON の解析 → `app` の確認 → 版の移行 → 各部の parse → 不変条件の検査（警告）。
 */
import { checkFilterState, DEFAULT_FILTER_STATE, parseFilterState } from '../../core/filter';
import {
  CALENDAR_IDS,
  checkDataset,
  isMissingReason,
  isPlainObject,
  parseDataset,
  type ParseResult,
} from '../../core/model';
import { compileMissingTokens } from './missing';
import {
  CURRENT_FORMAT_VERSION,
  DEFAULT_IMPORT_SETTINGS,
  type ColumnCalendar,
  type ImportSettings,
  type MissingToken,
  type ProjectFile,
  type ProjectParts,
  PROJECT_VIEW_KEYS,
} from './types';

export type { ProjectWarning } from '../../core/project';
/** 読み込みの失敗の種類。 */
export type ProjectFailureKind =
  | 'not-json' // JSON として解析できない
  | 'not-relata' // Relata のファイルではない（app が違う、版が無い）
  | 'newer-version' // このアプリより新しい版。読まない
  | 'missing-migration' // 古い版だが、移行の関数が無い
  | 'migration-failed' // 移行の関数が例外を投げた
  | 'broken'; // 壊れた箇所がある（path に経路）

/** 読み込みの結果。例外は投げない。 */
export type ParseProjectResult =
  | { readonly ok: true; readonly value: ProjectFile; readonly warnings: readonly ProjectWarning[] }
  | {
      readonly ok: false;
      readonly kind: ProjectFailureKind;
      readonly path: string;
      readonly reason: string;
      /** `newer-version` のとき、ファイルの版。 */
      readonly fileVersion?: number;
    };

// 【TS】`Readonly<Record<number, F>>` は「数のキーで関数を引く、書き換え不可の辞書」。
//       `noUncheckedIndexedAccess` により `migrations[v]` の型は `F | undefined` になるので、
//       使う前に undefined を確かめる必要がある（無い版の移行を呼んでしまう事故を型で防ぐ）。
/** 版の移行。キー n の関数は「版 n のファイル」を「版 n+1 のファイル」に変換する。 */
export type Migrations = Readonly<Record<number, (old: unknown) => unknown>>;

// 最上位の既知のキー（これ以外は落として警告にする）。
const TOP_KEYS: readonly string[] = [
  'app',
  'formatVersion',
  'savedAt',
  'dataset',
  'importSettings',
  'view',
];

/** 現在は版 1 だけなので、移行は無い。 */
export const MIGRATIONS: Migrations = {};

/**
 * プロジェクトを JSON 文字列にする。
 *
 * @param parts - 保存する中身
 * @param savedAt - 保存日時（ISO 8601）。呼ぶ側が渡す（`Date` を使わず、関数を純粋に保つため）
 * @returns JSON 文字列
 */
export function serializeProject(parts: ProjectParts, savedAt: string): string {
  const file: ProjectFile = {
    app: 'Relata',
    formatVersion: CURRENT_FORMAT_VERSION,
    savedAt,
    dataset: parts.dataset,
    importSettings: parts.importSettings,
    // 【なぜ】`view` は項目を 1 つずつ書く（`parts.view` をそのまま入れない）。呼ぶ側のオブジェクトに
    //   余計な項目があっても、ファイルの形が変わらないようにするため。
    //   `ProjectView` に項目を足したら、ここにも足すこと（往復テストが PROJECT_VIEW_KEYS で検出する）。
    view: {
      filter: parts.view.filter,
      ...(parts.view.graph === undefined ? {} : { graph: parts.view.graph }),
    },
  };
  return JSON.stringify(file);
}

// 自分自身の項目だけを読む（継承した項目は読まない）。
// 【TS】`Object.hasOwn(o, key)` は、自分自身の項目かを調べる（`in` と違い、継承した項目は含まない）。
//       JSON の中の `constructor` などを、項目として誤って読まないため。
//
function get(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function fail(path: string, reason: string): { ok: false; path: string; reason: string } {
  return { ok: false, path, reason };
}

/**
 * 外から来た値を ImportSettings に組み立て直す。
 *
 * @param x - 検査する値。undefined なら既定値
 * @returns 成功なら ImportSettings、失敗なら壊れた箇所
 */
export function parseImportSettings(x: unknown): ParseResult<ImportSettings> {
  if (x === undefined) return { ok: true, value: DEFAULT_IMPORT_SETTINGS };
  if (!isPlainObject(x)) return fail('importSettings', 'オブジェクトが必要です');

  const tokens: MissingToken[] = [];
  const tokensRaw = get(x, 'missingTokens');
  if (tokensRaw !== undefined) {
    if (!Array.isArray(tokensRaw)) return fail('importSettings.missingTokens', '配列が必要です');
    for (const [i, t] of tokensRaw.entries()) {
      const p = `importSettings.missingTokens[${String(i)}]`;
      if (!isPlainObject(t)) return fail(p, 'オブジェクトが必要です');
      const token = get(t, 'token');
      if (typeof token !== 'string') return fail(`${p}.token`, '文字列が必要です');
      const reason = get(t, 'reason');
      if (!isMissingReason(reason)) return fail(`${p}.reason`, '欠損の理由が必要です');
      tokens.push({ token, reason });
    }
  }

  // 【なぜ】空白や書式文字だけの記号、整えると同じになる記号の重複は、壊れたファイルとする（D-24）。
  //   対応が曖昧になり、同じ文字がどの理由になるか決まらないため。
  const compiled = compileMissingTokens(tokens);
  const problem = compiled.problems[0];
  if (problem !== undefined)
    return fail(
      `importSettings.missingTokens[${String(problem.index)}].token`,
      problem.kind === 'empty'
        ? '空白や見えない文字だけの記号は使えません'
        : '整えると同じになる記号が重複しています',
    );

  const calendars: ColumnCalendar[] = [];
  const calRaw = get(x, 'columnCalendars');
  if (calRaw !== undefined) {
    if (!Array.isArray(calRaw)) return fail('importSettings.columnCalendars', '配列が必要です');
    for (const [i, c] of calRaw.entries()) {
      const p = `importSettings.columnCalendars[${String(i)}]`;
      if (!isPlainObject(c)) return fail(p, 'オブジェクトが必要です');
      const column = get(c, 'column');
      if (typeof column !== 'string') return fail(`${p}.column`, '文字列が必要です');
      const calendar = get(c, 'calendar');
      // 【TS】`find` で一覧の中の値と突き合わせ、型を CalendarId に絞る（as を使わない）。
      const cal = CALENDAR_IDS.find((id) => id === calendar);
      if (cal === undefined) return fail(`${p}.calendar`, '暦の ID が必要です');
      calendars.push({ column, calendar: cal });
    }
  }

  const encoding = get(x, 'encoding');
  if (encoding !== undefined && typeof encoding !== 'string')
    return fail('importSettings.encoding', '文字列が必要です');

  return {
    ok: true,
    value: {
      missingTokens: tokens,
      // 【TS】`...(条件 && { … })` は条件つきのスプレッド。条件が false なら `...false` で何も足されず、
      //       `encoding: undefined` という項目を作らずに済む（任意の項目は「無い」状態を保つ）。
      ...(encoding !== undefined && { encoding }),
      columnCalendars: calendars,
    },
  };
}

// 読み込みの失敗の結果を作る。
//
function failure(
  kind: ProjectFailureKind,
  path: string,
  reason: string,
  fileVersion?: number,
): ParseProjectResult {
  return { ok: false, kind, path, reason, ...(fileVersion !== undefined && { fileVersion }) };
}

// 既知のキー以外を、警告にする（`prefix` は経路の前につける）。
// 【なぜ】`Object.keys` は自分自身の項目だけを返すので、JSON の中の `__proto__` も拾える。
//   落とした項目を黙って捨てず、利用者に見せる（設計書 §12）。
//
function unknownFields(
  o: Record<string, unknown>,
  known: readonly string[],
  prefix: string,
): ProjectWarning[] {
  return Object.keys(o)
    .filter((k) => !known.includes(k))
    .map((k): ProjectWarning => ({
      source: 'project',
      issue: { kind: 'unknown-field', path: `${prefix}${k}` },
    }));
}

/**
 * プロジェクトの JSON 文字列を読み込む。例外は投げない。
 *
 * 任意の項目（importSettings、view、view.filter、savedAt）が無ければ既定値で補う
 * （`savedAt` だけは補わず、結果にも持たない）。落とした未知の項目（最上位と `view`）と、
 * `checkDataset`、`checkFilterState` の問題は、警告として返す。
 *
 * @param text - JSON 文字列
 * @param migrations - 版の移行（テストで差し込める。既定は本番の `MIGRATIONS`）
 * @param currentVersion - 現在の版（テストで差し込める。既定は `CURRENT_FORMAT_VERSION`）
 * @returns 成功なら値と警告、失敗なら種類と理由
 */
export function parseProject(
  text: string,
  migrations: Migrations = MIGRATIONS,
  currentVersion: number = CURRENT_FORMAT_VERSION,
): ParseProjectResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // 【TS】`catch (e)` の `e` は `unknown`（何が投げられるか分からない）。`instanceof Error` で絞ってから
    //       `message` を読む。
    return failure('not-json', '', e instanceof Error ? e.message : 'JSON として解析できません');
  }
  if (!isPlainObject(raw) || get(raw, 'app') !== 'Relata')
    return failure('not-relata', 'app', 'Relata のファイルではありません');

  // 【なぜ】app が Relata なのに版が不正なら、Relata のファイルが壊れている（別のアプリのファイルではない）。
  const version = get(raw, 'formatVersion');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0)
    return failure('broken', 'formatVersion', '版は 0 以上の整数が必要です');
  // 【なぜ】新しい版は、読み取り方が分からないので、読まずに断る（古いアプリが壊れた値を作らないため）。
  if (version > currentVersion)
    return failure(
      'newer-version',
      'formatVersion',
      `このファイルは新しい版（${String(version)}）です。アプリを更新してください`,
      version,
    );

  // 版の移行: n → n+1 を現在の版になるまで順に当てる。
  let data: unknown = raw;
  for (let v = version; v < currentVersion; v++) {
    const fn = Object.hasOwn(migrations, v) ? migrations[v] : undefined;
    if (fn === undefined)
      return failure(
        'missing-migration',
        'formatVersion',
        `版 ${String(v)} から ${String(v + 1)} への移行がありません`,
        version,
      );
    try {
      data = fn(data);
    } catch (e) {
      return failure(
        'migration-failed',
        'formatVersion',
        e instanceof Error ? e.message : '移行に失敗しました',
        version,
      );
    }
    // 【なぜ】移行の関数の出力を信用しない。版を上げ忘れると、同じ移行が二重に当たったり、
    //   後の parse が古い形を読んだりするため。
    if (!isPlainObject(data) || get(data, 'formatVersion') !== v + 1)
      return failure(
        'migration-failed',
        'formatVersion',
        `版 ${String(v)} からの移行の結果が、版 ${String(v + 1)} のオブジェクトになっていません`,
        version,
      );
  }
  if (!isPlainObject(data)) return failure('broken', '', 'オブジェクトが必要です');

  const dataset = parseDataset(get(data, 'dataset'));
  if (!dataset.ok)
    return failure(
      'broken',
      dataset.path === '' ? 'dataset' : `dataset.${dataset.path}`,
      dataset.reason,
    );

  const settings = parseImportSettings(get(data, 'importSettings'));
  if (!settings.ok) return failure('broken', settings.path, settings.reason);

  const viewRaw = get(data, 'view');
  if (viewRaw !== undefined && !isPlainObject(viewRaw))
    return failure('broken', 'view', 'オブジェクトが必要です');
  const filterRaw = viewRaw === undefined ? undefined : get(viewRaw, 'filter');
  let filter = DEFAULT_FILTER_STATE;
  if (filterRaw !== undefined) {
    const f = parseFilterState(filterRaw);
    if (!f.ok)
      return failure('broken', f.path === '' ? 'view.filter' : `view.filter.${f.path}`, f.reason);
    filter = f.value;
  }

  const graphRaw = viewRaw === undefined ? undefined : get(viewRaw, 'graph');
  const graphParsed = graphRaw === undefined ? undefined : parseGraphView(graphRaw);
  if (graphParsed !== undefined && !graphParsed.ok)
    return failure(
      'broken',
      'view.graph' + (graphParsed.path === '' ? '' : '.' + graphParsed.path),
      graphParsed.reason,
    );
  const graph = graphParsed?.ok === true ? graphParsed.value : undefined;
  if (graph !== undefined) {
    const nodeIds = new Set(dataset.value.nodes.map((n) => n.id));
    const unknown = graph.positions.findIndex((p) => !nodeIds.has(p.id));
    if (unknown >= 0)
      return failure(
        'broken',
        'view.graph.positions[' + String(unknown) + '].id',
        '存在しないノードの位置です',
      );
  }
  const savedAt = get(data, 'savedAt');
  if (savedAt !== undefined && typeof savedAt !== 'string')
    return failure('broken', 'savedAt', '文字列が必要です');

  const warnings: ProjectWarning[] = [
    ...unknownFields(data, TOP_KEYS, ''),
    ...(viewRaw === undefined ? [] : unknownFields(viewRaw, PROJECT_VIEW_KEYS, 'view.')),
    // 【TS】`.map((issue): ProjectWarning => …)` の `: ProjectWarning` は、アロー関数の戻り値の型の注釈。
    //       書かないと `source: 'dataset'` が `string` に広がり、判別共用体に代入できなくなる。
    ...(isPlainObject(graphRaw)
      ? unknownFields(
          graphRaw,
          [
            'graphOptions',
            'encoding',
            'layout',
            'seed',
            'positions',
            'labels',
            'largeLabelCount',
            'direction',
            'viewport',
          ],
          'view.graph.',
        )
      : []),
    ...checkDataset(dataset.value).map((issue): ProjectWarning => ({ source: 'dataset', issue })),
    ...checkFilterState(dataset.value, filter).map((issue): ProjectWarning => ({
      source: 'filter',
      issue,
    })),
  ];

  return {
    ok: true,
    value: {
      app: 'Relata',
      formatVersion: currentVersion,
      ...(savedAt !== undefined && { savedAt }),
      dataset: dataset.value,
      importSettings: settings.value,
      view: { filter, ...(graph === undefined ? {} : { graph }) },
    },
    warnings,
  };
}
