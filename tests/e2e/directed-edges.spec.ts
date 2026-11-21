import Graph from 'graphology';
import { expect, test } from '@playwright/test';
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
