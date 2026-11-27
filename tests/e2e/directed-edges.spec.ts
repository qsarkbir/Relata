import Graph from 'graphology';
import { expect, test } from './fixtures';
import type { RelataGraph } from '../../src/core/graph';
import { toNodeId, toNodeTypeId } from '../../src/core/model';
import { buildScene } from '../../src/render/scene';
import { renderSvg } from '../../src/render/svg';

for (const directedStyle of ['arrow', 'taper', 'gradient'] as const) {
  test(
    'FR-VG-05〜07 / NFR-09: ' + directedStyle + ' の往復・自己ループ・RTL を Chromium で描画する',
    async ({ page }) => {
      const graph: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
      const a = toNodeId('a');
      const b = toNodeId('b');
      const type = toNodeTypeId('person');
      graph.addNode(a, { label: 'محمد', type });
      graph.addNode(b, { label: '東京', type });
      const attrs = { weight: 1, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 };
      graph.addDirectedEdgeWithKey('ab', a, b, attrs);
      graph.addDirectedEdgeWithKey('ba', b, a, attrs);
      graph.addDirectedEdgeWithKey('aa', a, a, attrs);
      const scene = buildScene(
        graph,
        new Map([
          [a, { x: 0, y: 0 }],
          [b, { x: 200, y: 40 }],
        ]),
        {
          widths: new Map([
            ['ab', { width: 8, missing: false }],
            ['ba', { width: 6, missing: false }],
            ['aa', { width: 4, missing: false }],
          ]),
        },
        { directedStyle, measureText: (text) => text.length * 20 },
      );
      await page.setContent(renderSvg(scene, { idPrefix: 'test-' }));
      expect(await page.locator('svg').count()).toBe(1);
      expect(await page.locator('text[direction="rtl"]').textContent()).toBe('محمد');
      const fit = await page.locator('svg').evaluate((svg) => {
        if (!(svg instanceof SVGSVGElement)) return false;
        const box = svg.viewBox.baseVal;
        return [...svg.querySelectorAll<SVGGraphicsElement>('path,polygon,circle,text')].every(
          (item) => {
            const b = item.getBBox();
            const stroke = item.hasAttribute('stroke')
              ? Number(item.getAttribute('stroke-width') ?? '0') / 2
              : 0;
            return (
              b.x - stroke >= -0.01 &&
              b.y - stroke >= -0.01 &&
              b.x + b.width + stroke <= box.width + 0.01 &&
              b.y + b.height + stroke <= box.height + 0.01
            );
          },
        );
      });
      expect(fit).toBe(true);
      if (directedStyle === 'arrow')
        expect(await page.locator('polygon[id$="-head"]').count()).toBe(3);
      if (directedStyle === 'gradient')
        expect(await page.locator('linearGradient').count()).toBe(3);
    },
  );
}

for (const vertical of [false, true]) {
  test(
    'FR-VG-05: 完全な' +
      (vertical ? '垂直' : '水平') +
      '線のuserSpaceOnUse濃淡はepsilonなしで描ける',
    async ({ page }) => {
      const graph: RelataGraph = new Graph({
        type: 'directed',
        multi: false,
        allowSelfLoops: true,
      });
      const a = toNodeId('s');
      const b = toNodeId('t');
      const type = toNodeTypeId('person');
      graph.addNode(a, { label: 's', type });
      graph.addNode(b, { label: 't', type });
      graph.addDirectedEdgeWithKey('st', a, b, {
        weight: 1,
        count: 1,
        edgeIds: [],
        directed: true,
        missingWeightCount: 0,
      });
      const scene = buildScene(
        graph,
        new Map([
          [a, { x: 0, y: 0 }],
          [b, { x: vertical ? 0 : 200, y: vertical ? 200 : 0 }],
        ]),
        {
          widths: new Map([['st', { width: 8, missing: false }]]),
        },
        { directedStyle: 'gradient', labels: 'selected' },
      );
      const gradient = scene.edges[0]?.gradient;
      if (gradient === undefined) throw new Error('gradient');
      await page.setContent(renderSvg(scene));
      const element = page.locator('linearGradient');
      expect(await element.getAttribute(vertical ? 'x1' : 'y1')).toBe(
        await element.getAttribute(vertical ? 'x2' : 'y2'),
      );
      const pixels = await page.evaluate(async ({ start, end }) => {
        const svg = document.querySelector('svg');
        if (svg === null) throw new Error('svg');
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.outerHTML);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(svg.width.baseVal.value);
        canvas.height = Math.ceil(svg.height.baseVal.value);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('canvas');
        context.drawImage(image, 0, 0);
        return [0.25, 0.75].map(
          (t) =>
            context.getImageData(
              Math.round(start.x + (end.x - start.x) * t),
              Math.round(start.y + (end.y - start.y) * t),
              1,
              1,
            ).data[3],
        );
      }, gradient);
      const light = pixels[0];
      const dark = pixels[1];
      if (light === undefined || dark === undefined) throw new Error('pixels');
      expect(light).toBeGreaterThan(0);
      expect(dark).toBeGreaterThan(light + 40);
    },
  );
}
