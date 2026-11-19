import { useId, useState } from 'react';
import type { MissingPolicy, Target } from '../../core/filter';
import type { AttributeDef } from '../../core/model';
import { useFilter, useT } from '../hooks';
import type { FilterOfKind } from './activeFilters';
import { DuplicateNotice } from './DuplicateNotice';
import { rangeFilterId } from './filterIds';
import { parseNumber } from './parseNumber';

/** 数値の範囲 1 属性の部品の入力。 */
interface RangeControlProps {
  readonly target: Target;
  readonly def: AttributeDef;
  /** いま適用中のこの属性の最初のフィルタ（無ければ undefined）。 */
  readonly active: FilterOfKind<'range'> | undefined;
  /** 同じ条件の、2 つ目以降のフィルタの数。 */
  readonly duplicates: number;
  /** 欠損のために除いた件数（`FilterResult.missingExcluded`）。フィルタが無ければ undefined。 */
  readonly excluded: number | undefined;
}

/**
 * 数値の属性の範囲（FR-FL-02、FR-FL-06）。
 *
 * 入力欄は下書きで、Enter か「適用」で FilterState に反映する（1 文字ごとに履歴を積まないため）。
 * 下書きが適用中の値と違うときは「未適用」と示す。欠損の扱いの選択は、適用中なら即時に反映する。
 * 適用中のフィルタが外から変わったとき（解除、Undo）は、変わった項目だけ下書きを合わせ直す。
 *
 * 【なぜ】入力欄は `type="number"` にしない。ブラウザは `1e` やアラビア・インド数字（١٢）を
 * 受け付けず、`value` が空になって、範囲の端が黙って消える。文字列として受け、`parseNumber` で読む。
 *
 * @param props - 対象、属性の定義、適用中のフィルタ、除いた件数
 * @returns 範囲の要素
 */
export function RangeControl({ target, def, active, duplicates, excluded }: RangeControlProps) {
  const t = useT();
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  // 【なぜ】aria-describedby の ID は useId で作る。属性名に空白などが入っていても壊れない。
  const errorId = useId();
  const dirtyId = useId();

  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  // 【TS】`useState<MissingPolicy>` のように型引数を書くと、初期値から推論される string ではなく、
  //       'include' | 'exclude' の共用体として扱われる。
  const [missing, setMissing] = useState<MissingPolicy>('exclude');
  const [error, setError] = useState<'invalid' | 'reversed' | null>(null);
  // 【なぜ】フィルタの変化に下書きを合わせる。effect ではなく、描画中に前の値と比べて調整する
  //       （React 公式の「前の props から state を調整する」書き方。TaskPanel と同じ）。
  //       項目ごとに比べ、変わった項目だけ合わせる（欠損の扱いを即時に反映しても、入力中の値を消さない）。
  const [prev, setPrev] = useState<FilterOfKind<'range'> | undefined>(undefined);
  if (prev !== active) {
    setPrev(active);
    if (prev?.min !== active?.min) setMin(active?.min === undefined ? '' : String(active.min));
    if (prev?.max !== active?.max) setMax(active?.max === undefined ? '' : String(active.max));
    if (prev?.missing !== active?.missing) setMissing(active?.missing ?? 'exclude');
    setError(null);
  }

  const lo = parseNumber(min);
  const hi = parseNumber(max);
  // 下書きが適用中の値と違うか。不正な入力も「違う」とみなす。
  const dirty = lo !== active?.min || hi !== active?.max;

  const submit = (): void => {
    if (lo === 'invalid' || hi === 'invalid') {
      setError('invalid');
      return;
    }
    const id = active?.id ?? rangeFilterId(target, def.key);
    if (lo === undefined && hi === undefined) {
      if (active !== undefined) remove(id);
      return;
    }
    if (lo !== undefined && hi !== undefined && lo > hi) {
      setError('reversed');
      return;
    }
    setError(null);
    // 【なぜ】内容が適用中のものと同じなら追加しない（履歴に空振りを積まない）。
    if (active !== undefined && !dirty && active.missing === missing) return;
    add({
      id,
      kind: 'range',
      target,
      attr: def.key,
      ...(lo === undefined ? {} : { min: lo }),
      ...(hi === undefined ? {} : { max: hi }),
      missing,
    });
  };

  const describedBy =
    [error === null ? null : errorId, dirty ? dirtyId : null].filter((x) => x !== null).join(' ') ||
    undefined;
  return (
    <details className="range">
      <summary>
        <bdi>{def.label}</bdi>
      </summary>
      <DuplicateNotice count={duplicates} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="range-fields">
          <label>
            {t('filter.range.min')}
            <input
              type="text"
              inputMode="decimal"
              value={min}
              aria-describedby={describedBy}
              onChange={(e) => {
                setMin(e.currentTarget.value);
              }}
            />
          </label>
          <label>
            {t('filter.range.max')}
            <input
              type="text"
              inputMode="decimal"
              value={max}
              aria-describedby={describedBy}
              onChange={(e) => {
                setMax(e.currentTarget.value);
              }}
            />
          </label>
        </div>
        <label>
          {t('filter.range.missing')}
          <select
            value={missing}
            onChange={(e) => {
              const next: MissingPolicy =
                e.currentTarget.value === 'include' ? 'include' : 'exclude';
              setMissing(next);
              // 適用中なら、欠損の扱いだけ即時に反映する（範囲の端は適用中の値のまま）。
              if (active !== undefined) add({ ...active, missing: next });
            }}
          >
            <option value="exclude">{t('filter.range.missing.exclude')}</option>
            <option value="include">{t('filter.range.missing.include')}</option>
          </select>
        </label>
        <button type="submit">{t('filter.range.apply')}</button>
        {/* 色だけで伝えない: 文字で「未適用」と示し、入力欄から aria-describedby で結ぶ。 */}
        {dirty && (
          <p id={dirtyId} className="hint">
            {t('filter.unapplied')}
          </p>
        )}
        {error !== null && (
          <p id={errorId} role="alert" className="error">
            {error === 'invalid' ? t('filter.range.invalid') : t('filter.range.reversed')}
          </p>
        )}
      </form>
      {excluded !== undefined && (
        <p className="hint">{t('filter.range.excluded', { count: excluded })}</p>
      )}
    </details>
  );
}
