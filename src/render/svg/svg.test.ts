import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId, type NodeId } from '../../core/model';
import { buildScene } from '../scene';
import { escapeXml, renderSvg, safeColor } from './index';
import { num } from './escape';

const t = toNodeTypeId('person');
const id = (s: string): NodeId => toNodeId(s);

function oneGraph(nodes: [string, string][], edges: [string, string, string][] = []): RelataGraph {
  const g: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
  for (const [n, label] of nodes) g.addNode(n, { label, type: t });
  for (const [k, s, d] of edges)
    g.addEdgeWithKey(k, s, d, {
      weight: 1,
      count: 1,
      edgeIds: [],
      directed: false,
      missingWeightCount: 0,
    });
  return g;
}

// 簡単な XML の検査: タグの入れ子が閉じていて、属性値に生の < や & が無い。
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const between = xml.slice(pos, m.index);
    // タグの外のテキストに、生の < や、実体参照でない & が無い
    expect(between).not.toMatch(/<|&(?!(amp|lt|gt|quot|#39);)/);
    pos = m.index + m[0].length;
    const [, close, name, , self] = m;
    if (self === '/') continue;
    if (close === '/') expect(stack.pop()).toBe(name);
    else stack.push(name ?? '');
  }
  expect(xml.slice(pos).trim()).toBe('');
  expect(stack).toEqual([]);
}

function sceneOf(g: RelataGraph) {
  const pos = new Map<NodeId, { x: number; y: number }>();
  g.forEachNode((k) => {
    pos.set(k as NodeId, { x: pos.size * 60, y: pos.size % 2 ? 40 : 0 });
  });
  return buildScene(g, pos, {}, { measureText: (s) => s.length * 8 });
}

describe('FR-OUT-01: SVG の構造', () => {
  const g = oneGraph(
    [
      ['a', 'A'],
      ['b', 'ابن الأثير'],
    ],
    [['e1', 'a', 'b']],
  );
  const svg = renderSvg(sceneOf(g), { background: '#ffffff', title: 'テスト' });
  it('XML として壊れていない', () => {
    assertWellFormed(svg);
  });
  it('edges、nodes、labels の順に <g> があり、入れ子は 1 段だけ', () => {
    const order = ['id="edges"', 'id="nodes"', 'id="labels"'].map((s) => svg.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // <g> が <g> の中に入らない
    let depth = 0;
    let max = 0;
    for (const m of svg.matchAll(/<(\/?)g[\s>]/g)) {
      depth += m[1] === '/' ? -1 : 1;
      max = Math.max(max, depth);
    }
    expect(max).toBe(1);
    expect(depth).toBe(0);
  });
  it('ノードとエッジとラベルが、図形として 1 つずつ並ぶ', () => {
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.match(/<text /g)).toHaveLength(2);
  });
  it('4 つの形を描く', () => {
    const g2 = oneGraph([['a', 'A']]);
    const sc = buildScene(g2, new Map([[id('a'), { x: 0, y: 0 }]]));
    for (const [shape, tag] of [
      ['circle', '<circle'],
      ['square', '<rect'],
      ['triangle', '<polygon'],
      ['diamond', '<polygon'],
    ] as const) {
      const s = renderSvg({ ...sc, nodes: sc.nodes.map((n) => ({ ...n, shape })) });
      expect(s).toContain(tag);
      assertWellFormed(s);
    }
  });
  it('凡例があれば <g id="legend"> に入る', () => {
    const sc = buildScene(
      g,
      new Map([
        [id('a'), { x: 0, y: 0 }],
        [id('b'), { x: 50, y: 0 }],
      ]),
      {},
      {
        legend: {
          title: 'Type',
          items: [
            { label: 'person', fill: '#e69f00', shape: 'square' },
            { label: 'مكان', fill: '#0072b2' },
          ],
        },
      },
    );
    const s = renderSvg(sc);
    assertWellFormed(s);
    expect(s).toContain('id="legend"');
    expect(sc.legend?.x).toBeGreaterThan(50);
    expect(s).toMatch(/direction="rtl"[^>]*>مكان</);
  });
});

describe('FR-OUT-01: エスケープと色の検証', () => {
  it('ラベルの <script> と引用符が無害になる', () => {
    const g = oneGraph([['a', '<script>alert("x")</script> & \'q\'']]);
    const svg = renderSvg(sceneOf(g));
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;');
    assertWellFormed(svg);
  });
  it('ID に " や <、__proto__ があっても属性が壊れない', () => {
    const g = oneGraph(
      [
        ['__proto__', 'p'],
        ['x"onload="alert(1)', 'q'],
        ['<b>', 'r'],
      ],
      [['e"<', '__proto__', '<b>']],
    );
    const svg = renderSvg(sceneOf(g));
    assertWellFormed(svg);
    expect(svg).toContain('data-id="__proto__"');
    expect(svg).toContain('data-id="x&quot;onload=&quot;alert(1)"');
    expect(svg).not.toMatch(/ onload="/);
  });
  it('制御文字と XML で使えない文字を除く', () => {
    expect(escapeXml('a\u0000b\u0008c\u001fd\ud800e')).toBe('abcde');
    expect(escapeXml('a\nb\tc')).toBe('a b c');
    expect(escapeXml('😀')).toBe('😀');
  });
  it('不正な色は既定の色に替わる', () => {
    expect(safeColor('red', '#999999')).toBe('#999999');
    expect(safeColor('#12345', '#999999')).toBe('#999999');
    expect(safeColor('#ABCDEF', '#999999')).toBe('#abcdef');
    const g = oneGraph([['a', 'A']]);
    const sc = buildScene(g, new Map([[id('a'), { x: 0, y: 0 }]]));
    const bad = {
      ...sc,
      nodes: sc.nodes.map((n) => ({ ...n, fill: '" onload="x', stroke: 'url(#a)' })),
    };
    const svg = renderSvg(bad, { background: 'javascript:1' });
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('javascript');
    expect(svg).not.toContain('url(');
    assertWellFormed(svg);
  });
});

describe('FR-OUT-01: idPrefix', () => {
  it('すべての id に接頭辞が付き、エスケープされる', () => {
    const g = oneGraph(
      [
        ['a', 'A'],
        ['b', 'B'],
      ],
      [['e', 'a', 'b']],
    );
    const svg = renderSvg(sceneOf(g), { idPrefix: 'f1"-', background: '#ffffff' });
    const ids = [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(ids.length).toBeGreaterThan(5);
    for (const i of ids) expect(i.startsWith('f1&quot;-')).toBe(true);
    assertWellFormed(svg);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('数値は有限で出力される', () => {
    expect(num(1e308 * 10)).toBe('0');
    expect(num(-0.0001)).toBe('0');
  });
});

describe('NFR-09: 右から左のラベルの SVG', () => {
  it('アラビア文字とヘブライ文字に direction=rtl と text-anchor=end、他には付けない', () => {
    const g = oneGraph([
      ['a', 'ابن الأثير'],
      ['b', 'שלום'],
      ['c', '源頼朝'],
      ['d', 'Ibn'],
      ['e', '123'],
      ['f', ''],
    ]);
    const svg = renderSvg(sceneOf(g));
    const sc = sceneOf(g);
    // ラベルは右端が x で、文字はノードの左側に収まる
    const first = sc.labels[0];
    expect(first?.anchor).toBe('right');
    expect((first?.x ?? 0) - 'ابن الأثير'.length * 8).toBeGreaterThanOrEqual(0);
    expect(first?.x).toBeLessThan(sc.nodes[0]?.x ?? 0);
    const texts = svg.match(/<text [^>]*>[^<]*<\/text>/g) ?? [];
    expect(texts).toHaveLength(5); // 空のラベルは出さない
    const rtl = texts.filter((s) => s.includes('direction="rtl"'));
    expect(rtl).toHaveLength(2);
    // direction=rtl では text-anchor=start が右端。x がノードの左側の右端なので、文字はノードの左に収まる
    for (const s of rtl) {
      expect(s).toContain('unicode-bidi="embed"');
      expect(s).toContain('text-anchor="start"');
    }
    for (const s of texts.filter((s) => !s.includes('rtl')))
      expect(s).toContain('text-anchor="start"');
    assertWellFormed(svg);
  });
});

describe('FR-OUT-01: フォントの一覧', () => {
  // 【なぜ】属性値の中の ' と " は実体参照になるが、XML として読むと元に戻る。
  //       戻した値が、測定（canvas の font）に渡した一覧と同じであることを確かめる。
  const decode = (v: string): string =>
    v
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  it.each(['Amiri, serif', "'Times New Roman', serif", '"Noto Naskh Arabic", sans-serif'])(
    '%s: 測定と SVG の font-family が同じ一覧になる',
    (family) => {
      const fonts: string[] = [];
      const g = oneGraph([['a', 'ابن عسكر']]);
      const scene = buildScene(
        g,
        new Map([[id('a'), { x: 0, y: 0 }]]),
        {},
        {
          fontFamily: family,
          measureText: (s, f) => {
            fonts.push(f);
            return s.length * 8;
          },
        },
      );
      const svg = renderSvg(scene);
      assertWellFormed(svg);
      expect(fonts).toEqual([`12px ${family}`]);
      const attr = /<svg [^>]*font-family="([^"]*)"/.exec(svg)?.[1];
      expect(attr).toBeDefined();
      expect(decode(attr ?? '')).toBe(family);
    },
  );
});
