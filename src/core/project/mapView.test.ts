import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_VIEW, parseGraphView } from './graphView';
import { DEFAULT_BUNDLING_VIEW, parseBundlingView } from './bundlingView';
import { parseGeoSource, resolveGeoSource } from './geoSource';
import { DEFAULT_MAP_VIEW, parseMapView, parseMapViewDetailed } from './mapView';
import { DEFAULT_WORKSPACE, parseWorkspace } from './tableView';

describe('view.map（D-59、FR-MP-01）', () => {
  it('FR-MP-01: 空のオブジェクトは既定で補う（D-24）', () => {
    expect(parseMapView({})).toEqual({ ok: true, value: DEFAULT_MAP_VIEW });
    expect(DEFAULT_MAP_VIEW).toMatchObject({
      background: 'osm',
      viewport: null,
      edgeShape: 'line',
    });
  });
  it('FR-MP-01: オブジェクトでなければ失敗（呼ぶ側が警告にして既定へ戻す）', () => {
    for (const x of [null, 5, 'x', []]) expect(parseMapView(x).ok).toBe(false);
  });
  it('FR-MP-01: 正しい値が往復する', () => {
    const v = {
      ...DEFAULT_MAP_VIEW,
      background: 'custom',
      customTiles: { url: 'https://t.example/{z}/{x}/{y}.png', attribution: '© 古地図' },
      viewport: { lon: 35.2, lat: 31.8, zoom: 6.5 },
      edgeShape: 'arc',
      direction: 'taper',
      encoding: {
        ...DEFAULT_MAP_VIEW.encoding,
        edgeWidth: { ...DEFAULT_MAP_VIEW.encoding.edgeWidth, scale: 'log' },
      },
      labels: 'none',
      playback: { particles: false, cumulativeDegree: true },
      bundling: {
        enabled: true,
        strength: 0.8,
        style: 'overlay',
        iterations: 90,
        epsilonRatio: 0.025,
      },
    };
    expect(parseMapView(v)).toEqual({ ok: true, value: v });
  });
  it('FR-MP-01: 読めない項目は、その項目だけ既定にする', () => {
    const r = parseMapView({
      background: 'satellite',
      customTiles: { url: 'http://t.example/{z}/{x}/{y}', attribution: 5 },
      viewport: { lon: 200, lat: 0, zoom: 3 },
      edgeShape: 1,
      labels: 'x',
      playback: { particles: 'yes' },
      bundling: 5,
    });
    expect(r).toEqual({ ok: true, value: DEFAULT_MAP_VIEW });
  });
  it('FR-MP-01: タイルの URL は https で雛形があるものだけ。使えないものは空にする', () => {
    const url = (u: unknown) => {
      const r = parseMapView({ customTiles: { url: u, attribution: 'a' } });
      return r.ok ? r.value.customTiles : undefined;
    };
    expect(url('https://t.example/{z}/{x}/{y}.png')?.url).toBe('https://t.example/{z}/{x}/{y}.png');
    expect(url('http://t.example/{z}/{x}/{y}.png')?.url).toBe('');
    expect(url('https://t.example/tile.png')?.url).toBe('');
    expect(url(5)?.url).toBe('');
  });
  it('FR-MP-06: 帰属表示の文は上限で切り、右から左の文字もそのまま持つ', () => {
    const r = parseMapView({ customTiles: { url: '', attribution: 'خريطة'.repeat(200) } });
    expect(r.ok && r.value.customTiles.attribution.length).toBe(500);
    const a = parseMapView({ customTiles: { url: '', attribution: '© خريطة قديمة' } });
    expect(a.ok && a.value.customTiles.attribution).toBe('© خريطة قديمة');
  });
  it('FR-MP-01: viewport の範囲（緯度 ±85.0511、ズーム 0〜22）。外れたら null（データに合わせる）', () => {
    const vp = (v: unknown) => {
      const r = parseMapView({ viewport: v });
      return r.ok ? r.value.viewport : 'ng';
    };
    expect(vp({ lon: -180, lat: 85, zoom: 22 })).toEqual({ lon: -180, lat: 85, zoom: 22 });
    expect(vp({ lon: 0, lat: 86, zoom: 3 })).toBeNull();
    expect(vp({ lon: 0, lat: 0, zoom: 23 })).toBeNull();
    expect(vp({ lon: 0, lat: 0, zoom: -1 })).toBeNull();
    expect(vp({ lon: Number.NaN, lat: 0, zoom: 1 })).toBeNull();
  });
});

describe('view.map の既定に戻した項目と removedParams（D-24、D-52）', () => {
  const detailed = (x: unknown) => {
    const r = parseMapViewDetailed(x);
    if (!r.ok) throw new Error('失敗');
    return r.value;
  };
  it('FR-MP-01: 正しい設定、省いた項目、viewport の null は、既定に戻した項目なし', () => {
    expect(detailed({}).reset).toEqual([]);
    expect(detailed({ viewport: null, customTiles: { url: '', attribution: '' } }).reset).toEqual(
      [],
    );
  });
  it('FR-MP-01: 読めずに既定へ戻した項目のパスを返す', () => {
    const r = detailed({
      background: 'satellite',
      customTiles: { url: 'http://t.example/{z}/{x}/{y}', attribution: 5 },
      viewport: { lon: 200, lat: 0, zoom: 3 },
      edgeShape: 1,
      labels: 'x',
      playback: { particles: 'yes' },
      bundling: 5,
    });
    // 順序は問わない（項目ごとに積むため）
    expect([...r.reset].sort()).toEqual(
      [
        'background',
        'customTiles.url',
        'customTiles.attribution',
        'viewport',
        'edgeShape',
        'labels',
        'playback.particles',
        'bundling',
      ].sort(),
    );
    expect(detailed({ customTiles: 3, playback: 4 }).reset).toEqual(['playback', 'customTiles']);
  });
  it('NFR-02: removedParams は名前だけを読む（文字列以外、重複、長すぎるものは捨てる）。無ければ持たない', () => {
    const ok = parseMapView({
      customTiles: {
        url: '',
        attribution: '',
        removedParams: ['key', 'key', 5, '', 'x'.repeat(101), 'token'],
      },
    });
    expect(ok.ok && ok.value.customTiles.removedParams).toEqual(['key', 'token']);
    const none = parseMapView({ customTiles: { url: '', attribution: '', removedParams: [] } });
    expect(none.ok && Object.hasOwn(none.value.customTiles, 'removedParams')).toBe(false);
  });
  it('FR-MP-01: 継承した項目（__proto__、constructor）は読まない', () => {
    const r = parseMapView(
      JSON.parse('{"__proto__":{"background":"simple"},"constructor":{"x":1}}'),
    );
    expect(r.ok && r.value.background).toBe('osm');
  });
});

describe('bundling の設定（D-55、FR-VG-13）', () => {
  it('FR-VG-13: 既定は無効、強さ 0.85、帯', () => {
    expect(DEFAULT_BUNDLING_VIEW).toEqual({ enabled: false, strength: 0.85, style: 'bands' });
    expect(parseBundlingView({})).toEqual({ ok: true, value: DEFAULT_BUNDLING_VIEW });
  });
  it('FR-VG-13: 強さは 0〜1 の有限の数だけ。外れたら既定。知らない項目は落とす', () => {
    const s = (strength: unknown) => {
      const r = parseBundlingView({ strength });
      return r.ok ? r.value.strength : 'ng';
    };
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(1);
    for (const x of [-0.1, 1.1, Number.NaN, '0.3', null]) expect(s(x)).toBe(0.85);
    const r = parseBundlingView({ enabled: true, style: 'overlay', other: 90 });
    expect(r).toEqual({ ok: true, value: { enabled: true, strength: 0.85, style: 'overlay' } });
  });
  it('FR-VG-13/14: 反復回数と ε は省略でき、入力範囲を外れたら既定になる', () => {
    const value = (iterations: unknown, epsilonRatio: unknown) => {
      const r = parseBundlingView({ iterations, epsilonRatio });
      return r.ok ? r.value : undefined;
    };
    expect(value(500, 0.1)).toMatchObject({ iterations: 500, epsilonRatio: 0.1 });
    expect(value(1, 0.001)).toMatchObject({ iterations: 1, epsilonRatio: 0.001 });
    expect(value(50, 0.01)).toEqual(DEFAULT_BUNDLING_VIEW);
    expect(value(1.5, 0)).toEqual(DEFAULT_BUNDLING_VIEW);
    expect(value(501, Number.NaN)).toEqual(DEFAULT_BUNDLING_VIEW);
  });
  it('FR-VG-13: オブジェクトでなければ失敗', () => {
    expect(parseBundlingView(null).ok).toBe(false);
  });
  it('FR-VG-13: view.graph.bundling は任意で、壊れていても図ごとは拒まない（D-24）', () => {
    const none = parseGraphView(DEFAULT_GRAPH_VIEW);
    expect(none.ok && Object.hasOwn(none.value, 'bundling')).toBe(false);
    const good = parseGraphView({
      ...DEFAULT_GRAPH_VIEW,
      bundling: { enabled: true, strength: 1, style: 'bands' },
    });
    expect(good.ok && good.value.bundling).toEqual({ enabled: true, strength: 1, style: 'bands' });
    const bad = parseGraphView({ ...DEFAULT_GRAPH_VIEW, bundling: 5 });
    expect(bad.ok && Object.hasOwn(bad.value, 'bundling')).toBe(false);
  });
});

describe('view.workspace.mainView（D-48、D-59）', () => {
  it('FR-MP-01: 無い、不正なら graph。map は読める', () => {
    expect(DEFAULT_WORKSPACE.mainView).toBe('graph');
    const mv = (x: unknown) => {
      const r = parseWorkspace({ mainView: x });
      return r.ok ? r.value.mainView : 'ng';
    };
    expect(mv('map')).toBe('map');
    expect(mv('graph')).toBe('graph');
    for (const x of [undefined, 'table', 1, null]) expect(mv(x)).toBe('graph');
  });
});

describe('view.geoSource と geoAttrs の読み替え（D-46、R-25）', () => {
  it('FR-VG-02: parseGeoSource は正しい形だけを通す', () => {
    expect(parseGeoSource({ kind: 'geo' })).toEqual({ ok: true, value: { kind: 'geo' } });
    expect(parseGeoSource({ kind: 'attrs', lat: 'a', lon: 'b' }).ok).toBe(true);
    expect(parseGeoSource({ kind: 'attrs', lat: 'a' }).ok).toBe(false);
  });
  it('FR-VG-02: geoSource があればそれを使う', () => {
    expect(resolveGeoSource({ kind: 'geo' }, { geoAttrs: { lat: 'a', lon: 'b' } })).toEqual({
      kind: 'geo',
    });
  });
  it('FR-VG-02: geoSource が無く geoAttrs の両方があれば attrs に読み替える', () => {
    expect(resolveGeoSource(undefined, { geoAttrs: { lat: 'a', lon: 'b' } })).toEqual({
      kind: 'attrs',
      lat: 'a',
      lon: 'b',
    });
  });
  it('FR-VG-02: 片方だけ、geoAttrs なし、graph なしは既定の geo', () => {
    expect(resolveGeoSource(undefined, { geoAttrs: { lat: 'a' } })).toEqual({ kind: 'geo' });
    expect(resolveGeoSource(undefined, { geoAttrs: {} })).toEqual({ kind: 'geo' });
    expect(resolveGeoSource(undefined, {})).toEqual({ kind: 'geo' });
    expect(resolveGeoSource(undefined, undefined)).toEqual({ kind: 'geo' });
  });
  it('FR-VG-02: 読み替えは geoAttrs を書き換えない（片方だけの状態はそのまま残る）', () => {
    const g = parseGraphView({ ...DEFAULT_GRAPH_VIEW, geoAttrs: { lat: 'a' } });
    expect(g.ok && g.value.geoAttrs).toEqual({ lat: 'a' });
  });
});
