import { describe, expect, it } from 'vitest';
import {
  checkDataset,
  getAttr,
  makeAttrs,
  parseDataset,
  type AttrValue,
  type Attrs,
  type Dataset,
} from './index';
import { node, sampleDataset } from './fixtures/sampleDataset';

const v: AttrValue = { kind: 'value', value: 'x' };
const tricky = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

describe('attrs の引き方（FR-IN-06、D-19）', () => {
  it.each(tricky)('FR-IN-06: 列名 %s でも、無ければ undefined、あれば値を返す', (key) => {
    expect(getAttr(makeAttrs([]), key)).toBeUndefined();
    const attrs = makeAttrs([[key, v]]);
    expect(getAttr(attrs, key)).toEqual(v);
    // 作ったあとも prototype は壊れていない
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
  });

  it('FR-IN-06: JSON.parse で作った attrs（__proto__ が自分の項目）でも正しく引ける', () => {
    const attrs = JSON.parse(
      '{"__proto__": {"kind":"value","value":"p"}, "a": {"kind":"value","value":1}}',
    ) as Attrs; // 理由: テストで、検査前の JSON を Attrs として扱う
    expect(getAttr(attrs, '__proto__')).toEqual({ kind: 'value', value: 'p' });
    expect(getAttr(attrs, 'a')).toEqual({ kind: 'value', value: 1 });
    expect(getAttr(attrs, 'toString')).toBeUndefined();
  });

  it('FR-IN-06: 同じキーは後の値が勝つ', () => {
    const lost: AttrValue = { kind: 'missing', reason: 'lost' };
    const a = makeAttrs([
      ['k', v],
      ['k', lost],
    ]);
    expect(getAttr(a, 'k')).toEqual(lost);
  });

  it('FR-IN-06: 列名が constructor などの属性も、checkDataset と parseDataset を通る', () => {
    const ds = sampleDataset();
    const withCols: Dataset = {
      ...ds,
      schema: [
        ...ds.schema,
        ...tricky.map((key) => ({
          key,
          label: key,
          appliesTo: 'node' as const,
          valueType: 'string' as const,
        })),
      ],
      nodes: ds.nodes.map((n) =>
        node(n.id, n.type, n.label, {
          ...n,
          attrs: makeAttrs([...Object.entries(n.attrs), ...tricky.map((k) => [k, v] as const)]),
        }),
      ),
    };
    expect(checkDataset(withCols)).toEqual([]);
    const back = parseDataset(JSON.parse(JSON.stringify(withCols)));
    expect(back.ok).toBe(true);
    if (back.ok) {
      const first = back.value.nodes[0];
      expect(first && getAttr(first.attrs, '__proto__')).toEqual(v);
    }
  });

  it('FR-IN-06: schema にない constructor を持つと違反として報告する（継承の項目に惑わされない）', () => {
    const ds = sampleDataset();
    const bad: Dataset = {
      ...ds,
      edges: [],
      nodes: [node('x', ds.nodes[0]?.type, 'x', { attrs: makeAttrs([['constructor', v]]) })],
    };
    expect(checkDataset(bad).map((i) => i.code)).toEqual(['attribute-not-in-schema']);
  });
});
