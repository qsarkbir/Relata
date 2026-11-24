import { useData, useT, useTime, useUi } from './hooks';
import { useTimeStateText } from './timeFade';
import type { GraphFade } from '../state';
import { getNumberFormat } from './intl';

/**
 * 再生の時刻の外の要素を薄く表示していることを、図の窓の角に小さな文字で重ねて示す（R-17、方針 §3.2）。
 *
 * 「表示されていない」理由の 1 つ。絞り込みで除いた（図から消えた）ものとは別の文言にする。
 * 薄さだけに頼らず、文でも伝える。時刻を決めていない（再生の前）ときは何も出さない。
 *
 * 【なぜ】図の上に 1 行を取ると、再生のたびに図の高さが変わる。窓の中に重ね、`pointer-events: none` で
 * パン、ドラッグ、クリックを邪魔しない。重ねた短い文は支援技術には読ませず（`aria-hidden`）、
 * 以前と同じ詳しい文（消していないこと、件数と表は変わらないこと）を、見えない文で伝える。
 * 「再生は表示だけを変える」の説明は、年表の (i) に置く。
 * 親は位置の基準（`position: relative`）になる要素で、この部品を図の窓と同じ箱に入れる。
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
  const args = {
    time: timeText,
    nodes: nf.format(fade.nodes.size),
    edges: nf.format(fade.edges.size),
  };
  return (
    <>
      <p className="graph-time-note" data-testid="time-fade-note" dir="auto" aria-hidden="true">
        <bdi>{t('time.fadeShort', args)}</bdi>
      </p>
      <p className="visually-hidden" data-testid="time-fade-note-sr" dir="auto">
        <bdi>{t('time.fadeNote', args)}</bdi>
      </p>
    </>
  );
}
