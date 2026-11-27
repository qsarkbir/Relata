import { describe, expect, it } from 'vitest';
import type { BackgroundSetting } from './background';
import {
  attributionFor,
  buildStyle,
  hostOfTileUrl,
  MAP_MAX_ZOOM,
  OSM_COPYRIGHT_URL,
  OSM_TILE_URL,
  resolveBackground,
  MAP_ZOOM_RANGE,
} from './background';

const none = { url: '', attribution: '' };
const osm: BackgroundSetting = { background: 'osm', customTiles: none };
const simple: BackgroundSetting = { background: 'simple', customTiles: none };
const custom = (url: string, attribution = ''): BackgroundSetting => ({
  background: 'custom',
  customTiles: { url, attribution },
});
const landUrl = 'https://example.test/Relata/geo/land-50m.geojson';

describe('FR-MP-01: 背景の解決', () => {
  it('FR-MP-01: OSM は規約どおりの URL をそのまま使う（サブドメインなし）', () => {
    const r = resolveBackground(osm);
    expect(r).toEqual({ kind: 'osm', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' });
    expect(OSM_TILE_URL).not.toContain('{s}');
  });

  it('FR-MP-01: 利用者のタイルは https で {z}{x}{y} を含むものだけ使う', () => {
    expect(resolveBackground(custom('https://t.example/{z}/{x}/{y}.png')).kind).toBe('custom');
    expect(resolveBackground(custom('http://t.example/{z}/{x}/{y}.png'))).toEqual({
      kind: 'custom-empty',
      problem: 'not-https',
    });
    expect(resolveBackground(custom('https://t.example/{z}/{x}.png'))).toEqual({
      kind: 'custom-empty',
      problem: 'missing-placeholder',
    });
    expect(resolveBackground(custom('https://{s}.t.example/{z}/{x}/{y}.png'))).toEqual({
      kind: 'custom-empty',
      problem: 'subdomain-placeholder',
    });
    expect(resolveBackground(custom(''))).toEqual({ kind: 'custom-empty', problem: 'empty' });
  });

  it('NFR-02: 使えない利用者のタイルは tileUrl を持たず、OSM の URL に落ちない', () => {
    const r = resolveBackground(custom('http://t.example/{z}/{x}/{y}.png'));
    expect('tileUrl' in r).toBe(false);
    expect(
      JSON.stringify(buildStyle(custom('http://t.example/{z}/{x}/{y}.png'), { landUrl })),
    ).not.toContain('openstreetmap');
  });

  it('FR-MP-01: ズームの範囲は 0〜19（OSM の最大ズーム）', () => {
    expect(MAP_ZOOM_RANGE).toEqual({ min: 0, max: 19 });
    expect(MAP_MAX_ZOOM).toBe(19);
  });
});

describe('FR-MP-01・NFR-02: スタイルの組み立て', () => {
  it('NFR-02: どの背景でも glyphs と sprite を持たず、記号の層を作らない', () => {
    for (const s of [osm, simple, custom('https://t.example/{z}/{x}/{y}.png'), custom('')]) {
      const style = buildStyle(s, { landUrl });
      expect(style.glyphs).toBeUndefined();
      expect(style.sprite).toBeUndefined();
      expect(style.layers.some((l) => l.type === 'symbol')).toBe(false);
      expect(style.projection).toEqual({ type: 'mercator' });
    }
  });

  it('FR-MP-01: OSM のタイルは 1 本の URL、256 px、最大ズーム 19', () => {
    const style = buildStyle(osm, { landUrl });
    expect(style.sources.tiles).toMatchObject({
      type: 'raster',
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      maxzoom: 19,
    });
  });

  it('NFR-02: 簡易背景は同梱の GeoJSON だけを読み、外部のタイルを参照しない', () => {
    const style = buildStyle(simple, { landUrl });
    expect(Object.keys(style.sources)).toEqual(['land']);
    expect(style.sources.land).toMatchObject({ type: 'geojson', data: landUrl });
    expect(JSON.stringify(style)).not.toContain('openstreetmap');
    // 海と陸の 2 色（背景の層と塗りの層）。文字の層はない。
    expect(style.layers.map((l) => l.id)).toEqual(['sea', 'land', 'land-outline']);
  });

  it('NFR-02: 利用者のタイルが使えないときは、何も取得しない（海の色だけ）', () => {
    const style = buildStyle(custom('http://t.example/{z}/{x}/{y}.png'), { landUrl });
    expect(style.sources).toEqual({});
    expect(style.layers.map((l) => l.id)).toEqual(['sea']);
  });

  it('FR-MP-01: 利用者のタイルの URL を、そのまま 1 本だけ使う', () => {
    const url = 'https://t.example/maps/{z}/{x}/{y}.jpg?style=a';
    const style = buildStyle(custom(url), { landUrl });
    expect(style.sources.tiles).toMatchObject({ tiles: [url] });
  });
});

describe('FR-MP-06: 帰属表示', () => {
  it('FR-MP-06: OSM は「© OpenStreetMap contributors」で、著作権のページへのリンク', () => {
    expect(attributionFor(osm)).toEqual([
      { text: '© OpenStreetMap contributors', href: OSM_COPYRIGHT_URL },
    ]);
    expect(OSM_COPYRIGHT_URL).toBe('https://www.openstreetmap.org/copyright');
  });

  it('FR-MP-06: OSM の「地図の誤りを報告」は、文言を渡したときだけ添える', () => {
    const parts = attributionFor(osm, { reportMapErrorLabel: 'Report a map error' });
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      text: 'Report a map error',
      href: 'https://www.openstreetmap.org/fixthemap',
    });
  });

  it('FR-MP-06: 簡易背景は「Natural Earth」（文言は上書きできる）', () => {
    expect(attributionFor(simple)[0]?.text).toBe('Natural Earth');
    expect(attributionFor(simple, { simpleAttribution: 'ナチュラルアース' })[0]?.text).toBe(
      'ナチュラルアース',
    );
  });

  it('FR-MP-06: 利用者のタイルは、利用者が書いた文。空ならホスト名', () => {
    const url = 'https://Tiles.Example.org:8443/{z}/{x}/{y}.png';
    expect(attributionFor(custom(url, '  古地図 1900 年 ©図書館  '))).toEqual([
      { text: '古地図 1900 年 ©図書館' },
    ]);
    expect(attributionFor(custom(url, '   '))).toEqual([{ text: 'tiles.example.org' }]);
  });

  it('FR-MP-06: 使えない URL のときは何も描かないので、帰属表示も出さない', () => {
    expect(attributionFor(custom('', 'x'))).toEqual([]);
    expect(attributionFor(custom('http://t.example/{z}/{x}/{y}.png', 'x'))).toEqual([]);
  });

  it('FR-MP-06: 利用者の文は HTML として解釈されない部品（text）のまま返す', () => {
    const evil = '<img src=x onerror=alert(1)>';
    expect(attributionFor(custom('https://t.example/{z}/{x}/{y}.png', evil))).toEqual([
      { text: evil },
    ]);
  });
});

describe('FR-MP-06: ホスト名の取り出し', () => {
  it('小文字にし、ポート・パス・クエリを除く', () => {
    expect(hostOfTileUrl('https://A.B.example:8080/x/{z}?k=1')).toBe('a.b.example');
    expect(hostOfTileUrl('https://t.example')).toBe('t.example');
  });
});
