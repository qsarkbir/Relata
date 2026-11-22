import { ModalDialog } from '../ModalDialog';
import { useT, useUi } from '../hooks';
import { CsvExportControls } from './CsvExportControls';
import { useCurrentMetrics } from './useCurrentMetrics';

/**
 * 上部の「CSV出力」ボタンと、その書き出しのダイアログ（FR-OUT-02）。
 *
 * 【なぜ】書き出しは「保存」と同じく画面全体に対する操作なので、上部に置く。
 * 指標パネルの上に置くと、指標を読む場所に操作が割り込み、違和感があった（利用者の指摘、2026-11-22）。
 * @returns ボタンとダイアログ。データが無いときはボタンを無効にする
 */
export function CsvExportMenu() {
  const t = useT();
  const setOpenDialog = useUi((s) => s.setOpenDialog);
  const { dataset } = useCurrentMetrics();
  return (
    <>
      <button
        type="button"
        disabled={dataset === null}
        onClick={() => {
          setOpenDialog('csvExport');
        }}
      >
        {t('csv.open')}
      </button>
      <ModalDialog id="csvExport" title={t('csv.title')} className="csv-dialog">
        <CsvExportBody />
      </ModalDialog>
    </>
  );
}

/**
 * ダイアログの本文。開いている間だけ描く。
 *
 * @returns 書き出しの設定とボタン
 */
function CsvExportBody() {
  const t = useT();
  const { dataset, filter, result } = useCurrentMetrics();
  if (dataset === null) return null;
  return (
    <>
      <CsvExportControls dataset={dataset} filter={filter} result={result} />
      {result === null && <p className="hint">{t('csv.metricsPending')}</p>}
    </>
  );
}
