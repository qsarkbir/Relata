import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { assertNever } from '../core/util/assertNever';
import { DEFAULT_TABLE_VIEW } from '../core/project';
import type { TableTarget } from '../core/project';
import {
  TABLE_PAGE_SIZE,
  firstSelectedIndex,
  getFilterResult,
  getTableColumns,
  getTableRows,
  isEdgeItem,
  isRowSelected,
  pageCount,
  selectFilterState,
  selectRow,
  selectionStore,
  visibleColumns,
  workspaceStore,
} from '../state';
import type { CellItem, TableCell, TableColumn, TableItem } from '../state';
import type { MessageKey } from '../i18n';
import { useData, useFilter, useSelection, useT, useUi, useWorkspaceView } from './hooks';
import { getNumberFormat } from './intl';
import { StatusMessage } from './ui/StatusMessage';
import './workspace.css';

const EMPTY_ROWS: readonly TableItem[] = [];

/** 欠損の理由の表示に使う辞書のキー（フィルタの欄と同じ文言）。 */
// 【TS】`as const satisfies Record<…>`: `as const` で値をリテラルのまま保ち、`satisfies` で「辞書のキーとして
//       正しいか」だけを検査する（型は広げない）。理由の種類を足して書き忘れると、型エラーになる。
const MISSING_KEYS = {
  unrecorded: 'filter.missing.unrecorded',
  lost: 'filter.missing.lost',
  illegible: 'filter.missing.illegible',
  'not-applicable': 'filter.missing.not-applicable',
} as const satisfies Record<string, MessageKey>;

const CERTAINTY_KEYS = {
  certain: 'filter.certainty.certain',
  probable: 'filter.certainty.probable',
  possible: 'filter.certainty.possible',
} as const satisfies Record<string, MessageKey>;

// 【なぜ】数は桁区切りなしで出す。「1,050」と区切ると、ヒジュラ暦の年（1050）などが読みにくくなる。
const plainNumbers = new Map<string, Intl.NumberFormat>();
function plainNumber(locale: string, value: number): string {
  let f = plainNumbers.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 });
    plainNumbers.set(locale, f);
  }
  return f.format(value);
}

/**
 * セルの値 1 つを、画面に出す文字列にする。表示と title（省略時の全体）で同じ整形を使う。
 * @param item - セルの値
 * @param locale - 数の書式に使う言語
 * @param t - 翻訳の関数
 * @returns 文字列
 */
function itemText(item: CellItem, locale: string, t: (key: MessageKey) => string): string {
  switch (item.kind) {
    case 'text':
    case 'date':
      return item.text;
    case 'number':
      return plainNumber(locale, item.value);
    case 'boolean':
      return t(item.value ? 'table.bool.true' : 'table.bool.false');
    default:
      return assertNever(item, 'CellItem');
  }
}

/**
 * 表の 1 つのセルを描く。
 *
 * 利用者の値は `<bdi>` で隔離する（アラビア文字などの右から左の文字が、周りの文字の向きに
 * 巻き込まれて並びが崩れないため。NFR-09）。欠損は、理由を文字で出す（色だけで伝えない）。
 * @param props - セルと言語
 * @param props.cell - 表のセル
 * @param props.locale - 数の書式に使う言語
 * @returns セルの中身
 */
function CellView({ cell, locale }: { cell: TableCell; locale: string }) {
  const t = useT();
  if (cell.kind === 'missing') {
    if (cell.reason === null) {
      // 属性が無い行は「欠損」ではなく「当てはまらない」。区別して示す（D-18、D-19）。
      return (
        <span className="table-na" title={t('table.cell.notApplicable')}>
          —
        </span>
      );
    }
    const text = t(MISSING_KEYS[cell.reason]);
    return (
      <span className="table-missing" title={text}>
        {text}
      </span>
    );
  }
  const texts = cell.items.map((item) => itemText(item, locale, t));
  return (
    <>
      {cell.items.map((item, i) => (
        // 【なぜ】key は位置。同じ値が複数値に重なりうる（値そのものは一意でない）。
        <span key={i}>
          {i > 0 && <span className="table-sep">; </span>}
          <bdi title={texts.join('; ')}>{texts[i]}</bdi>
          {item.kind === 'date' && item.certainty !== undefined && item.certainty !== 'certain' && (
            <> ({t(CERTAINTY_KEYS[item.certainty])})</>
          )}
        </span>
      ))}
      {cell.certainty !== undefined && cell.certainty !== 'certain' && (
        <> ({t(CERTAINTY_KEYS[cell.certainty])})</>
      )}
    </>
  );
}

/**
 * セルの title（長い値を省略したときに全体を見せる）。表示と同じ整形を使う。
 * @param cell - 表のセル
 * @param locale - 数の書式に使う言語
 * @param t - 翻訳の関数
 * @returns 値を `; ` でつないだ文字列。欠損は空
 */
function cellTitle(cell: TableCell, locale: string, t: (key: MessageKey) => string): string {
  if (cell.kind === 'missing') return '';
  return cell.items.map((i) => itemText(i, locale, t)).join('; ');
}

/**
 * 行の名前（選ぶボタンの名前に使う）。エッジは「起点 → 終点」。
 * @param row - 表の行
 * @param columns - 列の一覧（端のノードのラベルを引く）
 * @param locale - 数の書式に使う言語
 * @param t - 翻訳の関数
 * @returns 名前
 */
function rowName(
  row: TableItem,
  columns: readonly TableColumn[],
  locale: string,
  t: (key: MessageKey) => string,
): string {
  if (!isEdgeItem(row)) return row.label;
  const text = (key: string): string => {
    const cell = columns.find((c) => c.key === key)?.cell(row);
    return cell === undefined ? '' : cellTitle(cell, locale, t);
  };
  return `${text('sourceLabel')} → ${text('targetLabel')}`;
}

/**
 * 表ビュー（FR-TB-01、FR-TB-02）。絞り込み後のノード表またはエッジ表を出す。
 *
 * 行と列は state の `getTableRows`、`getTableColumns` が作る（この部品は整形と操作だけ）。
 * 並べ替えと列の選択は workspaceStore（保存する）、ページは部品の中（保存しない）、
 * 選択は selectionStore だけが持つ（表に別の選択を作らない）。
 * 表は射影の前の元のデータを出す（D-39）。
 *
 * @returns 表ビューの要素
 */
export function TableView() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const dataset = useData((s) => s.dataset);
  const filters = useFilter(selectFilterState);
  const table = useWorkspaceView((s) => s.table);
  const selectedNodes = useSelection((s) => s.nodes);
  const selectedEdges = useSelection((s) => s.edges);
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTick, setScrollTick] = useState(0);

  const target = table.target;
  const settings = table[target];
  const patchTable = (change: Partial<typeof table>) => {
    workspaceStore.getState().patchTable(change);
  };
  const patchTarget = (change: Partial<typeof settings>) => {
    const next = { ...settings, ...change };
    patchTable(target === 'node' ? { node: next } : { edge: next });
  };

  const result = dataset === null ? null : getFilterResult(dataset, filters);
  const columns = dataset === null ? [] : getTableColumns(dataset, target);
  const shown = visibleColumns(columns, settings.columns);
  const rows =
    dataset === null || result === null
      ? EMPTY_ROWS
      : getTableRows(dataset, result, target, settings.sort, locale);
  const pages = pageCount(rows.length);
  const current = Math.min(page, pages - 1);
  const selection = { nodes: selectedNodes, edges: selectedEdges };
  const isSelected = (row: TableItem) => isRowSelected(selection, row);

  // 【なぜ】行の集合（絞り込み、並べ替え、データ、対象の切り替え）が変わったら先頭ページへ戻す。
  //   前の集合のページ番号が、新しい集合の範囲外や別の場所を指すのを避ける。描画の途中で state を
  //   更新する書き方は、前の値との比較で変化を検知する React の標準の形（GraphView と同じ）。
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setPage(0);
  }

  // 【なぜ】図など表の外で選択が変わり、選択した行が今のページに 1 つも無いときだけ、そのページへ移る。
  //   表の中の操作（行のクリック）で選択が変わったときは移らない（3 ページ目で追加選択しても、
  //   ページが勝手に変わらないように、ref で区別する）。
  const internalSelection = useRef(false);
  const latest = useRef({ rows, current });
  useEffect(() => {
    latest.current = { rows, current };
  });
  useEffect(() => {
    if (internalSelection.current) {
      internalSelection.current = false;
      return;
    }
    const state = selectionStore.getState();
    const { rows: all, current: now } = latest.current;
    const pick = (row: TableItem) => isRowSelected(state, row);
    const onPage = all.slice(now * TABLE_PAGE_SIZE, (now + 1) * TABLE_PAGE_SIZE).some(pick);
    const index = firstSelectedIndex(all, pick);
    if (onPage || index < 0) return;
    setPage(Math.floor(index / TABLE_PAGE_SIZE));
    setScrollTick((n) => n + 1);
  }, [selectedNodes, selectedEdges]);

  // 選んだ行が見える位置まで表をスクロールする（「選択した行へ移る」の後）。
  useEffect(() => {
    if (scrollTick === 0) return;
    scroller.current
      ?.querySelector('tr[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [scrollTick]);

  if (dataset === null || result === null) {
    return (
      <div className="table-view">
        <StatusMessage state={{ kind: 'empty', message: t('table.empty.noData') }} />
      </div>
    );
  }

  const total = target === 'node' ? dataset.nodes.length : dataset.edges.length;
  const kindLabel = t(target === 'node' ? 'table.target.node' : 'table.target.edge');
  const chosenKeys = new Set(shown.map((c) => c.key));
  const headerText = (c: TableColumn): string =>
    c.header.kind === 'message' ? t(c.header.key) : c.header.title;

  const sort = settings.sort;
  const cycleSort = (key: string) => {
    // 昇順 → 降順 → 並べ替えなし の順に切り替える。
    const next =
      sort?.column !== key
        ? { column: key, direction: 'asc' as const }
        : sort.direction === 'asc'
          ? { column: key, direction: 'desc' as const }
          : null;
    patchTarget({ sort: next });
    setPage(0);
  };
  const toggleColumn = (key: string, on: boolean) => {
    // 列の順は、データの列の順に保つ（選ぶだけで並べ替えない）。
    const keys = new Set(chosenKeys);
    if (on) keys.add(key);
    else keys.delete(key);
    patchTarget({ columns: columns.filter((c) => keys.has(c.key)).map((c) => c.key) });
  };
  const switchTarget = (next: TableTarget) => {
    if (next === target) return;
    patchTable({ target: next });
    setPage(0);
  };
  const onRowClick = (row: TableItem, e: MouseEvent) => {
    internalSelection.current = true;
    selectRow(selectionStore, row, e.ctrlKey || e.metaKey || e.shiftKey);
  };
  const selectedIndex = firstSelectedIndex(rows, isSelected);
  const from = rows.length === 0 ? 0 : current * TABLE_PAGE_SIZE + 1;
  const to = Math.min(rows.length, (current + 1) * TABLE_PAGE_SIZE);
  const pageRows = rows.slice(current * TABLE_PAGE_SIZE, (current + 1) * TABLE_PAGE_SIZE);

  let body;
  if (total === 0) {
    body = (
      <StatusMessage
        state={{
          kind: 'empty',
          message: t(target === 'node' ? 'table.empty.noNodes' : 'table.empty.noEdges'),
        }}
      />
    );
  } else if (rows.length === 0) {
    // 【なぜ】データが無い（empty）と、絞り込みで 0 件（no-results）は別の事情なので、文言を分ける。
    body = (
      <StatusMessage
        state={{
          kind: 'no-results',
          message: t(target === 'node' ? 'table.noResults.node' : 'table.noResults.edge'),
          hint: t('table.noResults.hint'),
        }}
      />
    );
  } else if (shown.length === 0) {
    body = <StatusMessage state={{ kind: 'empty', message: t('table.noColumns') }} />;
  } else {
    body = (
      <div
        className="table-scroll"
        ref={scroller}
        role="region"
        tabIndex={0}
        aria-label={t('table.scroll', { kind: kindLabel })}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">{t('table.col.select')}</span>
              </th>
              {shown.map((c) => {
                const active = sort?.column === c.key ? sort.direction : null;
                const name = headerText(c);
                return (
                  <th
                    key={c.key}
                    scope="col"
                    data-numeric={c.numeric}
                    aria-sort={
                      active === null ? undefined : active === 'asc' ? 'ascending' : 'descending'
                    }
                  >
                    <button
                      type="button"
                      className="table-sort"
                      title={t('table.sort', { column: name })}
                      onClick={() => {
                        cycleSort(c.key);
                      }}
                    >
                      <bdi>{name}</bdi>
                      {/* 並べ替えの向きは記号で示す（色だけに頼らない） */}
                      <span aria-hidden="true">
                        {active === 'asc' ? '▲' : active === 'desc' ? '▼' : ''}
                      </span>
                      {active !== null && (
                        <span className="visually-hidden">
                          {t(active === 'asc' ? 'table.sort.asc' : 'table.sort.desc')}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const selected = isSelected(row);
              const name = rowName(row, columns, locale, t);
              return (
                <tr
                  key={row.id}
                  data-id={row.id}
                  data-selected={selected}
                  onClick={(e) => {
                    onRowClick(row, e);
                  }}
                >
                  <td>
                    <button
                      type="button"
                      className="table-select"
                      aria-pressed={selected}
                      aria-label={t('table.select', { label: name })}
                      title={t('table.select', { label: name })}
                      onClick={(e) => {
                        // 行の onClick と二重に動かさない。
                        e.stopPropagation();
                        onRowClick(row, e);
                      }}
                    >
                      <span aria-hidden="true">{selected ? '✓' : ''}</span>
                    </button>
                  </td>
                  {shown.map((c) => {
                    const cell = c.cell(row);
                    return (
                      <td
                        key={c.key}
                        data-numeric={c.numeric}
                        title={cellTitle(cell, locale, t) || undefined}
                      >
                        <CellView cell={cell} locale={locale} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <div className="table-target" role="group" aria-label={t('table.target')}>
          {(['node', 'edge'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={target === k}
              onClick={() => {
                switchTarget(k);
              }}
            >
              {t(k === 'node' ? 'table.target.node' : 'table.target.edge')}
            </button>
          ))}
        </div>
        <details className="table-columns">
          <summary>
            {t('table.columns.summary', {
              shown: nf.format(shown.length),
              total: nf.format(columns.length),
            })}
          </summary>
          <div className="table-columns-menu" role="group" aria-label={t('table.columns.label')}>
            {columns.map((c) => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  // 【なぜ】名前を「列名 を表示」にする。図の設定の「ラベル」など、同じ名前の別の欄と、
                  //   名前で取り違えないため（見える文字を含むので、音声操作でも呼べる）。
                  aria-label={t('table.columns.show', { column: headerText(c) })}
                  checked={chosenKeys.has(c.key)}
                  onChange={(e) => {
                    toggleColumn(c.key, e.target.checked);
                  }}
                />
                <bdi>{headerText(c)}</bdi>
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                patchTarget({ columns: DEFAULT_TABLE_VIEW[target].columns });
              }}
            >
              {t('table.columns.reset')}
            </button>
          </div>
        </details>
        <button
          type="button"
          disabled={selectedIndex < 0}
          title={selectedIndex < 0 ? t('table.goSelected.none') : undefined}
          onClick={() => {
            setPage(Math.floor(selectedIndex / TABLE_PAGE_SIZE));
            setScrollTick((n) => n + 1);
          }}
        >
          {t('table.goSelected')}
        </button>
        <span className="table-count">
          {t('table.range', {
            from: nf.format(from),
            to: nf.format(to),
            total: nf.format(rows.length),
          })}
          {rows.length !== total && <> · {t('table.ofAll', { total: nf.format(total) })}</>}
        </span>
      </div>
      {body}
      {rows.length > TABLE_PAGE_SIZE && (
        <nav className="table-pager" aria-label={t('table.pager')}>
          <button
            type="button"
            disabled={current === 0}
            onClick={() => {
              setPage(current - 1);
            }}
          >
            {t('table.page.prev')}
          </button>
          <span role="status">
            {t('table.page', { page: nf.format(current + 1), pages: nf.format(pages) })}
          </span>
          <button
            type="button"
            disabled={current >= pages - 1}
            onClick={() => {
              setPage(current + 1);
            }}
          >
            {t('table.page.next')}
          </button>
        </nav>
      )}
    </div>
  );
}
