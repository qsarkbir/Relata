import { Layer, type LayersList } from '@deck.gl/core';
import { expect, it } from 'vitest';
import { toNodeId } from '../core/model';
import type { SceneEdge } from '../render/scene/types';
import { networkLayers } from './networkLayers';

function dataOf(layers: LayersList, id: string): unknown {
  const layer = layers.find((candidate) => candidate instanceof Layer && candidate.id === id);
  if (!(layer instanceof Layer)) throw new Error(id);
  return layer.props.data;
}

it('FR-VG-12: 欠損した帯は薄い塗りと閉じた破線になり、束の欠損マークは選択中も残る', () => {
  const e: SceneEdge = {
    id: 'ab',
    source: toNodeId('a'),
    target: toNodeId('b'),
    path: [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 20, y: 0 },
    ],
    width: 3,
    color: '#999999',
    opacity: 1,
    directed: true,
    dashed: false,
  };
  const ribbon = [
    { x: 0, y: -2 },
    { x: 20, y: 0 },
    { x: 0, y: 2 },
  ];
  const layers = networkLayers(
    {
      zoom: 0,
      nodes: [],
      edges: [
        e,
        { ...e, id: 'cd', ribbon, dashed: true, attrMissing: true },
        { ...e, id: 'ef', role: 'highlight' },
        { ...e, id: 'ef', role: 'missing', dashed: true, opacity: 0.9 },
      ],
      omitted: {
        nodesWithoutPosition: [],
        edgesWithoutEndpoint: 0,
        selfLoops: 0,
        widthsUnmatched: false,
      },
    },
    { selected: new Set(), selectedEdgeKeys: new Set(['ef']) },
  );
  expect(dataOf(layers, 'map-edge-paths')).toMatchObject([
    { pick: { id: 'ab' } },
    { pick: { id: 'ef' }, color: [25, 25, 25, 255] },
  ]);
  expect(dataOf(layers, 'map-edge-heads-and-tapers')).toMatchObject([
    { pick: { id: 'cd' }, color: [153, 153, 153, 102] },
  ]);
  expect(dataOf(layers, 'map-edge-missing-paths')).toMatchObject([
    {
      pick: { id: 'cd' },
      path: [
        [256, 258],
        [276, 256],
        [256, 254],
        [256, 258],
      ],
      dash: [9, 4],
    },
    { pick: { id: 'ef' }, color: [153, 153, 153, 230], dash: [4, 3] },
  ]);
});
