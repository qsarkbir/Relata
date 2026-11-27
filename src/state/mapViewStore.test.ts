import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_VIEW } from '../core/project';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore } from './dataStore';
import { bindFilterToData, createFilterStore } from './filterStore';
import { createWorkspaceStore } from './workspaceStore';
import { createGraphViewStore } from './graphViewStore';
import {
  bindMapViewToData,
  createMapViewStore,
  geoSourceToSave,
  isDefaultMapView,
} from './mapViewStore';
import { applySnapshot, takeSnapshot } from './project';

function stores() {
  const data = createDataStore();
  const filter = createFilterStore();
  bindFilterToData(filter, data);
  const map = createMapViewStore();
  const workspace = createWorkspaceStore();
  const graph = createGraphViewStore();
  data.getState().setDataset(sampleDataset());
  return { data, filter, map, workspace, graph };
}

describe('FR-MP-01・D-59: 地図の設定のスナップショット', () => {
  it('FR-MP-01: 既定のままなら view.map、view.geoSource、view.workspace を保存しない', () => {
    const { data, filter, map, workspace } = stores();
    const snap = takeSnapshot(data, filter, { map, workspace });
    expect(snap?.view.map).toBeUndefined();
    expect(snap?.view.geoSource).toBeUndefined();
    expect(snap?.view.workspace).toBeUndefined();
  });

  it('FR-MP-01: 背景・表示範囲・座標の出どころ・表示中のビューが、保存と読み込みで往復する', () => {
    const { data, filter, map, workspace } = stores();
    map.getState().patchMap({ background: 'simple' });
    map.getState().setViewport({ lon: 44, lat: 33, zoom: 5 });
    map.getState().setGeoSource({ kind: 'attrs', lat: 'Lat', lon: 'Lon' });
    workspace.getState().patchWorkspace({ mainView: 'map' });
    const snap = takeSnapshot(data, filter, { map, workspace });
    expect(snap?.view.map?.background).toBe('simple');
    expect(snap?.view.map?.viewport).toEqual({ lon: 44, lat: 33, zoom: 5 });
    expect(snap?.view.geoSource).toEqual({ kind: 'attrs', lat: 'Lat', lon: 'Lon' });
    expect(snap?.view.workspace?.mainView).toBe('map');

    const other = stores();
    if (snap !== null)
      applySnapshot(snap, other.data, other.filter, {
        map: other.map,
        workspace: other.workspace,
      });
    expect(other.map.getState().map.background).toBe('simple');
    expect(other.map.getState().map.viewport).toEqual({ lon: 44, lat: 33, zoom: 5 });
    expect(other.map.getState().geoSource).toEqual({ kind: 'attrs', lat: 'Lat', lon: 'Lon' });
    expect(other.workspace.getState().workspace.mainView).toBe('map');
  });

  it('FR-MP-01: 項目の無いファイルを開くと、前のプロジェクトの背景や出どころを残さず既定に戻す', () => {
    const { data, filter, map } = stores();
    map.getState().patchMap({ background: 'simple' });
    map.getState().setGeoSource({ kind: 'attrs', lat: 'a', lon: 'b' });
    const old = takeSnapshot(stores().data, stores().filter);
    if (old !== null) applySnapshot(old, data, filter, { map });
    expect(map.getState().map).toEqual(DEFAULT_MAP_VIEW);
    expect(map.getState().geoSource).toBeUndefined();
  });

  it('D-46: 明示した geo の出どころは、geoAttrs の読み替えが働くときは省かない', () => {
    const geoAttrs = { lat: 'Lat', lon: 'Lon' };
    expect(geoSourceToSave({ kind: 'geo' }, undefined)).toBeUndefined();
    expect(geoSourceToSave({ kind: 'geo' }, { geoAttrs: { lat: 'Lat' } })).toBeUndefined();
    expect(geoSourceToSave({ kind: 'geo' }, { geoAttrs })).toEqual({ kind: 'geo' });
    expect(geoSourceToSave(undefined, { geoAttrs })).toBeUndefined();
  });

  it('FR-MP-01: 表示範囲だけ null に戻した設定は既定と同じ内容とみなす', () => {
    const m = createMapViewStore();
    m.getState().setViewport({ lon: 1, lat: 2, zoom: 3 });
    expect(isDefaultMapView(m.getState().map)).toBe(false);
    m.getState().setViewport(null);
    expect(isDefaultMapView(m.getState().map)).toBe(true);
  });

  it('FR-MP-01: データを置き換えると表示範囲と出どころは戻り、背景は保つ', () => {
    const data = createDataStore();
    const map = createMapViewStore();
    bindMapViewToData(map, data);
    map.getState().patchMap({ background: 'simple' });
    map.getState().setViewport({ lon: 1, lat: 2, zoom: 3 });
    map.getState().setGeoSource({ kind: 'geo' });
    data.getState().setDataset(sampleDataset());
    expect(map.getState().map.viewport).toBeNull();
    expect(map.getState().map.background).toBe('simple');
    expect(map.getState().geoSource).toBeUndefined();
  });
});

describe('NFR-02・D-52: タイルの URL の鍵', () => {
  const tiles = 'https://tiles.example.test/{z}/{x}/{y}.png';

  it('D-52: URL を編集すると、除いた鍵の項目名の記録（removedParams）が消える', () => {
    const m = createMapViewStore();
    m.getState().reset({
      map: {
        ...DEFAULT_MAP_VIEW,
        customTiles: { url: tiles, attribution: '', removedParams: ['key'] },
      },
    });
    // 帰属表示だけを編集しても、記録は残る（URL は変わっていない）。
    m.getState().patchCustomTiles({ attribution: '出典' });
    expect(m.getState().map.customTiles.removedParams).toEqual(['key']);
    // URL を編集したら消える。
    m.getState().patchCustomTiles({ url: `${tiles}?key=abc` });
    expect(m.getState().map.customTiles.removedParams).toBeUndefined();
    expect(m.getState().map.customTiles.attribution).toBe('出典');
  });
});
