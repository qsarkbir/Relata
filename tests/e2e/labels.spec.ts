import Graph from 'graphology';
import { expect, test } from './fixtures';
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

test('FR-VG-10 / NFR-09 / FR-OUT-01: BiDi混在と補助面文字でも物理アンカー・非衝突・viewBoxを保つ', async ({
  page,
}) => {
  const texts = ['محمد ABC 1234567890', 'ABC محمد بن علي', 'محمد (東京 123)', '😀𠀋 CJK محمد'];
  const widths = await page.evaluate((strings) => {
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('canvas');
    context.font = '12px sans-serif';
    return strings.map((text) => context.measureText(text).width);
  }, texts);
  const measured = new Map(texts.map((text, i) => [text, widths[i] ?? 0]));
  const graph: RelataGraph = new Graph();
  const positions = new Map<ReturnType<typeof toNodeId>, { x: number; y: number }>();
  for (const [i, text] of texts.entries()) {
    const id = toNodeId(String(i));
    graph.addNode(id, { label: text, type: toNodeTypeId('person') });
    positions.set(id, { x: i * 400, y: 0 });
  }
  const scene = buildScene(
    graph,
    positions,
    {},
    { measureText: (text) => measured.get(text) ?? 0 },
  );
  expect(scene.labels).toHaveLength(4);
  await page.setContent(renderSvg(scene));
  const actual = await page.locator('#labels text').evaluateAll((elements) =>
    elements.map((element) => {
      if (!(element instanceof SVGTextElement)) throw new Error('text');
      const box = element.getBBox();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        length: element.getComputedTextLength(),
      };
    }),
  );
  for (const [i, box] of actual.entries()) {
    const label = scene.labels[i];
    if (label === undefined) throw new Error('label');
    const expectedLeft = label.anchor === 'right' ? label.x - box.length : label.x;
    // グリフのインクはadvance幅より少し張り出すため、衝突判定と同じ2pxの許容にする。
    expect(Math.abs(box.x - expectedLeft)).toBeLessThanOrEqual(2);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(scene.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(scene.height);
    for (const other of actual.slice(i + 1))
      expect(box.x + box.width <= other.x || other.x + other.width <= box.x).toBe(true);
  }
});
