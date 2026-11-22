import { describe, expect, it, vi } from 'vitest';
import { createUiStore } from './uiStore';
import { createDataStore } from './dataStore';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';

const L = { key: 'app.title' } as const;
const L2 = { key: 'app.tagline' } as const;

describe('uiStore', () => {
  it('FR-UI-01: 最初の言語を渡せて、setLocale で変えられる', () => {
    const s = createUiStore('en');
    expect(s.getState().locale).toBe('en');
    s.getState().setLocale('ja');
    expect(s.getState().locale).toBe('ja');
  });

  it('FR-UI-03: startTask は異なる ID を返し、一覧に入る', () => {
    const s = createUiStore();
    const a = s.getState().startTask(L);
    const b = s.getState().startTask(L2);
    expect(a).not.toBe(b);
    expect(s.getState().tasks.map((t) => t.label.key)).toEqual(['app.title', 'app.tagline']);
  });

  it('FR-UI-03: updateTask は進み具合を 0〜1 に丸めて更新し、省略で不定に戻す', () => {
    const s = createUiStore();
    const id = s.getState().startTask(L);
    s.getState().updateTask(id, 0.5);
    expect(s.getState().tasks[0]?.fraction).toBe(0.5);
    s.getState().updateTask(id, 3);
    expect(s.getState().tasks[0]?.fraction).toBe(1);
    s.getState().updateTask(id);
    expect(s.getState().tasks[0]?.fraction).toBeUndefined();
    s.getState().updateTask(id, 0.4);
    s.getState().updateTask(id, Number.NaN);
    expect(s.getState().tasks[0]?.fraction).toBeUndefined();
  });

  it('FR-UI-03: 未知の ID の更新と終了は無視する', () => {
    const s = createUiStore();
    const id = s.getState().startTask(L);
    const before = s.getState().tasks;
    s.getState().updateTask(999, 0.1);
    expect(s.getState().tasks).toBe(before);
    s.getState().endTask(999);
    expect(s.getState().tasks).toHaveLength(1);
    s.getState().endTask(id);
    expect(s.getState().tasks).toHaveLength(0);
  });

  it('FR-UI-03: 取り消すと cancel が呼ばれ一覧から消える', () => {
    const s = createUiStore();
    const cancel = vi.fn();
    const id = s.getState().startTask(L, cancel);
    s.getState().cancelTask(id);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(s.getState().tasks).toHaveLength(0);
  });

  it('FR-UI-03: cancel が無い処理は取り消しても残る', () => {
    const s = createUiStore();
    const id = s.getState().startTask(L);
    s.getState().cancelTask(id);
    expect(s.getState().tasks).toHaveLength(1);
  });

  it('FR-UI-05: ダイアログを開閉できる', () => {
    const s = createUiStore();
    s.getState().setOpenDialog('about');
    expect(s.getState().openDialog).toBe('about');
    s.getState().setOpenDialog(null);
    expect(s.getState().openDialog).toBeNull();
  });

  it('FR-UI-02: 左右のパネルをそれぞれ畳んで開ける', () => {
    const s = createUiStore();
    expect(s.getState().collapsedPanels).toEqual({ filters: false, metrics: false });
    s.getState().togglePanel('filters');
    expect(s.getState().collapsedPanels).toEqual({ filters: true, metrics: false });
    s.getState().togglePanel('metrics');
    s.getState().togglePanel('filters');
    expect(s.getState().collapsedPanels).toEqual({ filters: false, metrics: true });
  });
});

describe('dataStore', () => {
  it('FR-UI-01: 最初は null で、置き換えられる', () => {
    const s = createDataStore();
    expect(s.getState().dataset).toBeNull();
    const ds = sampleDataset();
    s.getState().setDataset(ds);
    expect(s.getState().dataset).toBe(ds);
    s.getState().setDataset(null);
    expect(s.getState().dataset).toBeNull();
  });
});
