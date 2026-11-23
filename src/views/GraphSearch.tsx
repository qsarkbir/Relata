import { useEffect, useId, useRef, useState } from 'react';
import { useT } from './hooks';
import { Field } from './ui/Field';
import { StatusMessage } from './ui/StatusMessage';

/** 結果の一覧に出す最大件数。多すぎると一覧が図を覆い、探すのも難しくなる。 */
export const MAX_SEARCH_RESULTS = 50;

/** 検索の結果 1 件。 */
export interface SearchHit {
  readonly id: string;
  readonly label: string;
}

/** {@link GraphSearch} の props。 */
interface GraphSearchProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** 照合に合ったノード（全件）。上位だけを出す。照合は親が `core/text` で行う。 */
  readonly hits: readonly SearchHit[];
  /** 結果を選んだとき。 */
  readonly onPick: (id: string) => void;
  /** 件数を表す文言（親が言語に合わせた数の書式で作る）。 */
  readonly formatCount: (count: number) => string;
}

/**
 * ノードの検索欄と結果の一覧（コンボボックスの作法）。
 *
 * ↑↓ で移り、Enter で選び、Esc で閉じる（もう一度 Esc で検索語を消す）。フォーカスは常に入力欄に置き、
 * 選択中の行は `aria-activedescendant` で伝える。一覧の外を押しても閉じる。
 * 件数は、見えない `role="status"` で読み上げる。
 * @param props - 検索語、結果、選んだときの処理
 * @returns 検索欄の要素
 */
export function GraphSearch({ query, onQuery, hits, onPick, formatCount }: GraphSearchProps) {
  const t = useT();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const shown = hits.slice(0, MAX_SEARCH_RESULTS);
  const more = hits.length - shown.length;
  const expanded = query !== '' && open;
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    if (!expanded) return;
    // 【なぜ】一覧の外を押したら閉じる。入力欄の中を押したときは閉じない。
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true)
        setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [expanded]);

  const pick = (id: string) => {
    setOpen(true);
    onPick(id);
  };
  const status =
    query === '' ? '' : hits.length === 0 ? t('graph.search.noResults') : formatCount(hits.length);
  return (
    <div className="graph-search" ref={root}>
      <Field label={t('graph.search')}>
        <input
          type="search"
          dir="auto"
          role="combobox"
          aria-expanded={expanded && shown.length > 0}
          // 【なぜ】一覧を描いていないとき（0 件、閉じている）は、存在しない ID を指さない。
          aria-controls={expanded && shown.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={expanded && shown.length > 0 ? optionId(activeIndex) : undefined}
          value={query}
          onFocus={() => {
            setOpen(true);
          }}
          onChange={(e) => {
            setOpen(true);
            setActive(0);
            onQuery(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              if (shown.length === 0) return;
              e.preventDefault();
              setOpen(true);
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((activeIndex + step + shown.length) % shown.length);
            } else if (e.key === 'Enter') {
              const hit = shown[activeIndex];
              if (expanded && hit !== undefined) {
                e.preventDefault();
                pick(hit.id);
              }
            } else if (e.key === 'Escape' && query !== '') {
              e.stopPropagation();
              if (expanded) setOpen(false);
              else onQuery('');
            }
          }}
        />
      </Field>
      <div className="visually-hidden" role="status">
        {status}
      </div>
      {expanded && (
        <div className="graph-search-popup">
          {hits.length === 0 ? (
            <StatusMessage
              announce={false}
              state={{
                kind: 'no-results',
                message: t('graph.search.noResults'),
                hint: t('graph.search.noResultsHint'),
              }}
            />
          ) : (
            <>
              <ul className="graph-search-results" id={listId} role="listbox">
                {shown.map((hit, index) => (
                  <li
                    key={hit.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(e) => {
                      // 【なぜ】押してもフォーカスが入力欄から離れないようにする。
                      e.preventDefault();
                    }}
                    onClick={() => {
                      pick(hit.id);
                    }}
                  >
                    <bdi>{hit.label}</bdi> <bdi className="graph-search-id">{hit.id}</bdi>
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <p className="graph-search-more">{t('graph.search.more', { count: more })}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
