import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '../graph';
import { toNodeId, toNodeTypeId } from '../model';
import { createLayoutSession, type LayoutJob } from './compute';

const snapshot: GraphSnapshot = {
  options: { type: 'mixed', multi: false, allowSelfLoops: true },
  attributes: {},
  nodes: ['b', 'a', '__proto__'].map((key) => ({
    key,
    attributes: { type: toNodeTypeId(key === 'b' ? 'place' : 'person'), label: key },
  })),
  edges: [
    {
      key: 'e',
      source: 'a',
      target: 'b',
      attributes: { weight: 1, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 },
    },
  ],
};
const job: LayoutJob = { snapshot, options: { kind: 'forceatlas2', seed: 42 } };

describe('FR-VG-01 / NFR-08: レイアウト', () => {
  it('同じ seed は同じ座標、別の seed は別の初期配置になる', () => {
    expect(createLayoutSession(job).step(20)).toEqual(createLayoutSession(job).step(20));
    expect(createLayoutSession(job).step(0)).not.toEqual(
      createLayoutSession({ ...job, options: { ...job.options, seed: 43 } }).step(0),
    );
  });
  it('step の分け方で結果が変わらず、入力グラフを変更しない', () => {
    const before = JSON.stringify(job);
    const session = createLayoutSession(job);
    session.step(7);
    expect(session.step(13)).toEqual(createLayoutSession(job).step(20));
    expect(JSON.stringify(job)).toEqual(before);
  });
  it('固定点は FA2 と円形のどちらでも小数の位置を正確に保持する', () => {
    const point = { id: toNodeId('a'), x: 1.123456789, y: -2.123456789, fixed: true };
    for (const kind of ['forceatlas2', 'circular'] as const) {
      const result = createLayoutSession({
        snapshot,
        options: { kind, seed: 42, positions: [point] },
      }).step(10);
      expect(result.positions.find((p) => p.id === 'a')).toEqual(point);
      expect(result.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
        true,
      );
    }
  });
  it('FR-VG-01 / NFR-08: fixed:false の保存位置は初期位置として使い、反復後は動く', () => {
    const point = { id: toNodeId('a'), x: 100, y: 50, fixed: false };
    const session = createLayoutSession({
      snapshot,
      options: {
        kind: 'forceatlas2',
        seed: 42,
        positions: [
          point,
          { id: toNodeId('b'), x: -10, y: -10, fixed: false },
          { id: toNodeId('__proto__'), x: 0, y: 0, fixed: false },
        ],
      },
    });
    expect(session.step(0).positions.find((p) => p.id === point.id)).toEqual(point);
    const moved = session.step(10).positions.find((p) => p.id === point.id);
    if (moved === undefined) throw new Error('位置が失われました');
    expect(moved.fixed).toBe(false);
    expect([moved.x, moved.y]).not.toEqual([point.x, point.y]);
    expect(Number.isFinite(moved.x) && Number.isFinite(moved.y)).toBe(true);
  });
  it('型ごとに円周へ並べ、挿入順と locale に依存しない', () => {
    const circular = { kind: 'circular', seed: 1 } as const;
    const a = createLayoutSession({ snapshot, options: circular }).step(1);
    const b = createLayoutSession({
      snapshot: { ...snapshot, nodes: [...snapshot.nodes].reverse() },
      options: circular,
    }).step(1);
    expect(a).toEqual(b);
    expect(a.positions.map((p) => p.id)).toEqual(['__proto__', 'a', 'b']);
    for (const point of a.positions)
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10 * Math.sqrt(3));
  });
  it('保存した JSON の座標と seed を固定配置で再現する', () => {
    const result = createLayoutSession(job).step(10);
    const restored = JSON.parse(JSON.stringify(result)) as typeof result; // 理由: 直前の既知の結果の JSON 往復をテストする。
    const fixed = createLayoutSession({ snapshot, options: { ...restored, kind: 'fixed' } }).step(
      100,
    );
    expect(fixed.positions.map(({ x, y, id }) => ({ x, y, id }))).toEqual(
      result.positions.map(({ x, y, id }) => ({ x, y, id })),
    );
    expect(fixed.positions.every((p) => p.fixed)).toBe(true);
  });
  it('空グラフ、孤立点、自己ループ、重みゼロも有限の座標を返す', () => {
    for (const graph of [
      { ...snapshot, nodes: [], edges: [] },
      { ...snapshot, edges: [] },
      {
        ...snapshot,
        edges: [
          {
            ...snapshot.edges[0],
            key: 'loop',
            source: 'a',
            target: 'a',
            attributes: { weight: 0, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 },
          },
        ],
      },
    ]) {
      expect(
        createLayoutSession({ ...job, snapshot: graph })
          .step(5)
          .positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ).toBe(true);
    }
  });
  it('不正な seed、設定、座標、回数、欠けた固定配置を拒む', () => {
    for (const seed of [-1, NaN, 1.5, 2 ** 32])
      expect(() => createLayoutSession({ ...job, options: { kind: 'circular', seed } })).toThrow(
        RangeError,
      );
    for (const slowDown of [0, -1, NaN, Infinity])
      expect(() =>
        createLayoutSession({ ...job, options: { ...job.options, settings: { slowDown } } }),
      ).toThrow(RangeError);
    expect(() => createLayoutSession({ ...job, options: { kind: 'fixed', seed: 1 } })).toThrow(
      RangeError,
    );
    expect(() =>
      createLayoutSession({
        ...job,
        options: {
          ...job.options,
          positions: [{ id: toNodeId('a'), x: Infinity, y: 0, fixed: true }],
        },
      }),
    ).toThrow(RangeError);
    for (const n of [-1, 0.5, Infinity, 10001])
      expect(() => createLayoutSession(job).step(n)).toThrow(RangeError);
  });
});
