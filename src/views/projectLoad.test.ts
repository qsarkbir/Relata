import { describe, expect, it } from 'vitest';
import { toFilterId } from '../core/filter';
import type { FilterDef } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { DEFAULT_IMPORT_SETTINGS, serializeProject } from '../io/project';
import type { ImportSettings } from '../io/project';
import { EMPTY_IMPORT_SETTINGS, createUiStore } from '../state';
import type { StoredImportSettings } from '../state';
import { createDisplayStore } from '../state';
import { bindFilterToData, createDataStore, createFilterStore, selectFilterState } from '../state';
import { takeSnapshot } from '../state';
import type { ProjectSnapshotView } from '../state';
import { PROJECT_VIEW_KEYS } from '../io/project';
import type { ProjectParts, ProjectView } from '../io/project';
import { projectFileName } from './projectFile';
import { loadProjectText, openProjectFile } from './projectLoad';
import type { ProjectLoadTargets } from './projectLoad';
import { createProjectNoticeStore } from './projectNotice';

// 【TS】io の ImportSettings と state の StoredImportSettings が相互に代入できることの検査。
//       型が食い違うと、この 2 つの関数の呼び出しが型エラーになる（実行時には何もしない）。
// 【TS】2 つの型が互いに代入できるときだけ true になる型。`[A] extends [B]` と括弧で囲むのは、
//       共用体が分配されて意図しない結果になるのを避けるため。
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const toStored = (x: ImportSettings): StoredImportSettings => x;
const toIo = (x: StoredImportSettings): ImportSettings => x;

const flt: FilterDef = {
  id: toFilterId('a'),
  kind: 'category',
  target: 'node',
  attr: 'role',
  include: [{ kind: 'value', value: 'qadi' }],
};

function targets(): ProjectLoadTargets {
  const data = createDataStore();
  const filter = createFilterStore();
  bindFilterToData(filter, data);
  return { data, filter, notice: createProjectNoticeStore() };
}

function validText(): string {
  const src = createFilterStore();
  src.getState().add(flt);
  return serializeProject(
    {
      dataset: sampleDataset(),
      importSettings: { missingTokens: [{ token: '〔欠〕', reason: 'lost' }], columnCalendars: [] },
      view: { filter: selectFilterState(src.getState()) },
    },
    '2026-11-19T00:00:00.000Z',
  );
}

describe('loadProjectText', () => {
  it('FR-PJ-01: 読み込みの設定の型が io と state で一致し、既定値も同じ', () => {
    expect(toIo(toStored(DEFAULT_IMPORT_SETTINGS))).toEqual(DEFAULT_IMPORT_SETTINGS);
    expect(EMPTY_IMPORT_SETTINGS).toEqual(DEFAULT_IMPORT_SETTINGS);
  });

  it('FR-IN-08: 成功するとデータ、設定、フィルタが入り、知らせは loaded になる', () => {
    const t = targets();
    const r = loadProjectText(validText(), 'file', t);
    expect(r.ok).toBe(true);
    expect(t.data.getState().dataset?.meta.title).toBe(sampleDataset().meta.title);
    expect(t.data.getState().importSettings.missingTokens).toHaveLength(1);
    expect(selectFilterState(t.filter.getState()).filters).toHaveLength(1);
    expect(t.notice.getState().report).toMatchObject({ source: 'file' });
  });

  it('FR-IN-08: 未知の項目は警告として知らせに入る（読み込みは成功）', () => {
    const t = targets();
    const obj = JSON.parse(validText()) as Record<string, unknown>;
    Object.assign(obj, { extra: 1 });
    loadProjectText(JSON.stringify(obj), 'file', t);
    expect(t.notice.getState().report?.warnings).toHaveLength(1);
    expect(t.data.getState().dataset).not.toBeNull();
  });

  it('FR-IN-08: 失敗の種類ごとに kind が分かれ、ストアは変わらない', () => {
    const t = targets();
    const cases: [string, string][] = [
      ['{', 'not-json'],
      ['{"app":"Other"}', 'not-relata'],
      ['{"app":"Relata","formatVersion":999}', 'newer-version'],
      ['{"app":"Relata","formatVersion":1,"dataset":{}}', 'broken'],
    ];
    for (const [text, kind] of cases) {
      loadProjectText(text, 'file', t);
      const n = t.notice.getState().notice;
      expect(n?.kind === 'failed' && n.failure.kind).toBe(kind);
    }
    expect(t.data.getState().dataset).toBeNull();
  });

  it('FR-IN-08: 警告は一時的な知らせで消えず、閉じても開き直せる（D-33 (3)）', () => {
    const t = targets();
    const obj = JSON.parse(validText()) as Record<string, unknown>;
    Object.assign(obj, { extra: 1 });
    loadProjectText(JSON.stringify(obj), 'file', t);
    t.notice.getState().show({ kind: 'autosave-quota' });
    t.notice.getState().show({ kind: 'autosave-cleared' });
    expect(t.notice.getState().report?.warnings).toHaveLength(1);
    t.notice.getState().setReportOpen(false);
    expect(t.notice.getState().report).not.toBeNull();
    t.notice.getState().setReportOpen(true);
    expect(t.notice.getState().reportOpen).toBe(true);
  });

  it('FR-PJ-01: takeSnapshot の view は io の ProjectView と同じキーを持つ（D-33 (8)）', () => {
    const t = targets();
    loadProjectText(validText(), 'file', t);
    const snap = takeSnapshot(t.data, t.filter);
    expect(Object.keys(snap?.view ?? {}).sort()).toEqual(
      PROJECT_VIEW_KEYS.filter((key) => key !== 'graph' && key !== 'display').sort(),
    );
    expect(snap?.view.graph).toBeUndefined();
    const parts: ProjectParts | undefined = snap ?? undefined; // 型が io と合うこと
    expect(parts).toBeDefined();
    // 型の一致（任意の項目を含めて、相互に代入できること）。食い違うとコンパイルできない。
    const same: SameType<Required<ProjectView>, Required<ProjectSnapshotView>> = true;
    expect(same).toBe(true);
  });

  it('FR-IN-08: 失敗しても、すでに読み込んだデータは残る', () => {
    const t = targets();
    loadProjectText(validText(), 'file', t);
    loadProjectText('{', 'file', t);
    expect(t.data.getState().dataset).not.toBeNull();
  });

  it('FR-PJ-01: 保存して読み直すと同じデータとフィルタになる（往復）', () => {
    const a = targets();
    loadProjectText(validText(), 'file', a);
    const text2 = serializeProject(
      {
        dataset: a.data.getState().dataset ?? sampleDataset(),
        importSettings: a.data.getState().importSettings,
        view: { filter: selectFilterState(a.filter.getState()) },
      },
      '2026-11-19T00:00:00.000Z',
    );
    // 【なぜ】項目の並び順は問わず、中身が同じことを見る。
    expect(JSON.parse(text2)).toEqual(JSON.parse(validText()));
  });
});

describe('暦の保存と復元', () => {
  it('FR-TM-09: 保存した暦を、読み込みで表示設定に戻す（保存→開き直し）', () => {
    const t = { ...targets(), display: createDisplayStore('hijri') };
    loadProjectText(validText(), 'file', t); // display の無いファイルは既定の西暦に戻す
    expect(t.display.getState().calendar).toBe('gregorian');
    t.display.getState().setCalendar('both');
    const snap = takeSnapshot(t.data, t.filter, undefined, t.display);
    expect(snap).not.toBeNull();
    if (snap === null) return;
    const text = serializeProject(snap, '2026-11-19T00:00:00.000Z');
    const u = { ...targets(), display: createDisplayStore('hijri') };
    loadProjectText(text, 'file', u);
    expect(u.display.getState().calendar).toBe('both');
  });
});

describe('openProjectFile', () => {
  it('FR-UI-03: 解析の前に取り消されたら、ストアに反映しない', async () => {
    const t = targets();
    const ui = createUiStore();
    let release: (s: string) => void = () => undefined;
    const p = openProjectFile(
      {
        text: () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      },
      ui,
      t,
    );
    const id = ui.getState().tasks[0]?.id ?? -1;
    ui.getState().cancelTask(id);
    release(validText());
    expect(await p).toBeNull();
    expect(t.data.getState().dataset).toBeNull();
    expect(t.notice.getState().report).toBeNull();
  });

  it('FR-UI-03: 読み込み中は進行表示が出て、終わると消える', async () => {
    const t = targets();
    const ui = createUiStore();
    let seen = 0;
    ui.subscribe((s) => {
      seen = Math.max(seen, s.tasks.length);
    });
    const r = await openProjectFile({ text: () => Promise.resolve(validText()) }, ui, t);
    expect(r?.ok).toBe(true);
    expect(seen).toBe(1);
    expect(ui.getState().tasks).toHaveLength(0);
  });

  it('FR-IN-08: ファイルを読めなくても例外を投げず、進行表示も消える', async () => {
    const t = targets();
    const ui = createUiStore();
    const r = await openProjectFile({ text: () => Promise.reject(new Error('boom')) }, ui, t);
    expect(r).toBeNull();
    expect(t.notice.getState().notice).toEqual({ kind: 'read-error', message: 'boom' });
    expect(ui.getState().tasks).toHaveLength(0);
  });
});

describe('projectFileName', () => {
  it('FR-PJ-01: 使えない文字は _ にし、日付を付ける。読める文字が無い題名は relata', () => {
    expect(projectFileName('a/b:c', '2026-11-19T01:02:03.000Z')).toBe(
      'a_b_c-2026-11-19.relata.json',
    );
    expect(projectFileName('رجال المغرب', '2026-11-19T00:00:00Z')).toBe(
      'relata-2026-11-19.relata.json',
    );
    expect(projectFileName('  ..', '2026-11-19T00:00:00Z')).toBe('relata-2026-11-19.relata.json');
  });
});
