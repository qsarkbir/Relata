import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FILTER_STATE } from '../core/filter';
import type { Dataset, GraphMode } from '../core/model';
import { MISSING_REASONS, isMissingReason } from '../core/model';
import type { MissingToken } from '../io/project';
import { inferColumnType } from '../io/table';
import { applySnapshot, dataStore, filterStore } from '../state';
import { useData, useT } from './hooks';
import { ConfirmOpenDialog } from './ConfirmOpenDialog';
import { projectNoticeStore } from './projectNotice';
import { Columns } from './import/Columns';
import { TableInput } from './import/TableInput';
import { Warnings } from './import/Warnings';
import { previewImport } from './import/model';
import type { ImportDraft, ImportMode, ImportPreview, WizardWarning } from './import/model';
import './import/import.css';
import { InfoTip } from './ui/InfoTip';

const reasonNames = {
  unrecorded: 'filter.missing.unrecorded',
  lost: 'filter.missing.lost',
  illegible: 'filter.missing.illegible',
  'not-applicable': 'filter.missing.not-applicable',
} as const;

/**
 * 表データを段階的に設定し、検証後にのみプロジェクトを置き換える（FR-IN-01〜07）。
 * @returns 開くボタンと、形式→列対応→確認のダイアログ
 */
export function ImportWizard() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const attempt = useRef(0);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [step, setStep] = useState<'files' | 'columns' | 'review'>('files');
  const [mode, setMode] = useState<ImportMode>('single');
  const [first, setFirst] = useState<ImportDraft | null>(null);
  const [second, setSecond] = useState<ImportDraft | null>(null);
  const [title, setTitle] = useState('');
  const [graphMode, setGraphMode] = useState<GraphMode>('directed');
  const [sourceType, setSourceType] = useState('person');
  const [targetType, setTargetType] = useState('person');
  const [missing, setMissing] = useState<readonly MissingToken[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<{
    dataset: Dataset;
    warnings: readonly WizardWarning[];
  } | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const close = (): void => {
    attempt.current++;
    setOpen(false);
    setBusy(false);
    setConfirm(false);
    requestAnimationFrame(() => {
      opener.current?.focus();
    });
  };
  const launch = (): void => {
    attempt.current++;
    setSession((value) => value + 1);
    setOpen(true);
    setStep('files');
    setFirst(null);
    setSecond(null);
    setMissing([]);
    setPreview(null);
    setError('');
    setTitle('');
    setBusy(false);
  };
  const updateFirst = (draft: ImportDraft | null): void => {
    setFirst(draft);
    setPreview(null);
  };
  const updateSecond = (draft: ImportDraft | null): void => {
    setSecond(draft);
    setPreview(null);
  };
  const check = async (): Promise<void> => {
    if (first === null) return;
    const own = ++attempt.current;
    setBusy(true);
    setError('');
    setPreview(null);
    // 【なぜ】同期の変換に入る前に描画し、時間がかかる場合の進行と取消操作を見せる。
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
    if (own !== attempt.current) return;
    try {
      setPreview(
        previewImport(
          mode,
          first,
          second,
          sourceType,
          targetType,
          graphMode,
          missing,
          title || first.name,
        ),
      );
      setStep('review');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (own === attempt.current) setBusy(false);
    }
  };
  const commit = (): void => {
    if (preview?.dataset === null || preview?.dataset === undefined) return;
    const next = preview.dataset;
    // 設定とデータを一度に適用し、その後フィルタを初期化する。確認前はどのストアも書き換えない。
    // 【なぜ】display（暦）は渡さない。暦は利用者の表示の好みで、データを替えても保つ（プロジェクトを開くときだけ復元する）。
    applySnapshot(
      { dataset: next, importSettings: preview.settings, view: { filter: DEFAULT_FILTER_STATE } },
      dataStore,
      filterStore,
    );
    projectNoticeStore
      .getState()
      .setReport({ source: 'file', title: next.meta.title, warnings: [] });
    setReport({ dataset: next, warnings: preview.warnings });
    close();
  };
  const reinfer = (): void => {
    try {
      const infer = (draft: ImportDraft): ImportDraft => ({
        ...draft,
        columns: draft.columns.map((column, index) => ({
          ...column,
          type: inferColumnType(
            draft.table.rows.map((row) => row[index] ?? ''),
            missing,
          ),
        })),
      });
      if (first !== null) setFirst(infer(first));
      if (second !== null) setSecond(infer(second));
      setError('');
      setPreview(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      <button ref={opener} type="button" onClick={launch}>
        {t('import.open')}
      </button>
      {report !== null && report.dataset === dataset && report.warnings.length > 0 && (
        <details className="import-report">
          <summary>{t('import.report', { count: String(report.warnings.length) })}</summary>
          <Warnings warnings={report.warnings} />
        </details>
      )}
      <dialog
        ref={ref}
        className="import-dialog"
        aria-labelledby="import-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          if (open) close();
        }}
      >
        <h2 id="import-title">{t('import.title')}</h2>
        <p>
          {t(
            step === 'files'
              ? 'import.step.files'
              : step === 'columns'
                ? 'import.step.columns'
                : 'import.step.review',
          )}
        </p>
        <button type="button" onClick={close} autoFocus>
          {t('import.cancel')}
        </button>
        {open && (
          <>
            <div hidden={step !== 'files'}>
              <label>
                {t('import.mode')}
                <select
                  value={mode}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value !== 'single' && value !== 'pair') return;
                    setMode(value);
                    setFirst(null);
                    setSecond(null);
                    setPreview(null);
                    setSession((x) => x + 1);
                  }}
                >
                  <option value="single">{t('import.single')}</option>
                  <option value="pair">{t('import.pair')}</option>
                </select>
              </label>{' '}
              <InfoTip topic={t('import.mode')}>
                <p>{t('import.mode.hint.single')}</p>
                <p>{t('import.mode.hint.pair')}</p>
              </InfoTip>
              <label>
                {t('import.projectTitle')}
                <input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                {t('import.direction')}
                <select
                  value={graphMode}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === 'directed' || value === 'undirected' || value === 'mixed')
                      setGraphMode(value);
                  }}
                >
                  <option value="directed">{t('import.directed')}</option>
                  <option value="undirected">{t('import.undirected')}</option>
                  <option value="mixed">{t('import.mixed')}</option>
                </select>
              </label>
              <TableInput
                key={String(session) + mode + 'first'}
                target={mode === 'single' ? 'single' : 'node'}
                label={t(mode === 'single' ? 'import.table.single' : 'import.table.node')}
                onReady={updateFirst}
              />
              {mode === 'pair' && (
                <TableInput
                  key={String(session) + 'edge'}
                  target="edge"
                  label={t('import.table.edge')}
                  onReady={updateSecond}
                />
              )}
              <button
                type="button"
                disabled={first === null || (mode === 'pair' && second === null)}
                onClick={() => {
                  setStep('columns');
                  setError('');
                }}
              >
                {t('import.next')}
              </button>
            </div>
            {step === 'columns' && first !== null && (
              // 【なぜ】変換は描画後に開始するため、その間の設定変更による古い結果の採用を防ぐ。
              <fieldset disabled={busy} aria-label={t('import.step.columns')}>
                {mode === 'single' && (
                  <fieldset>
                    <legend>
                      {t('import.endpointTypes')}{' '}
                      <InfoTip topic={t('import.endpointTypes')}>
                        <p>{t('import.sameTypeHint')}</p>
                      </InfoTip>
                    </legend>
                    <label>
                      {t('import.sourceType')}
                      <input
                        value={sourceType}
                        onChange={(event) => {
                          setSourceType(event.currentTarget.value);
                          setPreview(null);
                        }}
                      />
                    </label>
                    <label>
                      {t('import.targetType')}
                      <input
                        value={targetType}
                        onChange={(event) => {
                          setTargetType(event.currentTarget.value);
                          setPreview(null);
                        }}
                      />
                    </label>
                  </fieldset>
                )}
                <fieldset>
                  <legend>
                    {t('import.missing')}{' '}
                    <InfoTip topic={t('import.missing')}>
                      <p>{t('import.missingHint')}</p>
                    </InfoTip>
                  </legend>
                  {missing.map((entry, index) => (
                    <div key={index} className="import-missing-row">
                      <label>
                        {t('import.token')}
                        <input
                          value={entry.token}
                          onChange={(event) => {
                            setMissing(
                              missing.map((item, position) =>
                                position === index
                                  ? { ...item, token: event.currentTarget.value }
                                  : item,
                              ),
                            );
                            setPreview(null);
                          }}
                        />
                      </label>
                      <label>
                        {t('import.reason')}
                        <select
                          value={entry.reason}
                          onChange={(event) => {
                            const reason = event.currentTarget.value;
                            if (isMissingReason(reason)) {
                              setMissing(
                                missing.map((item, position) =>
                                  position === index ? { ...item, reason } : item,
                                ),
                              );
                              setPreview(null);
                            }
                          }}
                        >
                          {MISSING_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {t(reasonNames[reason])}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        aria-label={t('import.removeToken', { index: String(index + 1) })}
                        onClick={() => {
                          setMissing(missing.filter((_, position) => position !== index));
                          setPreview(null);
                        }}
                      >
                        {t('import.remove')}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setMissing([...missing, { token: '', reason: 'unrecorded' }]);
                      setPreview(null);
                    }}
                  >
                    {t('import.addToken')}
                  </button>
                </fieldset>
                <button type="button" onClick={reinfer}>
                  {t('import.reinfer')}
                </button>
                <Columns
                  draft={first}
                  target={mode === 'single' ? 'single' : 'node'}
                  label={t(mode === 'single' ? 'import.table.single' : 'import.table.node')}
                  onChange={updateFirst}
                />
                {mode === 'pair' && second !== null && (
                  <Columns
                    draft={second}
                    target="edge"
                    label={t('import.table.edge')}
                    onChange={updateSecond}
                  />
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setStep('files');
                    setError('');
                  }}
                >
                  {t('import.back')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void check();
                  }}
                >
                  {t('import.validate')}
                </button>
              </fieldset>
            )}
            {step === 'review' && preview !== null && (
              <>
                {preview.dataset === null ? (
                  <p role="alert">{t('import.blocked')}</p>
                ) : (
                  <p>
                    {t('import.result', {
                      nodes: String(preview.dataset.nodes.length),
                      edges: String(preview.dataset.edges.length),
                    })}
                  </p>
                )}
                {preview.warnings.length === 0 ? (
                  <p>{t('import.noWarnings')}</p>
                ) : (
                  <Warnings warnings={preview.warnings} />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setStep('columns');
                    setPreview(null);
                  }}
                >
                  {t('import.back')}
                </button>
                <button
                  type="button"
                  disabled={preview.dataset === null}
                  onClick={() => {
                    if (dataStore.getState().dataset !== null) setConfirm(true);
                    else commit();
                  }}
                >
                  {t('import.commit')}
                </button>
              </>
            )}
            {busy && (
              <p role="status">
                {t('import.validating')}
                <progress aria-label={t('import.validating')} />
              </p>
            )}
            <div role="alert">
              {error !== '' && (
                <div>
                  {t('import.mappingError')}{' '}
                  <details>
                    <summary>{t('import.details')}</summary>
                    <bdi>{error}</bdi>
                  </details>
                </div>
              )}
            </div>
          </>
        )}
      </dialog>
      <ConfirmOpenDialog
        fileName={confirm ? (title !== '' ? title : (first?.name ?? t('import.title'))) : null}
        onConfirm={commit}
        onCancel={() => {
          setConfirm(false);
        }}
      />
    </>
  );
}
