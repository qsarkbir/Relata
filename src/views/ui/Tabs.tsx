import type { KeyboardEvent } from 'react';
import { tabElementId, tabPanelElementId } from './tabIds';
import './ui.css';

/** タブ 1 つ。 */
export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** {@link Tabs} の props。 */
interface TabsProps<Id extends string> {
  /** タブの並びの名前（読み上げに使う）。 */
  readonly label: string;
  /** 要素の ID の接頭辞。タブとパネルを `aria-controls` と `aria-labelledby` で結ぶ。 */
  readonly idPrefix: string;
  /**
   * パネルの要素の ID の接頭辞（省略すると `idPrefix`）。同じ組のタブを複数の場所に出すとき、タブの ID は
   * 場所ごとに分け（ID は 1 つのページで重ならない）、パネルは 1 つの接頭辞に結ぶために使う。
   */
  readonly panelIdPrefix?: string;
  readonly tabs: readonly TabItem<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
}

/**
 * タブの並び（`role="tablist"`）。左右の矢印キー、Home、End でタブを移り、移った先を選ぶ。
 *
 * 【なぜ】WAI-ARIA のタブの作法に従う。選んだタブだけが Tab キーで止まり（roving tabindex）、
 * ほかのタブへは矢印キーで移る。パネルは呼ぶ側が描く（閉じても中身を残すかを、呼ぶ側が決めるため）。
 * 【TS】`<Id extends string>` はジェネリクス。タブの ID を文字列のリテラル型（`'table'` など）のまま
 * 受け取り、`onSelect` にも同じ型で返す。
 *
 * @param props - 名前、接頭辞、タブの一覧、選択中のタブ、選んだときの処理
 * @returns tablist の要素
 */
export function Tabs<Id extends string>({
  label,
  idPrefix,
  panelIdPrefix,
  tabs,
  selected,
  onSelect,
}: TabsProps<Id>) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    onSelect(target.id);
    // 選んだタブへフォーカスを移す（同じ並びの兄弟の中から探す）。
    const sibling = e.currentTarget.parentElement?.children[next];
    if (sibling instanceof HTMLElement) sibling.focus();
  };
  return (
    <div className="rl-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabElementId(idPrefix, tab.id)}
            aria-selected={active}
            aria-controls={tabPanelElementId(panelIdPrefix ?? idPrefix, tab.id)}
            tabIndex={active ? 0 : -1}
            className="rl-tab"
            onClick={() => {
              onSelect(tab.id);
            }}
            onKeyDown={(e) => {
              onKeyDown(e, index);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
