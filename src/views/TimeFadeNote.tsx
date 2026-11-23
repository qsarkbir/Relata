import { useData, useT, useTime, useUi } from './hooks';
import { useTimeStateText } from './timeFade';
import type { GraphFade } from '../state';
import { getNumberFormat } from './intl';

/**
 * 再生の時刻の外の要素を薄く表示していることを、図の上に文で示す（R-17、方針 §3.2）。
 *
 * 「表示されていない」理由の 1 つ。絞り込みで除いた（図から消えた）ものとは別の文言にし、
 * 薄くしただけで消していないこと、件数・表・指標は変わらないことを書く。薄さだけに頼らず、文でも伝える。
 * 時刻を決めていない（再生の前）ときは何も出さない。
 *
 * @param props - 薄くしている要素
 * @param props.fade - 薄くしているノードとエッジ
 * @returns 注記。時刻が無ければ null
 */
export function TimeFadeNote({ fade }: { readonly fade: GraphFade }) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const dataset = useData((s) => s.dataset);
  const at = useTime((s) => s.at);
  const timeText = useTimeStateText();
  if (dataset === null || at === null || timeText === '') return null;
  const nf = getNumberFormat(locale);
  return (
    <p className="graph-time-note" data-testid="time-fade-note" dir="auto">
      <bdi>
        {t('time.fadeNote', {
          time: timeText,
          nodes: nf.format(fade.nodes.size),
          edges: nf.format(fade.edges.size),
        })}
      </bdi>
    </p>
  );
}
