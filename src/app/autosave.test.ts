import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFilterId } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import {
  bindFilterToData,
  createDataStore,
  createFilterStore,
  createUiStore,
  selectFilterState,
} from '../state';
import { createProjectNoticeStore } from '../views/projectNotice';
import { AUTOSAVE_DELAY_MS, createAutosave } from './autosave';
import type { AutosaveStorage } from './autosave';
import { createIdbStorage } from './idbStorage';

function setup(storage: AutosaveStorage) {
  const data = createDataStore();
  const filter = createFilterStore();
  bindFilterToData(filter, data);
  const notice = createProjectNoticeStore();
  const ui = createUiStore();
  const onProblem = vi.fn();
  const auto = createAutosave({
    targets: { data, filter, notice },
    storage,
    now: () => '2026-11-19T00:00:00.000Z',
    onProblem,
    ui,
  });
  return { data, filter, notice, onProblem, ui, auto };
}

function memory(): AutosaveStorage & { value: string | null; saves: number } {
  const m = {
    value: null as string | null,
    saves: 0,
    load: () => Promise.resolve(m.value),
    save: (t: string) => {
      m.value = t;
      m.saves++;
      return Promise.resolve();
    },
    clear: () => {
      m.value = null;
      return Promise.resolve();
    },
  };
  return m;
}

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('FR-PJ-02: 変更の 1 秒後に 1 回だけ保存する（続けて変えると待ち直す）', async () => {
    const mem = memory();
    const { data, filter, auto } = setup(mem);
    auto.start();
    data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(mem.saves).toBe(0);
    filter.getState().setShowIsolated(true); // ここで待ち直し
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(mem.saves).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(mem.saves).toBe(1);
  });

  it('FR-PJ-02: データが無いうちは何も保存しない（前回の保存を空で上書きしない）', async () => {
    const mem = memory();
    mem.value = 'old';
    const { filter, auto } = setup(mem);
    auto.start();
    filter.getState().setShowIsolated(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(mem.value).toBe('old');
  });

  it('FR-PJ-02: 保存した内容を restore で復元でき、フィルタも戻る', async () => {
    const mem = memory();
    const a = setup(mem);
    a.auto.start();
    a.data.getState().setDataset(sampleDataset());
    a.filter.getState().add({
      id: toFilterId('x'),
      kind: 'category',
      target: 'node',
      attr: 'role',
      include: [{ kind: 'value', value: 'qadi' }],
    });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    const b = setup(mem);
    await b.auto.restore();
    expect(b.data.getState().dataset?.meta.title).toBe(sampleDataset().meta.title);
    expect(selectFilterState(b.filter.getState()).filters).toHaveLength(1);
    expect(b.notice.getState().report).toMatchObject({ source: 'autosave' });
  });

  it('FR-PJ-02: 壊れた保存でも restore は例外を投げず、失敗を知らせる', async () => {
    const mem = memory();
    mem.value = '{broken';
    const { data, notice, auto } = setup(mem);
    await expect(auto.restore()).resolves.toBeUndefined();
    expect(data.getState().dataset).toBeNull();
    expect(notice.getState().notice).toMatchObject({ kind: 'failed', source: 'autosave' });
  });

  it('FR-PJ-02: 保存先が使えなくても、知らせは一度だけで、動作は続く', async () => {
    const bad: AutosaveStorage = {
      load: () => Promise.reject(new Error('no')),
      save: () => Promise.reject(new Error('no')),
      clear: () => Promise.reject(new Error('no')),
    };
    const { data, onProblem, auto } = setup(bad);
    await auto.restore();
    auto.start();
    data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(onProblem).toHaveBeenCalledTimes(1);
    expect(onProblem).toHaveBeenCalledWith('unavailable');
    expect(data.getState().dataset).not.toBeNull();
  });

  it('FR-PJ-02: flush は待っている保存をすぐ行い、clear は保存を消して待ちも捨てる', async () => {
    const mem = memory();
    const { data, auto } = setup(mem);
    auto.start();
    data.getState().setDataset(sampleDataset());
    await auto.flush();
    expect(mem.saves).toBe(1);
    data.getState().setDataset(sampleDataset());
    await auto.clear();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(mem.value).toBeNull();
  });

  it('FR-PJ-02: IndexedDB が無い環境の保存先は reject する（呼ぶ側が知らせる）', async () => {
    const s = createIdbStorage(undefined);
    await expect(s.load()).rejects.toThrow();
    await expect(s.save('x')).rejects.toThrow();
  });

  it('FR-PJ-02: 容量の不足は quota として、種類ごとに一度だけ知らせる', async () => {
    const full: AutosaveStorage = {
      ...memory(),
      save: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
    };
    const { data, onProblem, auto } = setup(full);
    auto.start();
    for (let i = 0; i < 2; i++) {
      data.getState().setDataset(sampleDataset());
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    }
    expect(onProblem.mock.calls).toEqual([['quota']]);
  });

  it('FR-PJ-02: clear は進行中の保存の完了を待ってから消す', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const slow: AutosaveStorage = {
      load: () => Promise.resolve(null),
      save: () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('save-done');
            resolve();
          };
        }),
      clear: () => {
        order.push('clear');
        return Promise.resolve();
      },
    };
    const { data, auto } = setup(slow);
    auto.start();
    data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); // 保存が始まって止まっている
    const cleared = auto.clear();
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual([]);
    release();
    await expect(cleared).resolves.toBe(true);
    expect(order).toEqual(['save-done', 'clear']);
  });

  it('FR-PJ-02: 消すのに失敗したら false を返す', async () => {
    const bad: AutosaveStorage = { ...memory(), clear: () => Promise.reject(new Error('x')) };
    const { auto } = setup(bad);
    await expect(auto.clear()).resolves.toBe(false);
  });

  it('FR-PJ-02: 読み取りの間に利用者がデータを入れたら、復元は適用しない', async () => {
    const src = memory();
    const a = setup(src);
    a.auto.start();
    a.data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    let resolveLoad: (v: string | null) => void = () => undefined;
    const slowLoad: AutosaveStorage = {
      ...memory(),
      load: () =>
        new Promise<string | null>((resolve) => {
          resolveLoad = resolve;
        }),
    };
    const b = setup(slowLoad);
    const restoring = b.auto.restore();
    expect(b.ui.getState().tasks).toHaveLength(1); // 復元の進行表示
    const mine = { ...sampleDataset(), meta: { title: '先に開いたもの' } };
    b.data.getState().setDataset(mine);
    resolveLoad(src.value);
    await restoring;
    expect(b.data.getState().dataset?.meta.title).toBe('先に開いたもの');
    expect(b.ui.getState().tasks).toHaveLength(0);
  });

  it('FR-PJ-02: 新しい版の自動保存は復元せず、自動保存を止めて上書きしない', async () => {
    const mem = memory();
    mem.value = '{"app":"Relata","formatVersion":999}';
    const { data, onProblem, auto } = setup(mem);
    auto.start();
    await auto.restore();
    expect(onProblem).toHaveBeenCalledWith('stopped');
    data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(mem.value).toBe('{"app":"Relata","formatVersion":999}');
  });

  it('FR-PJ-02: 復元の適用は、変更として保存し直されない', async () => {
    const src = memory();
    const a = setup(src);
    a.auto.start();
    a.data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    const saves = src.saves;
    const b = setup(src);
    b.auto.start();
    await b.auto.restore();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(src.saves).toBe(saves);
  });
});
