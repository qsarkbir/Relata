/**
 * 書き出す図の凡例と出典表記を組み立てる（FR-OUT-07、D-42、設計書 §8.3）。
 *
 * 凡例の内容は、図を作った割り当て（色、大きさ、太さ、向きの表現）と、図に実際に現れた
 * 欠損の破線から作る。図に無いものは凡例に出さない。文言は翻訳関数で作り、日本語・英語の切り替えに従う。
 * 凡例の見本は render の `LegendSpec` にして渡し、配置とSVG・PDFへの描画は render が行う
 * （画面表示と書き出しは同じシーンから作る）。
 */
import type { Dataset } from '../core/model';
import type { RelataGraph } from '../core/graph';
import { viridisColor } from '../core/encode';
import { assertNever } from '../core/util/assertNever';
import type { EncodingSettings, ScaleLegend } from '../core/encode';
import { DEFAULT_EDGE_COLOR, DEFAULT_EDGE_OPACITY, bundleLegendItems } from '../render';
import type {
  DirectedEdgeStyle,
  LegendItemSpec,
  BundleWidthScale,
  LegendSpec,
  Scene,
  SceneEncoding,
} from '../render';
import type { MessageKey, MessageParams } from '../i18n';
import type { EncodingLegends } from './graphEncoding';

// 【TS】`MessageKey` は辞書のキーの文字列リテラルの共用体。存在しないキーを渡すと型エラーになる。
/** 翻訳関数。 */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** 出典表記の内容。 */
export interface CreditInfo {
  /** データ名（`dataset.meta.title`）。 */
  readonly title: string;
  /** データの出典（`dataset.meta.source`）。あれば書く。 */
  readonly source?: string;
  /** 作成日（`YYYY-MM-DD`）。呼ぶ側が作って渡す（core は Date を使わない）。 */
  readonly date: string;
}

/** 凡例の入力。 */
export interface FigureLegendInput {
  readonly t: Translate;
  /** 数値の整形（利用者の言語の桁区切りなど）。 */
  readonly formatNumber: (n: number) => string;
  readonly dataset: Dataset;
  readonly graph: RelataGraph;
  readonly settings: EncodingSettings;
  readonly encoding: SceneEncoding;
  readonly legends: EncodingLegends;
  readonly directedStyle: DirectedEdgeStyle;
  /** 凡例なしの図（欠損の破線の有無などを調べるための、凡例を付ける前のシーン）。 */
  readonly scene: Scene;
  /** 束ねた図（帯）の太さの目盛り。渡すと、帯の太さの見本を凡例に足す（`scene.bundle` が帯のときだけ）。 */
  readonly bundleScale?: BundleWidthScale;
  /** 凡例を入れるか。 */
  readonly legend: boolean;
  /** 出典表記を入れるなら、その内容。 */
  readonly credit?: CreditInfo;
}

/** 出典表記の 1 行の長さの上限（文字数）。長い出典で凡例の枠が図より大きくならないようにする。 */
export const CREDIT_MAX_CHARS = 48;

/**
 * 長い文字列を、上限の文字数で切って `…` を付ける。
 *
 * 【なぜ】UTF-16 の単位ではなく、書記素で数える（サロゲートペアや結合記号の途中で切ると、壊れた文字が残る）。
 *
 * @param text - 文字列
 * @param max - 上限の文字数
 * @returns 切った文字列。上限以内ならそのまま
 */
export function clipText(text: string, max: number): string {
  // 【なぜ】書記素（利用者が 1 文字と見るまとまり）で数える。コードポイントで切ると、結合記号つきの字
  // （ḥ = h + U+0323、絵文字の連結など）が土台と離れて、壊れた表記になる。
  const parts = graphemes(text);
  return parts.length <= max ? text : parts.slice(0, max - 1).join('') + '…';
}

// 文字列を書記素に分ける（Intl.Segmenter。言語に依らず UAX #29 の規則）。
function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    (x) => x.segment,
  );
}

/**
 * 書記素の数を数える。
 *
 * @param text - 文字列
 * @returns 書記素の数
 */
export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

const NEUTRAL = '#999999';
// 【なぜ】線の見本は、図のエッジと同じ色・不透明度にする（凡例と図の見え方を一致させる）。
const EDGE_COLOR = DEFAULT_EDGE_COLOR;
const EDGE_OPACITY = DEFAULT_EDGE_OPACITY;

// 大きさ・太さの代表値の項目を作る（値は有効数字 3 桁まで）。
function tickLabel(value: number, formatNumber: (n: number) => string): string {
  return formatNumber(Number(value.toPrecision(3)));
}

function sizeItems(legend: ScaleLegend, f: (n: number) => string): LegendItemSpec[] {
  return legend.ticks.map((tick) => ({
    label: tickLabel(tick.value, f),
    fill: NEUTRAL,
    r: tick.size,
  }));
}

/**
 * 書き出す図の凡例の指定を作る。
 *
 * 見出し（太字）、見本つきの項目、文字だけの行（出典表記）の順に並べる。
 * 凡例も出典表記も不要なら undefined（図に凡例の枠を作らない）。
 *
 * @param input - 割り当て、グラフ、シーン、凡例と出典表記の選択
 * @returns 凡例の指定。出すものが無ければ undefined
 */
export function buildFigureLegend(input: FigureLegendInput): LegendSpec | undefined {
  const { t, formatNumber: f, dataset, graph, settings, encoding, legends, scene } = input;
  const items: LegendItemSpec[] = [];
  const heading = (label: string): void => {
    items.push({ label, fill: NEUTRAL, mark: 'none', bold: true });
  };
  const text = (label: string): void => {
    items.push({ label, fill: NEUTRAL, mark: 'none' });
  };
  const attrName = (key: string): string => dataset.schema.find((a) => a.key === key)?.label ?? key;
  const metricName = (id: string): string =>
    id === 'degree' || id === 'inDegree' || id === 'outDegree' ? t(`graph.${id}`) : id;

  if (input.legend) {
    // --- 色（と型の形） ---
    const typesInGraph = new Set(graph.mapNodes((_, a) => a.type));
    const usedTypes = dataset.nodeTypes.filter((ty) => typesInGraph.has(ty.id));
    const color = legends.color;
    // 【TS】判別共用体の分岐は switch にし、default で `assertNever` を呼ぶ。色の種類を足したとき、
    //       ここを直し忘れると型エラーになる（網羅性の検査）。
    switch (color.kind) {
      case 'nodeType': {
        heading(t('legend.nodeType'));
        for (const ty of usedTypes)
          items.push({
            label: ty.label,
            fill: encoding.typeColors?.get(ty.id) ?? NEUTRAL,
            shape: encoding.shapes?.get(ty.id) ?? 'circle',
          });
        break;
      }
      case 'category': {
        heading(t('legend.nodeColor', { name: attrName(color.attr) }));
        for (const e of color.legend.entries) items.push({ label: e.key, fill: e.color });
        if (color.legend.otherCount > 0)
          items.push({
            label: t('legend.other', { n: color.legend.otherCount }),
            fill: color.legend.otherColor,
          });
        if (color.legend.missingCount > 0)
          items.push({ label: t('legend.missingValue'), fill: color.legend.missingColor });
        break;
      }
      case 'gradient': {
        heading(t('legend.nodeColor', { name: metricName(color.metric) }));
        const g = color.legend;
        if (g.state === 'range') {
          items.push({
            label: t('legend.max', { value: tickLabel(g.max, f) }),
            fill: viridisColor(1),
          });
          items.push({ label: tickLabel((g.min + g.max) / 2, f), fill: viridisColor(0.5) });
          items.push({
            label: t('legend.min', { value: tickLabel(g.min, f) }),
            fill: viridisColor(0),
          });
        } else if (g.state === 'single') {
          items.push({ label: tickLabel(g.min, f), fill: viridisColor(0.5) });
        }
        if (g.missingCount > 0)
          items.push({ label: t('legend.missingValue'), fill: g.missingColor });
        break;
      }
      default:
        assertNever(color, 'EncodingLegends.color');
    }
    // 色を型以外にしたとき、形は型を表す。形で型を見分けられるよう、型の一覧を別に出す。
    if (
      color.kind !== 'nodeType' &&
      settings.nodeShape.kind === 'nodeType' &&
      usedTypes.length > 1
    ) {
      heading(t('legend.nodeType'));
      for (const ty of usedTypes)
        items.push({
          label: ty.label,
          fill: NEUTRAL,
          shape: encoding.shapes?.get(ty.id) ?? 'circle',
        });
    }

    // --- 大きさ ---
    const source = settings.nodeSize.source;
    if (source.kind !== 'constant' && legends.size !== null) {
      const name = source.kind === 'attr' ? attrName(source.attr) : metricName(source.metric);
      heading(t('legend.nodeSize', { name }));
      items.push(...sizeItems(legends.size, f));
    }

    // --- エッジの太さ ---
    if (legends.width !== null) {
      heading(t('legend.edgeWidth'));
      for (const tick of legends.width.ticks)
        items.push({
          label: tickLabel(tick.value, f),
          fill: EDGE_COLOR,
          opacity: EDGE_OPACITY,
          mark: 'line',
          lineWidth: tick.size,
        });
    }

    // --- 束の太さ（FR-VG-14）。帯のときだけ。見本の太さと色は図の帯と同じ ---
    if (input.bundleScale !== undefined && scene.bundle?.style === 'bands') {
      const samples = bundleLegendItems(
        input.bundleScale,
        (w) => t('legend.bundleWeight', { w: f(w) }),
        scene.bundle.color,
      );
      if (samples.length > 0) {
        heading(t('legend.bundleWidth'));
        items.push(...samples.map((i) => ({ ...i, opacity: scene.bundle?.opacity ?? 1 })));
      }
    }

    // --- エッジの向き（D-07: 既定は矢印） ---
    const hasDirected = graph.someEdge((_, a) => a.directed);
    const hasUndirected = graph.someEdge((_, a) => !a.directed);
    if (hasDirected || hasUndirected) {
      heading(t('legend.edges'));
      if (hasUndirected)
        items.push({
          label: t('legend.undirected'),
          fill: EDGE_COLOR,
          opacity: EDGE_OPACITY,
          mark: 'line',
          lineWidth: 1.5,
        });
      if (hasDirected) {
        // 向きの表し方（arrow、taper、gradient）ごとに、図と同じ形の見本を出す。
        const style = input.directedStyle;
        items.push({
          label: t(`legend.directed.${style}`),
          fill: EDGE_COLOR,
          opacity: EDGE_OPACITY,
          mark: style,
          // 先細りは太さが見えるよう、やや太い見本にする。
          lineWidth: style === 'taper' ? 5 : 1.5,
        });
      }
    }

    // --- 欠損の破線（D-42）。図に現れた種類だけを出す ---
    const nodeValue = scene.nodes.some((n) => n.dashed && n.attrMissing !== true);
    const nodeAttr = scene.nodes.some((n) => n.attrMissing === true);
    const edgeValue = scene.edges.some((e) => e.dashed && e.attrMissing !== true);
    const edgeAttr = scene.edges.some((e) => e.attrMissing === true);
    if (nodeValue || nodeAttr || edgeValue || edgeAttr) {
      heading(t('legend.missing'));
      if (nodeValue)
        items.push({ label: t('legend.missing.nodeValue'), fill: NEUTRAL, dashed: true });
      if (nodeAttr)
        items.push({
          label: t('legend.missing.nodeAttr'),
          fill: NEUTRAL,
          dashed: true,
          attrMissing: true,
        });
      if (edgeValue)
        items.push({
          label: t('legend.missing.edgeValue'),
          fill: EDGE_COLOR,
          opacity: EDGE_OPACITY,
          mark: 'line',
          lineWidth: 1.5,
          dashed: true,
        });
      if (edgeAttr)
        items.push({
          label: t('legend.missing.edgeAttr'),
          fill: EDGE_COLOR,
          opacity: EDGE_OPACITY,
          mark: 'line',
          lineWidth: 1.5,
          dashed: true,
          attrMissing: true,
        });
    }
  }

  // --- 出典表記 ---
  const credit = input.credit;
  if (credit !== undefined) {
    if (items.length > 0) heading(t('legend.credit'));
    text(t('legend.credit.data', { title: clipText(credit.title, CREDIT_MAX_CHARS) }));
    // 【なぜ】出典の欄は短い引用だけを載せる。`meta.source` には長い説明文（取得元の経緯など）が入ることがあり、
    // 48 字で切ると意味が途切れるため、長いときは省く（データ名と作成日は必ず載せる）。
    if (
      credit.source !== undefined &&
      credit.source !== '' &&
      graphemeCount(credit.source) <= CREDIT_MAX_CHARS
    )
      text(t('legend.credit.source', { source: credit.source }));
    text(t('legend.credit.date', { date: credit.date }));
    text(t('legend.credit.tool'));
  }
  if (items.length === 0) return undefined;
  return input.legend ? { title: t('legend.title'), items } : { items };
}
