import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toFilterId } from '../core/filter';
import { binDayRange, makeTimeAxis } from '../core/time';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import {
  bindFilterToData,
  createDataStore,
  createDisplayStore,
  createFilterStore,
  createMapViewStore,
  createTimeStore,
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
  const display = createDisplayStore();
  const auto = createAutosave({
    targets: { data, filter, notice, display },
    storage,
    now: () => '2026-11-19T00:00:00.000Z',
    onProblem,
    ui,
  });
  return { data, filter, notice, onProblem, ui, auto, display };
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

  it('FR-TM-09 / FR-PJ-02: 暦を替えると保存が予約され、復元で暦が戻る', async () => {
    const mem = memory();
    const a = setup(mem);
    a.auto.start();
    a.data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    const before = mem.saves;
    a.display.getState().setCalendar('hijri');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(mem.saves).toBe(before + 1);
    const b = setup(mem);
    await b.auto.restore();
    expect(b.display.getState().calendar).toBe('hijri');
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

  it('FR-PJ-02: clear を待っている間に次の保存が始まっても、それが終わってから消す', async () => {
    const order: string[] = [];
    const releases: (() => void)[] = [];
    const slow: AutosaveStorage = {
      load: () => Promise.resolve(null),
      save: () =>
        new Promise<void>((resolve) => {
          const n = releases.length + 1;
          releases.push(() => {
            order.push(`save-${String(n)}-done`);
            resolve();
          });
        }),
      clear: () => {
        order.push('clear');
        return Promise.resolve();
      },
    };
    const { data, filter, auto } = setup(slow);
    auto.start();
    data.getState().setDataset(sampleDataset());
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); // 1 つ目の保存が止まっている
    const cleared = auto.clear();
    // 操作: 待っている間にフィルタを変え、1 秒後に 2 つ目の保存が始まる。
    filter.getState().setShowIsolated(!selectFilterState(filter.getState()).showIsolated);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(releases).toHaveLength(2);
    // 期待: 1 つ目が終わっても、2 つ目が残っているので、まだ消さない。
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(['save-1-done']);
    releases[1]?.();
    await expect(cleared).resolves.toBe(true);
    expect(order).toEqual(['save-1-done', 'save-2-done', 'clear']);
  });

  it('FR-PJ-02: flush の後でも clear は待ち続けない', async () => {
    const m = memory();
    const { data, auto } = setup(m);
    auto.start();
    data.getState().setDataset(sampleDataset());
    await auto.flush();
    await expect(auto.clear()).resolves.toBe(true);
    expect(m.value).toBeNull();
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

  describe('FR-TM-02: 時間の再生の保存（view.time）', () => {
    const axis = makeTimeAxis(
      'gregorian',
      [1500, 1510, 1520].map((y) => binDayRange('gregorian', y, 10)),
    );
    function withTime() {
      const mem = memory();
      const data = createDataStore();
      const filter = createFilterStore();
      bindFilterToData(filter, data);
      const time = createTimeStore(() => axis);
      const auto = createAutosave({
        targets: { data, filter, notice: createProjectNoticeStore(), time },
        storage: mem,
        now: () => '2026-11-19T00:00:00.000Z',
        onProblem: vi.fn(),
      });
      auto.start();
      data.getState().setDataset(sampleDataset());
      return { mem, data, time };
    }

    it('FR-TM-02: 再生中のコマでは保存を予約しない。一時停止したときに 1 回だけ予約する', async () => {
      const { mem, time } = withTime();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); // データの読み込みの保存
      const before = mem.saves;
      time.getState().play();
      // 再生中は 1 秒より長く、何コマ動いても保存しない
      for (let i = 0; i < 5; i++) {
        time.getState().tick(400);
        await vi.advanceTimersByTimeAsync(400);
      }
      expect(time.getState().playing).toBe(true);
      expect(mem.saves).toBe(before);
      time.getState().pause();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(mem.saves).toBe(before + 1);
      expect(mem.value).toContain('"time":{"at":');
      expect(mem.value).not.toContain('playing');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
      expect(mem.saves).toBe(before + 1);
    });

    it('FR-TM-02: 終わりに達して止まったときも 1 回だけ予約する', async () => {
      const { mem, time } = withTime();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      const before = mem.saves;
      time.getState().setSpeed(100);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      const afterSpeed = mem.saves; // 速度の変更も保存の対象
      expect(afterSpeed).toBe(before + 1);
      time.getState().play();
      time.getState().tick(60_000); // 終わりを超える
      expect(time.getState().playing).toBe(false);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(mem.saves).toBe(afterSpeed + 1);
    });

    it('FR-TM-02: データの置き換えで時刻が解除されると、保存を予約し、時刻は書かれない', async () => {
      const { mem, data, time } = withTime();
      // 【なぜ】時間のストアは bindTimeToData で結ぶ（本番と同じ）。
      const { bindTimeToData } = await import('../state');
      bindTimeToData(time, data);
      time.getState().step(1);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(mem.value).toContain('"time":{"at":');
      const before = mem.saves;
      data.getState().setDataset(sampleDataset()); // 置き換え → clear
      expect(time.getState().at).toBeNull();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(mem.saves).toBe(before + 1);
      expect(mem.value).not.toContain('"time":{"at"');
    });
  });

  describe('地図の設定（D-52、NFR-02）', () => {
    function withMap(mem: ReturnType<typeof memory> = memory()) {
      const data = createDataStore();
      const filter = createFilterStore();
      bindFilterToData(filter, data);
      const map = createMapViewStore();
      const auto = createAutosave({
        targets: { data, filter, notice: createProjectNoticeStore(), map },
        storage: mem,
        now: () => '2026-11-19T00:00:00.000Z',
        onProblem: vi.fn(),
        ui: createUiStore(),
      });
      auto.start();
      return { mem, data, map, auto };
    }

    it('NFR-02: タイルの URL の鍵は自動保存に残らず、除いた項目名だけが残る', async () => {
      const { mem, data, map } = withMap();
      data.getState().setDataset(sampleDataset());
      map.getState().patchMap({ background: 'custom' });
      map.getState().patchCustomTiles({
        url: 'https://tiles.example.test/{z}/{x}/{y}.png?access_token=SECRET123&style=old',
      });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(mem.value).not.toBeNull();
      expect(mem.value).not.toContain('SECRET123');
      expect(mem.value).toContain('style=old');
      expect(mem.value).toContain('"removedParams":["access_token"]');
    });

    it('FR-MP-01: 表示範囲を動かすと自動保存が予約され、復元で戻る', async () => {
      const { mem, data, map } = withMap();
      data.getState().setDataset(sampleDataset());
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      const before = mem.saves;
      map.getState().setViewport({ lon: 44, lat: 33, zoom: 5 });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(mem.saves).toBe(before + 1);
      expect(mem.value).toContain('"viewport":{"lon":44,"lat":33,"zoom":5}');
      // 別のストアの組で復元すると、表示範囲が戻る。
      const restored = withMap(mem);
      await restored.auto.restore();
      expect(restored.map.getState().map.viewport).toEqual({ lon: 44, lat: 33, zoom: 5 });
    });
  });
});
