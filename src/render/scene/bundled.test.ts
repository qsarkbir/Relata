import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId, type NodeId } from '../../core/model';
import { buildBundleGraph } from '../bundling/bundleGraph';
import type { BundledPath } from '../bundling/settings';
import { renderSvg } from '../svg/render';
import { buildScene, shapeExtent } from './build';
import { bundleLegendSamples, resolveBundleWidthScale, type SceneBundling } from './bundled';
import { markOutOfTime } from './timeFade';
import type { Scene, SceneBundleRibbon } from './types';

const person = toNodeTypeId('person');

/** [id, x1, y1, x2, y2, directed, weight]。端点ごとに別のノード（`${id}:s`、`${id}:t`）を作る。 */
type Spec = readonly [string, number, number, number, number, boolean, number];

function line(spec: Spec): BundledPath {
  const [id, x1, y1, x2, y2, directed] = spec;
  const points: number[] = [];
  for (let i = 0; i <= 8; i++) points.push(x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8);
  return { id, points, bundled: true, directed };
}

function fixture(specs: readonly Spec[], epsilon = 5) {
  const graph: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
  const positions = new Map<NodeId, { x: number; y: number }>();
  for (const [id, x1, y1, x2, y2, directed, weight] of specs) {
    graph.addNode(`${id}:s`, { label: '', type: person });
    graph.addNode(`${id}:t`, { label: '', type: person });
    positions.set(toNodeId(`${id}:s`), { x: x1, y: y1 });
    positions.set(toNodeId(`${id}:t`), { x: x2, y: y2 });
    graph.addEdgeWithKey(id, `${id}:s`, `${id}:t`, {
      weight,
      count: 1,
      edgeIds: [],
      directed,
      missingWeightCount: 0,
    });
  }
  const paths = specs.map(line);
  const bundleGraph = buildBundleGraph(
    paths,
    specs.map((s) => ({ id: s[0], weight: s[6] })),
    { epsilon },
  );
  const bundled: SceneBundling = { paths, graph: bundleGraph };
  return { graph, positions, paths, bundled };
}

// リボン 1 つの、中ほどの太さ（px）と中心の位置。多角形は「左側の列 + 右側の列の逆順」。
function mid(r: SceneBundleRibbon): { thickness: number; cx: number; cy: number } {
  const n = r.polygon.length / 2;
  const i = Math.floor(n / 2);
  const a = r.polygon[i];
  const b = r.polygon[2 * n - 1 - i];
  if (a === undefined || b === undefined) throw new Error('polygon');
  return {
    thickness: Math.hypot(a.x - b.x, a.y - b.y),
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}
function ribbonOf(scene: Scene, id: string): SceneBundleRibbon {
  const r = scene.bundle?.ribbons.find((x) => x.edgeId === id);
  if (r === undefined) throw new Error(`ribbon ${id} が無い`);
  return r;
}

const far: readonly Spec[] = [
  ['a', 0, 0, 1000, 0, false, 1],
  ['b', 0, 500, 1000, 500, false, 4],
];

describe('FR-VG-14: 帯の太さ', () => {
  it('既定は平方根: 幅は W の平方根に比例し、最大の W が最大の幅になる', () => {
    const f = fixture(far);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    expect(scene.bundle?.style).toBe('bands');
    expect(scene.bundle?.widthScale.kind).toBe('sqrt');
    const a = mid(ribbonOf(scene, 'a')).thickness;
    const b = mid(ribbonOf(scene, 'b')).thickness;
    expect(b).toBeCloseTo(14, 6); // W = 4 = 最大
    expect(a).toBeCloseTo(7, 6); // sqrt(1/4) × 14
    expect(b / a).toBeCloseTo(Math.sqrt(4 / 1), 6);
  });

  it('スケールを線形にすると、幅は W に比例する', () => {
    const f = fixture(far);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, scale: 'linear' } },
    );
    expect(mid(ribbonOf(scene, 'a')).thickness).toBeCloseTo(3.5, 6);
  });

  it('FR-VG-13: ズームで太さ（px）は変わらず、位置だけが変わる', () => {
    const f = fixture(far);
    const small = buildScene(f.graph, f.positions, {}, { zoom: 0.05, bundled: f.bundled });
    const big = buildScene(f.graph, f.positions, {}, { zoom: 0.4, bundled: f.bundled });
    expect(mid(ribbonOf(small, 'b')).thickness).toBeCloseTo(mid(ribbonOf(big, 'b')).thickness, 6);
    expect(big.width).toBeGreaterThan(small.width * 4);
  });

  it('幅の下限: W が小さい束も minWidth 以上で描く。W が 0 の束は描かない', () => {
    const f = fixture([
      ['a', 0, 0, 1000, 0, false, 0.0001],
      ['b', 0, 500, 1000, 500, false, 100],
    ]);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    expect(mid(ribbonOf(scene, 'a')).thickness).toBeCloseTo(1, 6);
    const zero = buildScene(
      f.graph,
      f.positions,
      {},
      {
        zoom: 0.1,
        bundled: { ...f.bundled, weights: new Float64Array(f.bundled.graph.bundleCount) },
      },
    );
    expect(zero.bundle?.ribbons).toEqual([]);
    // 帯として描いたエッジは、通常のエッジとしては描かない（二重に描かない）。
    expect(zero.edges).toEqual([]);
  });

  it('再生: weightsFor 相当の W を渡すと幅が変わり、目盛りの最大（全期間）は動かない', () => {
    const f = fixture(far);
    const w = Float64Array.from(f.bundled.graph.weight);
    w.fill(1);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, weights: w } },
    );
    expect(mid(ribbonOf(scene, 'b')).thickness).toBeCloseTo(7, 6); // sqrt(1/4) × 14
    expect(scene.bundle?.widthScale.maxWeight).toBe(4);
  });

  it('凡例の見本は、図と同じスケールで幅を出す', () => {
    const f = fixture(far);
    const scale = resolveBundleWidthScale(f.bundled);
    const samples = bundleLegendSamples(scale);
    expect(samples.map((s) => s.weight)).toEqual([4, 1, 0.25]);
    expect(samples[0]?.width).toBeCloseTo(14, 6);
    expect(samples[1]?.width).toBeCloseTo(7, 6);
    expect(samples[2]?.width).toBeCloseTo(3.5, 6);
  });
});

describe('FR-VG-13: 向きと往復', () => {
  const pair: readonly Spec[] = [
    ['f', 0, 0, 1000, 0, true, 4],
    ['r', 1000, 1, 0, 1, true, 4],
  ];

  it('逆向きの束は、それぞれ進行方向の右へずれ、帯どうしが重ならない', () => {
    const f = fixture(pair);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, directedStyle: 'taper', bundled: f.bundled },
    );
    const fw = mid(ribbonOf(scene, 'f'));
    const rv = mid(ribbonOf(scene, 'r'));
    // f は東向き（右 = 南 = y が大きい側）、r は西向き（右 = 北）。
    expect(fw.cy).toBeGreaterThan(rv.cy);
    // 中心の間隔は、半幅の和 + すき間 1 px（元の位置の差 0.1 px を除く）。
    expect(fw.cy - rv.cy).toBeCloseTo(14 + 1 - 0.1, 3);
    expect(fw.cy - rv.cy).toBeGreaterThan(fw.thickness / 2 + rv.thickness / 2);
  });

  it('逆向きの束が無ければ、ずらさない（中心線はそのまま）', () => {
    const f = fixture([['f', 0, 0, 1000, 0, true, 4]]);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    const m = mid(ribbonOf(scene, 'f'));
    const src = scene.nodes.find((n) => n.id === 'f:s');
    expect(m.cy).toBeCloseTo(src?.y ?? NaN, 6);
  });

  it('矢印: 矢じりの先はノードの縁に止まり、大きさは自身の幅に比例する', () => {
    const f = fixture([
      ['a', 0, 0, 1000, 0, true, 1],
      ['b', 0, 500, 1000, 500, true, 4],
    ]);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, directedStyle: 'arrow', bundled: f.bundled },
    );
    const sizes = (id: string) => {
      const head = ribbonOf(scene, id).head;
      const node = scene.nodes.find((n) => n.id === `${id}:t`);
      if (head === undefined || node === undefined) throw new Error('head');
      const [tip, p, q] = head;
      if (tip === undefined || p === undefined || q === undefined) throw new Error('head');
      expect(Math.hypot(tip.x - node.x, tip.y - node.y)).toBeCloseTo(
        shapeExtent(node.shape, node.r) + node.strokeWidth / 2,
        6,
      );
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    // 幅 7 と 14。矢じりの底辺 = 2 × min(max(3, 1.5w), 0.7 × 長さ) で、w が大きい方が大きい。
    expect(sizes('b')).toBeGreaterThan(sizes('a'));
  });

  it('先細り: 終端の幅は 0 になり、無向は両端とも一定の幅', () => {
    const f = fixture([
      ['d', 0, 0, 1000, 0, true, 4],
      ['u', 0, 500, 1000, 500, false, 4],
    ]);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, directedStyle: 'taper', bundled: f.bundled },
    );
    const d = ribbonOf(scene, 'd').polygon;
    const u = ribbonOf(scene, 'u').polygon;
    const n = d.length / 2;
    // 先端（最後の列）の左右の点がほぼ一致する。
    expect(
      Math.hypot((d[n - 1]?.x ?? 0) - (d[n]?.x ?? 1e9), (d[n - 1]?.y ?? 0) - (d[n]?.y ?? 1e9)),
    ).toBeLessThan(1e-6);
    // 無向: 始点と終点の幅が同じ。
    const m = u.length / 2;
    const w0 = Math.hypot(
      (u[0]?.x ?? 0) - (u[2 * m - 1]?.x ?? 0),
      (u[0]?.y ?? 0) - (u[2 * m - 1]?.y ?? 0),
    );
    const w1 = Math.hypot((u[m - 1]?.x ?? 0) - (u[m]?.x ?? 0), (u[m - 1]?.y ?? 0) - (u[m]?.y ?? 0));
    expect(w0).toBeCloseTo(w1, 6);
    expect(w0).toBeGreaterThan(10);
  });
});

describe('FR-VG-13: 簡易版（overlay）', () => {
  it('各エッジを自分の重みの太さの半透明の線で描き、帯は作らない', () => {
    const f = fixture(far);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, style: 'overlay' } },
    );
    expect(scene.bundle?.ribbons).toEqual([]);
    expect(scene.edges.map((e) => e.role)).toEqual(['overlay', 'overlay']);
    const a = scene.edges.find((e) => e.id === 'a');
    const b = scene.edges.find((e) => e.id === 'b');
    expect(a?.opacity).toBeCloseTo(0.3, 6);
    // 割り当てが無いときは、束ねないときと同じ既定の幅 1.5 px（束のスケールではない）。
    expect(a?.width).toBeCloseTo(1.5, 6);
    expect(b?.width).toBeCloseTo(1.5, 6);
    expect(a?.path[0]?.type).toBe('M');
    expect(a?.path.length).toBeGreaterThan(5); // 束ねた折れ線のまま
  });
});

describe('FR-VG-13: 選択・欠損・薄れ', () => {
  const specs: readonly Spec[] = [
    ['a', 0, 0, 1000, 0, false, 1],
    ['b', 0, 500, 1000, 500, false, 4],
  ];
  it('選んだノードのエッジは、帯の上に細い線で強調する（含めない指定では出さない）', () => {
    const f = fixture(specs);
    const sel = new Set([toNodeId('a:s')]);
    const on = buildScene(
      f.graph,
      f.positions,
      {},
      { bundled: f.bundled, selected: sel, includeSelection: true },
    );
    expect(on.edges.map((e) => [e.id, e.role])).toEqual([['a', 'highlight']]);
    expect(on.bundle?.ribbons).toHaveLength(2);
    const off = buildScene(f.graph, f.positions, {}, { bundled: f.bundled, selected: sel });
    expect(off.edges).toEqual([]);
  });

  it('欠損のエッジは、帯の上に破線を引く（attrMissing は間隔を変える印）', () => {
    const f = fixture(specs);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { bundled: f.bundled, missingEdges: new Set(['b']) },
    );
    const e = scene.edges[0];
    expect(scene.edges).toHaveLength(1);
    expect(e).toMatchObject({ id: 'b', role: 'missing', dashed: true, attrMissing: true });
  });

  it('時刻の外のエッジのリボンは faded になり、SVG では別の層に分かれる', () => {
    const f = fixture(specs);
    const base = buildScene(f.graph, f.positions, {}, { bundled: f.bundled });
    const scene = markOutOfTime(base, new Set(), new Set(['a']));
    expect(ribbonOf(scene, 'a').faded).toBe(true);
    expect(ribbonOf(scene, 'b').faded).toBeUndefined();
    const svg = renderSvg(scene);
    expect(svg.indexOf('id="bundles-faded"')).toBeGreaterThan(-1);
    expect(svg.indexOf('id="bundles-faded"')).toBeLessThan(svg.indexOf('id="bundles"'));
    expect(svg).toContain('opacity="0.12"'); // 0.6 × 0.2
  });
});

describe('FR-VG-13: 入口（束ねた結果が無ければ今まで通り）', () => {
  it('bundled を渡さなければ、通常のエッジで、bundle は無い', () => {
    const f = fixture(far);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1 });
    expect(scene.bundle).toBeUndefined();
    expect(scene.edges).toHaveLength(2);
  });

  it('束ねていない経路（自己ループなど）と、経路に無いエッジは、通常のエッジとして描く', () => {
    const f = fixture(far);
    const paths = f.paths.map((p) => (p.id === 'a' ? { ...p, bundled: false } : p));
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, paths: paths.filter((p) => p.id !== 'zzz') } },
    );
    expect(scene.edges.map((e) => e.id)).toEqual(['a']);
    expect(scene.edges[0]?.role).toBeUndefined();
    expect(scene.bundle?.ribbons.map((r) => r.edgeId)).toEqual(['b']);
  });

  it('決定的: 経路の並びが違っても、同じシーンになる', () => {
    const f = fixture(far);
    const one = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    const two = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, paths: [...f.paths].reverse() } },
    );
    expect(two).toEqual(one);
    expect(renderSvg(two)).toBe(renderSvg(one));
  });
});

describe('FR-VG-13: SVG の構造', () => {
  it('bundles、edges、nodes の順に <g> があり、リボンは不透明で、層に 1 回だけ opacity を掛ける', () => {
    const f = fixture(far);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    const svg = renderSvg(scene, { idPrefix: 'fig-' });
    const order = ['fig-bundles', 'fig-edges', 'fig-nodes', 'fig-labels'].map((g) =>
      svg.indexOf(`<g id="${g}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(svg).toContain('<g id="fig-bundles" fill="#999999" opacity="0.6">');
    expect(
      svg.match(/<polygon id="fig-bundle-\d+" data-id="[^"]*" points="[^"]+"\/>/g),
    ).toHaveLength(2);
    // リボンの polygon には fill-opacity を付けない（層でまとめて掛ける）。
    const layer = svg.slice(svg.indexOf('<g id="fig-bundles"'), svg.indexOf('<g id="fig-edges"'));
    expect(layer).not.toContain('fill-opacity');
    // 入れ子は 1 段（<g> の中に <g> を作らない）。
    expect(layer.match(/<g /g)).toHaveLength(1);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('エッジの ID の特殊文字はエスケープされる', () => {
    const f = fixture([['a"<&', 0, 0, 1000, 0, false, 1]]);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    const svg = renderSvg(scene);
    expect(svg).toContain('data-id="a&quot;&lt;&amp;"');
    expect(svg).not.toContain('data-id="a"<');
  });

  it('簡易版は edges の中に data-bundle-role="overlay" の線が並び、bundles の層は無い', () => {
    const f = fixture(far);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, style: 'overlay' } },
    );
    const svg = renderSvg(scene);
    expect(svg).not.toContain('id="bundles"');
    expect(svg.match(/data-bundle-role="overlay"/g)).toHaveLength(2);
  });

  it('スナップショット（補助）: 最小の帯の SVG', () => {
    const f = fixture([['a', 0, 0, 100, 0, false, 1]]);
    const scene = buildScene(f.graph, f.positions, {}, { bundled: f.bundled, margin: 10 });
    expect(renderSvg(scene).split('\n').slice(0, 3).join('\n')).toMatchInlineSnapshot(`
      "<svg xmlns="http://www.w3.org/2000/svg" width="133" height="34" viewBox="0 0 133 34" font-family="sans-serif">
      <g id="bundles" fill="#999999" opacity="0.6">
      <polygon id="bundle-0" data-id="a" points="23,10 29,10 41.5,10 54,10 66.5,10 79,10 91.5,10 104,10 110,10 110,24 104,24 91.5,24 79,24 66.5,24 54,24 41.5,24 29,24 23,24"/>"
    `);
  });
});

describe('FR-VG-13: 無向の車線・幅のなめらかなつなぎ・往復の条件', () => {
  it('無向のエッジも、有向の束の車線に従ってずれる（先細りは付けない）', () => {
    const f = fixture([
      ['f', 0, 0, 1000, 0, true, 4],
      ['u', 0, 1, 1000, 1, false, 4],
      ['r', 1000, 2, 0, 2, true, 4],
    ]);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, directedStyle: 'taper', bundled: f.bundled },
    );
    const hasOpp = f.bundled.graph.opposites.size > 0;
    if (hasOpp) expect(mid(ribbonOf(scene, 'u')).cy).toBeGreaterThan(mid(ribbonOf(scene, 'r')).cy);
    const u = ribbonOf(scene, 'u').polygon;
    const m = u.length / 2;
    const w0 = Math.hypot(
      (u[0]?.x ?? 0) - (u[2 * m - 1]?.x ?? 0),
      (u[0]?.y ?? 0) - (u[2 * m - 1]?.y ?? 0),
    );
    const w1 = Math.hypot((u[m - 1]?.x ?? 0) - (u[m]?.x ?? 0), (u[m - 1]?.y ?? 0) - (u[m]?.y ?? 0));
    expect(w1).toBeCloseTo(w0, 6);
  });

  it('W が区間ごとに上下しても、帯の幅は移動平均でなめらかにつながる', () => {
    const f = fixture([['a', 0, 0, 1000, 0, false, 4]]);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      {
        zoom: 0.1,
        bundled: {
          ...f.bundled,
          weights: new Float64Array(f.bundled.graph.bundleCount).map((_, i) =>
            i % 2 === 0 ? 4 : 0.25,
          ),
        },
      },
    );
    const p = ribbonOf(scene, 'a').polygon;
    const n = p.length / 2;
    const th = Array.from({ length: n }, (_, i) =>
      Math.hypot(
        (p[i]?.x ?? 0) - (p[2 * n - 1 - i]?.x ?? 0),
        (p[i]?.y ?? 0) - (p[2 * n - 1 - i]?.y ?? 0),
      ),
    );
    const maxStep = Math.max(...th.slice(1).map((t, i) => Math.abs(t - (th[i] ?? 0))));
    expect(maxStep).toBeLessThan(14 - 3.5); // 生の段差（10.5）より小さい
  });

  it('往路だけの束に、ごく小さな逆向きの束が重なるときは、ずらさない', () => {
    const f = fixture([
      ['f', 0, 0, 1000, 0, true, 100],
      ['r', 1000, 1, 0, 1, true, 1],
    ]);
    const scene = buildScene(f.graph, f.positions, {}, { zoom: 0.1, bundled: f.bundled });
    const src = scene.nodes.find((n) => n.id === 'f:s');
    expect(mid(ribbonOf(scene, 'f')).cy).toBeCloseTo(src?.y ?? NaN, 6);
  });
});

describe('FR-VG-13: レビューの修正', () => {
  const specs: readonly Spec[] = [
    ['a', 0, 0, 1000, 0, false, 1],
    ['b', 0, 500, 1000, 500, false, 4],
  ];
  it('簡易版の線の太さは、割り当ての widths（束ねないときと同じ幅）で決まる', () => {
    const f = fixture(specs);
    const widths = new Map([
      ['a', { width: 0.5, missing: false }],
      ['b', { width: 2.5, missing: false }],
    ]);
    const scene = buildScene(
      f.graph,
      f.positions,
      { widths },
      { zoom: 0.1, bundled: { ...f.bundled, style: 'overlay' } },
    );
    expect(scene.edges.find((e) => e.id === 'a')?.width).toBeCloseTo(0.5, 6);
    expect(scene.edges.find((e) => e.id === 'b')?.width).toBeCloseTo(2.5, 6);
  });

  it('W が 0 の区間へ、移動平均で幅がはみ出さない', () => {
    const f = fixture(specs);
    const bg = f.bundled.graph;
    const w = Float64Array.from(bg.weight);
    // a の前半の区間の束だけ W を残し、後半の束は 0 にする。
    const segs = Array.from(
      bg.segmentBundle.subarray(bg.segmentStart[0] ?? 0, bg.segmentStart[1] ?? 0),
    );
    segs.forEach((b, k) => {
      if (k >= 4) w[b] = 0;
    });
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, bundled: { ...f.bundled, weights: w } },
    );
    const p = ribbonOf(scene, 'a').polygon;
    const n = p.length / 2;
    for (let i = 5; i < n; i++) {
      const d = Math.hypot(
        (p[i]?.x ?? 0) - (p[2 * n - 1 - i]?.x ?? 0),
        (p[i]?.y ?? 0) - (p[2 * n - 1 - i]?.y ?? 0),
      );
      expect(d).toBeLessThan(1e-6);
    }
  });

  it('選んだエッジは、帯の上に highlight の細い線で強調する（含めない指定では出さない）', () => {
    const f = fixture(specs);
    const on = buildScene(
      f.graph,
      f.positions,
      {},
      { bundled: f.bundled, selectedEdgeKeys: new Set(['b']), includeSelection: true },
    );
    expect(on.edges.map((e) => [e.id, e.role])).toEqual([['b', 'highlight']]);
    const off = buildScene(
      f.graph,
      f.positions,
      {},
      { bundled: f.bundled, selectedEdgeKeys: new Set(['b']) },
    );
    expect(off.edges).toEqual([]);
  });

  it('矢じりの polygon にも、エッジのキーの data-id が付く', () => {
    const f = fixture([['a', 0, 0, 1000, 0, true, 1]]);
    const scene = buildScene(
      f.graph,
      f.positions,
      {},
      { zoom: 0.1, directedStyle: 'arrow', bundled: f.bundled },
    );
    expect(renderSvg(scene)).toMatch(/<polygon id="bundle-0-head" data-id="a" /);
  });
});
