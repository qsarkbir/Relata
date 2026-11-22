import { useId, useState } from 'react';
import type { Target, TextMatching } from '../../core/filter';
import { useFilter, useT } from '../hooks';
import type { FilterOfKind } from './activeFilters';
import { DuplicateNotice } from './DuplicateNotice';
import { textFilterId } from './filterIds';
import { InfoTip } from '../ui/InfoTip';

/** テキスト検索の部品の入力。 */
interface TextSearchProps {
  readonly target: Target;
  /** いま適用中の、この対象の最初の検索（無ければ undefined）。 */
  readonly active: FilterOfKind<'text'> | undefined;
  /** 同じ条件の、2 つ目以降のフィルタの数。 */
  readonly duplicates: number;
}

/**
 * テキスト検索（FR-FL-02、FR-FL-12）。照合は「ゆるい」（表記の揺れを無視）と「厳密」から選ぶ。
 *
 * 照合そのものは core の `applyFilters` が行う。ここは検索語と照合の強さを FilterState に入れるだけ。
 * 空の検索語で確定すると、フィルタを解除する。検索語は下書きで、適用中と違えば「未適用」と示す。
 * 照合の強さの選択は、適用中なら即時に反映する。
 *
 * @param props - 対象、適用中の検索、重複の数
 * @returns 検索フォームの要素
 */
export function TextSearch({ target, active, duplicates }: TextSearchProps) {
  const t = useT();
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  const inputId = useId();
  const dirtyId = useId();

  const [query, setQuery] = useState('');
  const [matching, setMatching] = useState<TextMatching>('loose');
  // 【なぜ】適用中のフィルタが外から変わったとき（解除、Undo）に、入力欄を合わせ直す（項目ごと）。
  const [prev, setPrev] = useState<FilterOfKind<'text'> | undefined>(undefined);
  if (prev !== active) {
    setPrev(active);
    if (prev?.query !== active?.query) setQuery(active?.query ?? '');
    if (prev?.matching !== active?.matching) setMatching(active?.matching ?? 'loose');
  }

  const dirty = query !== (active?.query ?? '');
  const label = t(target === 'node' ? 'filter.search.titleNode' : 'filter.search.titleEdge');

  return (
    <form
      className="text-search"
      role="search"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        const id = active?.id ?? textFilterId(target);
        if (query.trim() === '') {
          if (active !== undefined) remove(id);
        } else if (active === undefined || dirty || active.matching !== matching) {
          // 【なぜ】内容が適用中のものと同じなら追加しない（履歴に空振りを積まない）。
          add({ id, kind: 'text', target, query, matching });
        }
      }}
    >
      <DuplicateNotice count={duplicates} />
      <div className="label-row">
        <label htmlFor={inputId}>
          {t(target === 'node' ? 'filter.search.queryNode' : 'filter.search.queryEdge')}
        </label>
        <InfoTip
          topic={t(target === 'node' ? 'filter.search.queryNode' : 'filter.search.queryEdge')}
        >
          <p>{t(target === 'node' ? 'filter.search.target.node' : 'filter.search.target.edge')}</p>
        </InfoTip>
      </div>
      {/* 【なぜ】検索語はアラビア文字などの右から左の文字も入る。dir="auto" で入力の向きを文字から決める。 */}
      <input
        id={inputId}
        type="search"
        dir="auto"
        value={query}
        aria-describedby={dirty ? dirtyId : undefined}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
        }}
      />
      <label>
        {t('filter.search.matching')}
        <select
          value={matching}
          onChange={(e) => {
            const next: TextMatching = e.currentTarget.value === 'strict' ? 'strict' : 'loose';
            setMatching(next);
            // 適用中なら、照合の強さだけ即時に反映する（検索語は適用中の値のまま）。
            if (active !== undefined) add({ ...active, matching: next });
          }}
        >
          <option value="loose">{t('filter.search.loose')}</option>
          <option value="strict">{t('filter.search.strict')}</option>
        </select>
      </label>
      <button type="submit">{t('filter.search.apply')}</button>
      {dirty && (
        <p id={dirtyId} className="hint">
          {t('filter.unapplied')}
        </p>
      )}
    </form>
  );
}
