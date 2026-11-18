import { describe, expect, it } from 'vitest';
import {
  isValidId,
  makeNodeIdFromTypeAndKey,
  makeNodeIdFromTypeAndLabel,
  parseNodeId,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type EdgeId,
  type NodeId,
} from './index';

describe('ID の作成（FR-DM-01）', () => {
  it('FR-DM-01: 文字列がそのまま ID になる', () => {
    expect(toNodeId('n1')).toBe('n1');
    expect(toEdgeId('e1')).toBe('e1');
    expect(toNodeTypeId('person')).toBe('person');
  });

  it('FR-DM-01: 空文字は 3 種とも拒否する', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('a')).toBe(true);
    expect(() => toNodeId('')).toThrow(RangeError);
    expect(() => toEdgeId('')).toThrow(RangeError);
    expect(() => toNodeTypeId('')).toThrow(RangeError);
  });

  it('FR-DM-01: NodeId と EdgeId の取り違え、as なしの文字列は型エラーになる', () => {
    const n: NodeId = toNodeId('x');
    const e: EdgeId = toEdgeId('x');
    // 実行時は同じ文字列だが、型の上では別物。ここでは型エラーが出ることを確かめる。
    // @ts-expect-error NodeId に EdgeId は代入できない（ブランドが違う）
    const wrong1: NodeId = e;
    // @ts-expect-error EdgeId に NodeId は代入できない（ブランドが違う）
    const wrong2: EdgeId = n;
    // @ts-expect-error as なしでは、ふつうの文字列を NodeId にできない
    const wrong3: NodeId = 'plain';
    expect([wrong1, wrong2, wrong3]).toHaveLength(3);
  });
});

describe('型とラベルから ID を作る（FR-DM-01）', () => {
  const person = toNodeTypeId('person');
  const place = toNodeTypeId('place');

  it('FR-DM-01: 同じ型・同じラベルなら同じ ID', () => {
    expect(makeNodeIdFromTypeAndLabel(person, 'Aḥmad')).toBe(
      makeNodeIdFromTypeAndLabel(person, 'Aḥmad'),
    );
  });

  it('FR-DM-01: 型が違う同名は別の ID になる', () => {
    expect(makeNodeIdFromTypeAndLabel(person, 'Mecca')).not.toBe(
      makeNodeIdFromTypeAndLabel(place, 'Mecca'),
    );
  });

  it('FR-DM-01: 区切りが衝突しない（型 a:b + ラベル c と、型 a + ラベル b:c）', () => {
    const a = makeNodeIdFromTypeAndLabel(toNodeTypeId('a:b'), 'c');
    const b = makeNodeIdFromTypeAndLabel(toNodeTypeId('a'), 'b:c');
    expect(a).not.toBe(b);
  });

  it('FR-DM-01: 合成済みと分解済みの文字は同じ ID（NFC）', () => {
    const composed = 'é'; // é（1 文字）
    const decomposed = 'é'; // e + 結合アキュート
    expect(composed).not.toBe(decomposed);
    expect(makeNodeIdFromTypeAndLabel(person, composed)).toBe(
      makeNodeIdFromTypeAndLabel(person, decomposed),
    );
  });

  it('FR-DM-01: 照合キーは使わない（ハムザ付きと無しのアリフは別の ID のまま）', () => {
    // 照合キーで統一すると、綴りの違う別人まで混ざるため（同名異人）
    expect(makeNodeIdFromTypeAndLabel(person, 'أحمد')).not.toBe(
      makeNodeIdFromTypeAndLabel(person, 'احمد'),
    );
  });

  it('FR-DM-01: 空のラベルは拒否する', () => {
    expect(() => makeNodeIdFromTypeAndLabel(person, '')).toThrow(RangeError);
  });
});

describe('ノード ID の名前空間（FR-DM-01、D-19）', () => {
  const person = toNodeTypeId('person');
  const place = toNodeTypeId('place');
  // 型、本文として使う、衝突しやすい文字列。区切りの `:`、数字、サロゲートペア、アラビア文字を含む。
  const samples = ['a', 'a:b', '1', '1:a', '12:x', 'L1:a:b', 'K1:a:b', '😀', 'a😀:b', 'ابن', 'x y'];

  it('FR-DM-01: 型ごとの名前空間に入る（別の型の同じキーは別の ID）', () => {
    expect(makeNodeIdFromTypeAndKey(person, '1')).not.toBe(makeNodeIdFromTypeAndKey(place, '1'));
  });

  it('FR-DM-01: 同じ文字列から K と L の両方で作っても別の ID', () => {
    for (const s of samples) {
      expect(makeNodeIdFromTypeAndKey(person, s)).not.toBe(makeNodeIdFromTypeAndLabel(person, s));
    }
  });

  it('FR-DM-01: 単射（型、本文、作り方の組が違えば ID も違う）で、parseNodeId が読み戻せる', () => {
    const seen = new Map<string, string>();
    for (const type of samples) {
      for (const text of samples) {
        for (const source of ['key', 'label'] as const) {
          const t = toNodeTypeId(type);
          const id =
            source === 'key'
              ? makeNodeIdFromTypeAndKey(t, text)
              : makeNodeIdFromTypeAndLabel(t, text);
          const desc = JSON.stringify([source, type, text]);
          expect(seen.get(id) ?? desc).toBe(desc); // 同じ ID が別の組から作られていない
          seen.set(id, desc);
          expect(parseNodeId(id)).toEqual({ source, type, text });
        }
      }
    }
  });

  it('FR-DM-01: ラベルの ID は NFC にそろえて読み戻される', () => {
    const id = makeNodeIdFromTypeAndLabel(person, 'e\u0301');
    expect(parseNodeId(id)?.text).toBe('\u00e9');
  });

  it('FR-DM-01: この形でない ID や壊れた ID は undefined', () => {
    expect(parseNodeId(toNodeId('plain'))).toBeUndefined();
    expect(parseNodeId(toNodeId('K0::x'))).toBeUndefined();
    expect(parseNodeId(toNodeId('K9:ab:x'))).toBeUndefined(); // 長さが文字列より長い
    expect(parseNodeId(toNodeId('K2:abx'))).toBeUndefined(); // 型の後に ':' が無い
    expect(parseNodeId(toNodeId('K1:a:'))).toBeUndefined(); // 本文が空
  });

  it('FR-DM-01: 空のキーは拒否する', () => {
    expect(() => makeNodeIdFromTypeAndKey(person, '')).toThrow(RangeError);
  });
});
