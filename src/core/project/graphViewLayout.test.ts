import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_VIEW, parseGraphView } from './graphView';

describe('FR-VG-02: 配置の設定の保存（D-24）', () => {
  it('FR-VG-02: 項目が無ければ既定値のまま（v0.1 のファイルと同じ）', () => {
    const r = parseGraphView({});
    expect(r).toEqual({ ok: true, value: DEFAULT_GRAPH_VIEW });
    expect(r.ok && 'columnOrder' in r.value).toBe(false);
  });
  it('FR-VG-02: 層状・地理座標の方式、列の順、緯度経度の属性が往復する', () => {
    const input = {
      layout: 'geo',
      columnOrder: ['org', 'person'],
      geoAttrs: { lat: 'φ', lon: 'λ' },
    };
    const r = parseGraphView(input);
    expect(r.ok && r.value.layout).toBe('geo');
    expect(r.ok && r.value.columnOrder).toEqual(['org', 'person']);
    expect(r.ok && r.value.geoAttrs).toEqual({ lat: 'φ', lon: 'λ' });
    expect(parseGraphView(JSON.parse(JSON.stringify(r.ok ? r.value : null)))).toEqual(r);
    expect(parseGraphView({ layout: 'layered' }).ok).toBe(true);
  });
  it('FR-VG-02: 緯度だけ・経度だけの指定も往復する（選んでいない側は項目ごと省く）', () => {
    for (const geoAttrs of [{ lat: 'φ' }, { lon: 'λ' }]) {
      const r = parseGraphView({ layout: 'geo', geoAttrs });
      expect(r.ok && r.value.geoAttrs).toEqual(geoAttrs);
      expect(parseGraphView(JSON.parse(JSON.stringify(r.ok ? r.value : null)))).toEqual(r);
    }
    // 両方なければ geoAttrs ごと省く。
    const none = parseGraphView({ geoAttrs: {} });
    expect(none.ok && 'geoAttrs' in none.value).toBe(false);
  });
  it('FR-VG-02: 壊れた列の順・属性は拒む', () => {
    expect(parseGraphView({ columnOrder: 'org' }).ok).toBe(false);
    expect(parseGraphView({ columnOrder: [1] }).ok).toBe(false);
    expect(parseGraphView({ geoAttrs: { lat: '' } }).ok).toBe(false);
    expect(parseGraphView({ geoAttrs: { lat: 1 } }).ok).toBe(false);
    expect(parseGraphView({ geoAttrs: null }).ok).toBe(false);
  });
});
