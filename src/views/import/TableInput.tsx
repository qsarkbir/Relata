import { useEffect, useRef, useState } from 'react';
import { decodeTable, MANUAL_ENCODINGS, openExcel, parseTextTable } from '../../io/table';
import type { ExcelWorkbook, TableWarning, TextTable } from '../../io/table';
import { uiStore } from '../../state';
import { useT } from '../hooks';
import type { ImportDraft, TableTarget } from './model';
import { draftTable } from './model';
import { WARNING_NAMES } from './messages';
import { InfoTip } from '../ui/InfoTip';

/** ファイルまたは貼り付けの表を、確定前のプレビューとして読み込む。 */
interface TableInputProps {
  readonly target: TableTarget;
  readonly label: string;
  readonly onReady: (draft: ImportDraft | null) => void;
}
/**
 * ファイル・文字コード・シートの設定と先頭5レコードのプレビュー。
 * @param props - 対象、見出し、読み取り結果の通知
 * @returns 表入力のフィールドセット
 */
export function TableInput({ target, label, onReady }: TableInputProps) {
  const t = useT();
  const readingKey =
    target === 'node'
      ? 'import.reading.node'
      : target === 'edge'
        ? 'import.reading.edge'
        : 'import.reading.single';
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<'csv' | 'tsv' | 'xlsx'>('csv');
  const [encoding, setEncoding] = useState('');
  const [formulaProtection, setFormulaProtection] = useState(false);
  const [actualEncoding, setActualEncoding] = useState('');
  const [workbook, setWorkbook] = useState<ExcelWorkbook | null>(null);
  const [sheet, setSheet] = useState('');
  const [preview, setPreview] = useState<TextTable | null>(null);
  const [decodeWarnings, setDecodeWarnings] = useState<readonly TableWarning[]>([]);
  const [pending, setPending] = useState<ImportDraft | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const task = useRef<number | null>(null);
  useEffect(
    () => () => {
      version.current++;
      if (task.current !== null) uiStore.getState().endTask(task.current);
    },
    [],
  );
  const invalidate = (): void => {
    version.current++;
    // 【なぜ】待機中の読み取り自体は止められなくても、タスクと表示を直ちに終了する。
    if (task.current !== null) uiStore.getState().endTask(task.current);
    task.current = null;
    setBusy(false);
    setPreview(null);
    setPending(null);
    setAccepted(false);
    setDecodeWarnings([]);
    setError('');
    setWorkbook(null);
    setSheet('');
    setActualEncoding('');
    onReady(null);
  };
  const publish = (
    table: TextTable,
    name: string,
    actual?: string,
    warnings: readonly TableWarning[] = [],
  ): void => {
    if (table.headers.length === 0) throw new Error('empty-table');
    setAccepted(false);
    const draft = { ...draftTable(table, target, name, actual), decodeWarnings: warnings };
    setPreview(table);
    setDecodeWarnings(warnings);
    setActualEncoding(actual ?? '');
    setPending(warnings.length === 0 ? null : draft);
    onReady(warnings.length === 0 ? draft : null);
  };
  const read = async (): Promise<void> => {
    const own = ++version.current;
    onReady(null);
    setError('');
    setBusy(true);
    setPreview(null);
    setDecodeWarnings([]);
    setPending(null);
    setAccepted(false);
    const taskId = uiStore.getState().startTask({ key: readingKey }, () => {
      version.current++;
      task.current = null;
      setBusy(false);
      onReady(null);
    });
    task.current = taskId;
    try {
      if (format === 'xlsx') {
        if (file === null) throw new Error('xlsx-file-required');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (own !== version.current) return;
        const book = await openExcel(bytes);
        if (own !== version.current) return;
        const first = book.sheets[0];
        if (first === undefined) throw new Error('empty-workbook');
        setWorkbook(book);
        setSheet(first);
        publish(book.readSheet(first), file.name);
      } else {
        let content = text;
        let actual = 'utf-8';
        let warnings: readonly TableWarning[] = [];
        if (file !== null) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (own !== version.current) return;
          const decoded = decodeTable(bytes, encoding || undefined);
          content = decoded.text;
          actual = decoded.encoding;
          warnings = decoded.warnings;
        }
        if (own !== version.current) return;
        const table = parseTextTable(content, format === 'tsv' ? '\t' : ',', { formulaProtection });
        if (table.headers.length === 0) throw new Error('empty-table');
        publish(table, file?.name ?? label, actual, warnings);
      }
    } catch (failure) {
      if (own === version.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      uiStore.getState().endTask(taskId);
      if (task.current === taskId) task.current = null;
      if (own === version.current) setBusy(false);
    }
  };
  return (
    <fieldset className="import-source" aria-busy={busy}>
      <legend>{label}</legend>
      <label>
        {t('import.file')}
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          disabled={busy}
          onChange={(event) => {
            const picked = event.currentTarget.files?.[0] ?? null;
            invalidate();
            setFile(picked);
            if (picked !== null)
              setFormat(
                /\.xlsx$/iu.test(picked.name)
                  ? 'xlsx'
                  : /\.tsv$/iu.test(picked.name)
                    ? 'tsv'
                    : 'csv',
              );
          }}
        />
      </label>
      {file !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            invalidate();
            setFile(null);
            if (fileInput.current !== null) fileInput.current.value = '';
            if (format === 'xlsx') setFormat('csv');
          }}
        >
          {t('import.usePaste')}
        </button>
      )}
      <label>
        {t('import.paste')}
        <textarea
          rows={4}
          disabled={busy || file !== null}
          value={text}
          onChange={(event) => {
            invalidate();
            setText(event.currentTarget.value);
          }}
        />
      </label>
      <label>
        {t('import.format')}
        <select
          disabled={busy}
          value={format}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value !== 'csv' && value !== 'tsv' && value !== 'xlsx') return;
            invalidate();
            setFormat(value);
          }}
        >
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
          <option value="xlsx">Excel (.xlsx)</option>
        </select>
      </label>
      {format !== 'xlsx' && (
        <label>
          {t('import.encoding')}
          <select
            disabled={busy}
            value={encoding}
            onChange={(event) => {
              invalidate();
              setEncoding(event.currentTarget.value);
            }}
          >
            <option value="">{t('import.auto')}</option>
            {MANUAL_ENCODINGS.map((value) => (
              <option key={value.label} value={value.label}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {format !== 'xlsx' && (
        <label>
          <input
            type="checkbox"
            checked={formulaProtection}
            disabled={busy}
            onChange={(event) => {
              invalidate();
              setFormulaProtection(event.currentTarget.checked);
            }}
          />
          {t('import.protected')}
        </label>
      )}
      {format !== 'xlsx' && (
        <>
          {' '}
          {/* 【なぜ】ラベルの外に置く。ラベルの中のボタンを押すと、チェックも切り替わるため。 */}
          <InfoTip topic={t('import.protected')}>
            <p>{t('import.protected.hint')}</p>
          </InfoTip>
        </>
      )}
      <button
        type="button"
        disabled={busy || (file === null && text === '')}
        onClick={() => {
          void read();
        }}
      >
        {t('import.read')}
      </button>
      {busy && (
        <>
          <progress aria-label={t(readingKey)} />
          <button
            type="button"
            onClick={() => {
              if (task.current !== null) uiStore.getState().cancelTask(task.current);
            }}
          >
            {t('import.cancelRead')}
          </button>
        </>
      )}
      <div role="alert">
        {error !== '' && (
          <div>
            {t('import.readFailed')}{' '}
            <details>
              <summary>{t('import.details')}</summary>
              <bdi>{error}</bdi>
            </details>
          </div>
        )}
      </div>
      {actualEncoding !== '' && (
        <p>
          {t('import.detected')}: {actualEncoding}
        </p>
      )}
      {workbook !== null && (
        <label>
          {t('import.sheet')}
          <select
            value={sheet}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSheet(value);
              try {
                publish(workbook.readSheet(value), file?.name ?? label);
                setError('');
              } catch (failure) {
                onReady(null);
                setPreview(null);
                setError(failure instanceof Error ? failure.message : String(failure));
              }
            }}
          >
            {workbook.sheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {decodeWarnings.length > 0 && (
        <div className="import-warning">
          <p>{t('import.encodingWarning')}</p>
          <ul>
            {decodeWarnings.map((warning, index) => (
              <li key={index}>{t(WARNING_NAMES[warning.code] ?? 'import.warning.unknown')}</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => {
                setAccepted(event.currentTarget.checked);
                onReady(event.currentTarget.checked ? pending : null);
              }}
            />
            {t('import.acceptEncoding')}
          </label>
        </div>
      )}
      {preview !== null && (
        <>
          <p>{t('import.previewRows', { count: String(preview.rows.length) })}</p>
          <div className="import-table-wrap">
            <table>
              <caption>{t('import.preview')}</caption>
              <thead>
                <tr>
                  {preview.headers.map((header, index) => (
                    <th key={index} scope="col">
                      <bdi>{header}</bdi>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 5).map((row, index) => (
                  <tr key={index}>
                    {row.map((value, column) => (
                      <td key={column}>
                        <bdi>{value}</bdi>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </fieldset>
  );
}
