import type { Dataset } from '../core/model';
import type { MissingDisplay } from '../core/missing';
import { useT } from './hooks';

/** 欠損の表示の入力。 */
interface Props {
  readonly dataset: Dataset;
  readonly settings: MissingDisplay;
  readonly onChange: (settings: MissingDisplay) => void;
}

/**
 * 「欠損の表示」の節の中身（FR-VG-12）。どの属性が欠損している要素を破線にするかを、
 * ノードとエッジで別に選ぶ。チェックボックスなので、キーボードだけで操作できる。
 *
 * @param props - データセット（属性の一覧）、現在の設定、更新先
 * @returns 操作欄
 */
export function MissingDisplayControls({ dataset, settings, onChange }: Props) {
  const t = useT();
  const group = (target: 'node' | 'edge') => {
    const field = target === 'node' ? 'nodeAttrs' : 'edgeAttrs';
    const selected = settings[field];
    // 同じキーの属性がノード型ごとに複数あっても、1 つにまとめる（照合はキーで行うため）。
    const defs = new Map(
      dataset.schema.filter((d) => d.appliesTo === target).map((d) => [d.key, d.label]),
    );
    const label = t(target === 'node' ? 'missing.display.nodes' : 'missing.display.edges');
    return (
      <fieldset className="missing-display-group" key={target}>
        <legend>{label}</legend>
        {defs.size === 0 && <p className="rl-section-note">{t('missing.display.none')}</p>}
        {[...defs].map(([key, name]) => (
          <label key={key} className="missing-display-item">
            <input
              type="checkbox"
              checked={selected.includes(key)}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                const next = on ? [...selected, key] : selected.filter((k) => k !== key);
                onChange({ ...settings, [field]: next });
              }}
            />
            {/* 属性名は利用者の値（アラビア文字などもありうる）なので、`<bdi>` で隔離する。 */}
            <bdi>{name}</bdi>
          </label>
        ))}
      </fieldset>
    );
  };
  return (
    <div className="missing-display">
      {group('node')}
      {group('edge')}
      {/* 破線の意味を 1 行で示す（図の凡例ではなく、設定の説明。書き出しの凡例は T2-08）。 */}
      <p className="rl-section-note">{t('missing.display.legend')}</p>
    </div>
  );
}
