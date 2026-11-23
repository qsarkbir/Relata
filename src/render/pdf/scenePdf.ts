/**
 * シーンから PDF のページ内容（コンテンツストリーム）を作る（FR-OUT-04、設計書 §8.1、§11.2）。
 *
 * 画面の SVG と同じシーンから作る（書き出し専用の別の描画処理にしない）。図形は PDF のパスで描き、
 * 文字は、呼ぶ側が渡す整形関数（`TextOutliner`）が返す輪郭を塗りつぶして描く。
 * 日本語もアラビア文字（連結、右から左）も、輪郭になっているので、閲覧ソフトのフォントに左右されない。
 * 【なぜ】PDF の文字描画は、OpenType の字形の置き換え（GSUB）をしないため、アラビア文字が
 * ばらばらの字形になる。整形済みの輪郭を描けば、字形の選択も並びも確実に再現できる。
 * 代わりに、PDF の中の文字を検索・選択することはできない（D-43 との違い）。
 *
 * 座標系: シーンの座標（左上が原点、y が下向き、単位 px）をそのまま使い、ページの先頭で
 * `[0.75 0 0 -0.75 0 H] cm` により、y を反転して pt（1 px = 0.75 pt）にする。
 * DOM は使わない。計算量はシーンの図形数と輪郭の点数に比例。
 */
import { assertNever } from '../../core/util/assertNever';
import { shapeExtent } from '../scene/build';
import type {
  PathCommand,
  Scene,
  SceneEdge,
  SceneLabel,
  SceneLegendItem,
  SceneNode,
} from '../scene/types';
import { safeColor } from '../svg/escape';
import type { OutlineCommand, TextOutliner } from './outline';

/** px から pt への換算（CSS の 96 dpi）。 */
export const PX_TO_PT = 0.75;

/** `renderPdfContent` の選択肢。 */
export interface PdfSceneOptions {
  /** 背景色（`#rrggbb`）。省略は透明（紙の色）。 */
  readonly background?: string;
  /** 文字を輪郭にする関数。 */
  readonly outline: TextOutliner;
}

/** ページの内容と、描画の状態の一覧。 */
export interface PdfContent {
  /** ページの幅と高さ（pt）。 */
  readonly widthPt: number;
  readonly heightPt: number;
  /** コンテンツストリーム（テキスト。ASCII だけ）。 */
  readonly stream: string;
  /** 使った透明度の状態。名前は `G0`、`G1`…。 */
  readonly graphicsStates: readonly {
    readonly name: string;
    readonly stroke: number;
    readonly fill: number;
  }[];
}

const fmt = (v: number): string => {
  // 【なぜ】小数 3 桁（約 0.001 px）で十分。文字列を短くして、ファイルを小さく保つ。
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === '-0' ? '0' : s;
};

function rgb(color: string, fallback: string): string {
  const hex = safeColor(color, fallback);
  const n = (i: number): string => fmt(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255);
  return `${n(0)} ${n(1)} ${n(2)}`;
}

/** コンテンツストリームを組み立てる小さな書き手。 */
class Writer {
  readonly lines: string[] = [];
  private readonly states = new Map<string, number>();
  readonly list: { name: string; stroke: number; fill: number }[] = [];

  op(s: string): void {
    this.lines.push(s);
  }

  /**
   * 透明度の状態を選ぶ。1 と 1 のときは何もしない（既定）。
   * @param stroke
   * @param fill
   */
  alpha(stroke: number, fill: number): void {
    const s = Math.min(1, Math.max(0, stroke));
    const f = Math.min(1, Math.max(0, fill));
    const key = `${fmt(s)}/${fmt(f)}`;
    let index = this.states.get(key);
    if (index === undefined) {
      index = this.list.length;
      this.states.set(key, index);
      this.list.push({ name: `G${String(index)}`, stroke: s, fill: f });
    }
    this.op(`/G${String(index)} gs`);
  }

  path(commands: readonly (PathCommand | OutlineCommand)[]): void {
    let cx = 0;
    let cy = 0;
    for (const c of commands) {
      switch (c.type) {
        case 'M':
          this.op(`${fmt(c.x)} ${fmt(c.y)} m`);
          cx = c.x;
          cy = c.y;
          break;
        case 'L':
          this.op(`${fmt(c.x)} ${fmt(c.y)} l`);
          cx = c.x;
          cy = c.y;
          break;
        case 'Q':
          // 【なぜ】PDF のパスには 2 次ベジェが無い。3 次に厳密に変換する（制御点を 2/3 だけ寄せる）。
          this.op(
            `${fmt(cx + ((c.cx - cx) * 2) / 3)} ${fmt(cy + ((c.cy - cy) * 2) / 3)} ` +
              `${fmt(c.x + ((c.cx - c.x) * 2) / 3)} ${fmt(c.y + ((c.cy - c.y) * 2) / 3)} ` +
              `${fmt(c.x)} ${fmt(c.y)} c`,
          );
          cx = c.x;
          cy = c.y;
          break;
        case 'C':
          this.op(
            `${fmt(c.c1x)} ${fmt(c.c1y)} ${fmt(c.c2x)} ${fmt(c.c2y)} ${fmt(c.x)} ${fmt(c.y)} c`,
          );
          cx = c.x;
          cy = c.y;
          break;
        case 'Z':
          this.op('h');
          break;
        default:
          assertNever(c, 'PathCommand | OutlineCommand');
      }
    }
  }

  polygon(points: readonly { readonly x: number; readonly y: number }[]): void {
    points.forEach((p, i) => {
      this.op(`${fmt(p.x)} ${fmt(p.y)} ${i === 0 ? 'm' : 'l'}`);
    });
    this.op('h');
  }
}

/** 円を 4 本の 3 次ベジェで描く（κ = 4(√2 − 1)/3 ≈ 0.5523）。 */
const KAPPA = 0.5522847498;
function circlePath(w: Writer, x: number, y: number, r: number): void {
  const k = r * KAPPA;
  w.op(`${fmt(x + r)} ${fmt(y)} m`);
  w.op(`${fmt(x + r)} ${fmt(y + k)} ${fmt(x + k)} ${fmt(y + r)} ${fmt(x)} ${fmt(y + r)} c`);
  w.op(`${fmt(x - k)} ${fmt(y + r)} ${fmt(x - r)} ${fmt(y + k)} ${fmt(x - r)} ${fmt(y)} c`);
  w.op(`${fmt(x - r)} ${fmt(y - k)} ${fmt(x - k)} ${fmt(y - r)} ${fmt(x)} ${fmt(y - r)} c`);
  w.op(`${fmt(x + k)} ${fmt(y - r)} ${fmt(x + r)} ${fmt(y - k)} ${fmt(x + r)} ${fmt(y)} c`);
  w.op('h');
}

/**
 * ノードの形のパスを現在のパスに足す。形の大きさは SVG と同じ式（`shapeExtent`）。
 * @param w
 * @param shape
 * @param x
 * @param y
 * @param r
 */
function shapePath(w: Writer, shape: SceneNode['shape'], x: number, y: number, r: number): void {
  const e = shapeExtent(shape, r);
  switch (shape) {
    case 'circle':
      circlePath(w, x, y, r);
      return;
    case 'square': {
      const s = r * Math.sqrt(Math.PI);
      w.polygon([
        { x: x - s / 2, y: y - s / 2 },
        { x: x + s / 2, y: y - s / 2 },
        { x: x + s / 2, y: y + s / 2 },
        { x: x - s / 2, y: y + s / 2 },
      ]);
      return;
    }
    case 'triangle':
      w.polygon(
        [0, 1, 2].map((k) => {
          const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
          return { x: x + e * Math.cos(a), y: y + e * Math.sin(a) };
        }),
      );
      return;
    case 'diamond':
      w.polygon([
        { x, y: y - e },
        { x: x + e, y },
        { x, y: y + e },
        { x: x - e, y },
      ]);
      return;
    default:
      assertNever(shape, 'NodeShape');
  }
}

function setDash(w: Writer, on: boolean, pattern: string): void {
  w.op(on ? `[${pattern}] 0 d` : '[] 0 d');
}

function drawNode(w: Writer, n: SceneNode): void {
  w.op('q');
  w.alpha(1, 1);
  w.op(`${rgb(n.fill, '#999999')} rg ${rgb(n.stroke, '#333333')} RG ${fmt(n.strokeWidth)} w`);
  // 【なぜ】破線の間隔は SVG と同じ（値の欠損 3 2、指定した属性の欠損 6 3）。
  if (n.dashed) setDash(w, true, n.attrMissing === true ? '6 3' : '3 2');
  shapePath(w, n.shape, n.x, n.y, n.r);
  w.op('B');
  w.op('Q');
}

// 経路を、一定数の折れ線に標本化する（濃淡のあるエッジを区間ごとの塗りに分けるため）。
function flatten(path: readonly PathCommand[], perCurve: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let cx = 0;
  let cy = 0;
  for (const c of path) {
    if (c.type === 'M') pts.push({ x: c.x, y: c.y });
    else if (c.type === 'L') pts.push({ x: c.x, y: c.y });
    else
      for (let i = 1; i <= perCurve; i++) {
        const t = i / perCurve;
        const u = 1 - t;
        pts.push({
          x: u * u * cx + 2 * u * t * c.cx + t * t * c.x,
          y: u * u * cy + 2 * u * t * c.cy + t * t * c.y,
        });
      }
    cx = c.x;
    cy = c.y;
  }
  return pts;
}

function drawEdge(w: Writer, e: SceneEdge): void {
  const color = rgb(e.color, '#999999');
  const opacity = Math.min(1, Math.max(0, e.opacity));
  const dash = e.attrMissing === true ? '9 4' : '4 3';
  w.op('q');
  if (e.ribbon !== undefined) {
    // 先細りの帯は塗りの図形。欠損のときは塗りを薄くし、輪郭に破線を付ける（renderSvg と同じ）。
    w.alpha(opacity, e.dashed ? opacity * 0.4 : opacity);
    w.op(`${color} rg ${color} RG`);
    w.polygon(e.ribbon);
    if (e.dashed) {
      w.op(`1 w [${dash}] 0 d`);
      w.op('B');
    } else {
      w.op('f');
    }
    w.op('Q');
    return;
  }
  w.op(`${color} RG ${fmt(e.width)} w`);
  if (e.dashed) setDash(w, true, dash);
  if (e.gradient !== undefined) {
    // 【なぜ】PDF の線は、色の変化（透明度の勾配）を直接持てない。経路を短い区間に分け、始点から
    // 終点への位置に応じて透明度を変えて、区間ごとに描く（SVG の stop-opacity 0.15 → 1 と同じ）。
    const g = e.gradient;
    const ax = g.end.x - g.start.x;
    const ay = g.end.y - g.start.y;
    const len2 = ax * ax + ay * ay || 1;
    const pts = flatten(e.path, 12);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a === undefined || b === undefined) continue;
      const mx = (a.x + b.x) / 2 - g.start.x;
      const my = (a.y + b.y) / 2 - g.start.y;
      const t = Math.min(1, Math.max(0, (mx * ax + my * ay) / len2));
      // 透明度は 1/16 刻みにそろえ、状態の数を抑える。
      const alpha = Math.round((0.15 + 0.85 * t) * opacity * 16) / 16;
      w.alpha(alpha, 1);
      w.op(`${fmt(a.x)} ${fmt(a.y)} m ${fmt(b.x)} ${fmt(b.y)} l S`);
    }
  } else {
    w.alpha(opacity, 1);
    w.path(e.path);
    w.op('S');
  }
  w.op('Q');
  if (e.head !== undefined) {
    w.op('q');
    w.alpha(1, opacity);
    w.op(`${color} rg`);
    w.polygon(e.head);
    w.op('f');
    w.op('Q');
  }
}

function drawText(w: Writer, label: SceneLabel, outline: TextOutliner, bold: boolean): void {
  const run = outline(label.text, label.fontSize, label.direction);
  // 【なぜ】anchor は x が文字列のどちらの端か（物理的な向き）。右端なら、幅の分だけ左へずらす。
  const left = label.anchor === 'left' ? label.x : label.x - run.width;
  const moved = run.commands.map((c): OutlineCommand => {
    switch (c.type) {
      case 'M':
      case 'L':
        return { ...c, x: c.x + left, y: c.y + label.y };
      case 'Q':
        return { ...c, cx: c.cx + left, cy: c.cy + label.y, x: c.x + left, y: c.y + label.y };
      case 'C':
        return {
          ...c,
          c1x: c.c1x + left,
          c1y: c.c1y + label.y,
          c2x: c.c2x + left,
          c2y: c.c2y + label.y,
          x: c.x + left,
          y: c.y + label.y,
        };
      case 'Z':
        return c;
      default:
        return assertNever(c, 'OutlineCommand');
    }
  });
  if (moved.length === 0) return;
  w.path(moved);
  // 【なぜ】太字は、同じ色で細く輪郭を描き足して作る（太字のフォントを別に読み込まない）。
  w.op(bold ? 'B' : 'f');
}

function drawLegendSwatch(w: Writer, s: SceneLegendItem['swatch']): void {
  const color = rgb(s.fill, '#999999');
  switch (s.mark) {
    case 'none':
      return;
    case 'node':
      w.op('q');
      w.op(`${color} rg 0.2 0.2 0.2 RG 1 w`);
      if (s.dashed) setDash(w, true, s.attrMissing === true ? '6 3' : '3 2');
      shapePath(w, s.shape, s.x, s.y, s.r);
      w.op('B');
      w.op('Q');
      return;
    case 'line':
    case 'arrow': {
      const lw = s.lineWidth ?? 1.5;
      const left = s.x - s.r;
      const right = s.x + s.r;
      const headLen = Math.min(Math.max(6, lw * 3), s.r);
      const headHalf = Math.max(3, lw * 1.5);
      const end = s.mark === 'arrow' ? right - headLen : right;
      w.op('q');
      w.op(`${color} RG ${fmt(lw)} w`);
      if (s.dashed) setDash(w, true, s.attrMissing === true ? '9 4' : '4 3');
      w.op(`${fmt(left)} ${fmt(s.y)} m ${fmt(end)} ${fmt(s.y)} l S`);
      w.op('Q');
      if (s.mark === 'arrow') {
        w.op('q');
        w.op(`${color} rg`);
        w.polygon([
          { x: right, y: s.y },
          { x: end, y: s.y + headHalf },
          { x: end, y: s.y - headHalf },
        ]);
        w.op('f');
        w.op('Q');
      }
      return;
    }
    default:
      assertNever(s.mark, 'LegendMark');
  }
}

/**
 * シーンを PDF のページ内容にする。
 *
 * 描く順は SVG と同じ（背景、エッジ、ノード、ラベル、凡例）。
 *
 * @param scene - シーン
 * @param options - 背景と、文字を輪郭にする関数
 * @returns ページの大きさ、コンテンツストリーム、使った透明度の状態
 */
export function renderPdfContent(scene: Scene, options: PdfSceneOptions): PdfContent {
  const w = new Writer();
  const heightPt = scene.height * PX_TO_PT;
  w.op(`${fmt(PX_TO_PT)} 0 0 ${fmt(-PX_TO_PT)} 0 ${fmt(heightPt)} cm`);
  if (options.background !== undefined) {
    w.op(
      `${rgb(options.background, '#ffffff')} rg 0 0 ${fmt(scene.width)} ${fmt(scene.height)} re f`,
    );
  }
  for (const e of scene.edges) drawEdge(w, e);
  for (const n of scene.nodes) drawNode(w, n);
  w.op('0.133 0.133 0.133 rg');
  for (const l of scene.labels) drawText(w, l, options.outline, false);
  if (scene.legend !== undefined) {
    const lg = scene.legend;
    w.op('q');
    w.op(
      `1 1 1 rg 0.8 0.8 0.8 RG 1 w ${fmt(lg.x)} ${fmt(lg.y)} ${fmt(lg.width)} ${fmt(lg.height)} re B`,
    );
    w.op('Q');
    for (const item of lg.items) drawLegendSwatch(w, item.swatch);
    w.op('0.133 0.133 0.133 rg 0.133 0.133 0.133 RG');
    if (lg.title !== undefined) boldText(w, lg.title, options.outline);
    for (const item of lg.items) {
      if (item.bold === true) boldText(w, item.label, options.outline);
      else drawText(w, item.label, options.outline, false);
    }
  }
  return {
    widthPt: scene.width * PX_TO_PT,
    heightPt,
    stream: w.lines.join('\n') + '\n',
    graphicsStates: w.list,
  };
}

function boldText(w: Writer, label: SceneLabel, outline: TextOutliner): void {
  w.op('q');
  w.op(`${fmt(label.fontSize * 0.035)} w`);
  drawText(w, label, outline, true);
  w.op('Q');
}
