import Graph from 'graphology';
import { expect, test } from '@playwright/test';
import type { RelataGraph } from '../../src/core/graph';
import { toNodeId, toNodeTypeId } from '../../src/core/model';
import { buildScene } from '../../src/render/scene';
import { renderSvg } from '../../src/render/svg';

for (const labels of ['all', 'selected', 'large'] as const) {
  test(
    'FR-VG-10 / NFR-09: ' + labels + ' の実測幅でラベルを選び RTL の重なりを減らす',
    async ({ page }) => {
      const texts = ['small', 'large', 'محمد'];
      const widths = await page.evaluate((strings) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('canvas');
        context.font = '12px sans-serif';
        return strings.map((text) => context.measureText(text).width);
      }, texts);
      const measured = new Map(texts.map((text, index) => [text, widths[index] ?? 0]));
      const graph: RelataGraph = new Graph();
      const a = toNodeId('a');
      const b = toNodeId('b');
      const c = toNodeId('c');
      const type = toNodeTypeId('person');
      graph.addNode(a, { label: texts[0] ?? '', type });
      graph.addNode(b, { label: texts[1] ?? '', type });
      graph.addNode(c, { label: texts[2] ?? '', type });
      const scene = buildScene(
        graph,
        new Map([
          [a, { x: 0, y: 0 }],
          [b, { x: 0, y: 0 }],
          [c, { x: 0, y: 0 }],
        ]),
        {
          sizes: new Map([
            [a, { size: 3, missing: false }],
            [b, { size: 10, missing: false }],
            [c, { size: 5, missing: false }],
          ]),
        },
        {
          labels,
          largeLabelCount: 2,
          selected: new Set([a]),
          measureText: (text) => measured.get(text) ?? 0,
        },
      );
      await page.setContent(renderSvg(scene));
      expect(await page.locator('#labels text').count()).toBe(labels === 'selected' ? 1 : 2);
      if (labels !== 'selected')
        expect(await page.locator('#labels text[direction="rtl"]').textContent()).toBe('محمد');
      const separate = await page.locator('#labels').evaluate((group) => {
        const boxes = [...group.querySelectorAll<SVGGraphicsElement>('text')].map((text) =>
          text.getBBox(),
        );
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            if (a === undefined || b === undefined) continue;
            if (
              a.x < b.x + b.width &&
              a.x + a.width > b.x &&
              a.y < b.y + b.height &&
              a.y + a.height > b.y
            )
              return false;
          }
        return true;
      });
      expect(separate).toBe(true);
    },
  );
}
