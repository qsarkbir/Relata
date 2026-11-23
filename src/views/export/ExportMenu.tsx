import { useState } from 'react';
import { PDF_FONT_BYTES_ESTIMATE, PNG_SCALES } from '../../io/export';
import { ModalDialog } from '../ModalDialog';
import { useT, useUi } from '../hooks';
import { getNumberFormat } from '../intl';
import { useNetwork } from '../useNetwork';
import { useFigureSource } from '../figureExport';
import { CsvExportControls } from '../metrics/CsvExportControls';
import { useCurrentMetrics } from '../metrics/useCurrentMetrics';
import {
  exportNetworkFile,
  exportPdfFigure,
  exportPngFigure,
  exportSvgFigure,
  localDateString,
} from './exportActions';
import type { FigureChoices, FigureOutcome } from './exportActions';

/**
 * 上部の「書き出し」ボタンと、書き出しのダイアログ（FR-OUT-01〜05、07）。
 *
 * 図（SVG・PNG・PDF）、グラフのデータ（GraphML・GEXF）、表と指標（CSV）をまとめる。
 * 「保存」はプロジェクトの保存だけにする（保存と書き出しは別の操作）。
 *
 * @returns ボタンとダイアログ。データが無いときはボタンを無効にする
 */
export function ExportMenu() {
  const t = useT();
  const setOpenDialog = useUi((s) => s.setOpenDialog);
  const { dataset } = useCurrentMetrics();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={dataset === null}
        onClick={() => {
          setOpenDialog('export');
        }}
      >
        {t('export.open')}
      </button>
      <ModalDialog id="export" title={t('export.title')} className="export-dialog">
        <ExportBody />
      </ModalDialog>
    </>
  );
}

// 【TS】判別共用体: `kind` の値で、持つ項目（percent があるか）が決まる。`phase.kind === 'loadingFonts'` と
//       確かめた分岐では、TypeScript が `phase.percent` を使えると分かる。
/** 書き出しの実行中の状態。 */
type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loadingFonts'; readonly percent: number }
  | { readonly kind: 'making' };

/**
 * ダイアログの本文。開いている間だけ描く。
 *
 * @returns 各形式の設定とボタン
 */
function ExportBody() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const source = useFigureSource();
  const network = useNetwork();
  const { dataset, filter, result, graphOptions } = useCurrentMetrics();
  const [legend, setLegend] = useState(true);
  const [credit, setCredit] = useState(true);
  const [pngScale, setPngScale] = useState<number>(2);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // 実行中の書き出し（押したボタンの種類）。押したボタンだけを aria-disabled にして、フォーカスを保つ。
  const [active, setActive] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (dataset === null) return null;
  const busy = active !== null;

  const choices = (): FigureChoices => ({
    legend,
    credit,
    pngScale,
    // 【なぜ】フォントはこのサイトのものを読む（外部の CDN には通信しない。NFR-02、D-43）。
    fontBaseUrl: `${import.meta.env.BASE_URL}fonts/`,
    onFontProgress: (fraction) => {
      // 【なぜ】進みの読み上げ（role=status）が細かく続くと、読み上げが追いつかず邪魔になる。10% 刻みに間引く。
      const percent = Math.min(100, Math.floor(fraction * 10) * 10);
      setPhase((prev) =>
        prev.kind === 'loadingFonts' && prev.percent === percent
          ? prev
          : { kind: 'loadingFonts', percent },
      );
    },
    onMaking: () => {
      setPhase({ kind: 'making' });
    },
  });
  const run = async (
    kind: string,
    action: () => FigureOutcome | Promise<FigureOutcome>,
  ): Promise<void> => {
    // 【なぜ】実行中の押下は無視する。ボタンを disabled にすると、押した瞬間にフォーカスが失われるため、
    // aria-disabled で知らせ、ここで弾く。
    if (busy) return;
    setActive(kind);
    setFailed(false);
    setNote(null);
    try {
      const outcome = await action();
      if (outcome.clamped !== undefined)
        setNote(
          t('export.png.clamped', {
            scale: nf.format(Number(outcome.clamped.scale.toFixed(2))),
            size: `${nf.format(outcome.clamped.width)}×${nf.format(outcome.clamped.height)} px`,
          }),
        );
    } catch {
      setFailed(true);
    } finally {
      setPhase({ kind: 'idle' });
      setActive(null);
    }
  };
  const date = localDateString();
  const pdfSize = `${nf.format(Math.round(PDF_FONT_BYTES_ESTIMATE / 1_000_000))} MB`;
  return (
    <div aria-busy={busy}>
      <fieldset className="export-section">
        <legend>{t('export.figure')}</legend>
        <p className="hint">{t('export.figure.hint')}</p>
        <label>
          <input
            type="checkbox"
            checked={legend}
            onChange={(e) => {
              setLegend(e.target.checked);
            }}
          />
          {t('export.figure.legend')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={credit}
            onChange={(e) => {
              setCredit(e.target.checked);
            }}
          />
          {t('export.figure.credit')}
        </label>
        <label>
          {t('export.png.scale')}{' '}
          <select
            value={String(pngScale)}
            onChange={(e) => {
              setPngScale(Number(e.target.value));
            }}
          >
            {PNG_SCALES.map((n) => (
              <option key={n} value={String(n)}>
                {t('export.png.scaleOption', { n })}
              </option>
            ))}
          </select>
        </label>
        <div className="metrics-actions">
          {(
            [
              ['svg', 'export.svg'],
              ['png', 'export.png'],
              ['pdf', 'export.pdf'],
            ] as const
          ).map(([kind, key]) => (
            <button
              key={kind}
              type="button"
              disabled={source === null}
              aria-disabled={active === kind}
              onClick={() => {
                if (source === null) return;
                const c = choices();
                void run(kind, () =>
                  kind === 'svg'
                    ? exportSvgFigure(source, c, date)
                    : kind === 'png'
                      ? exportPngFigure(source, c, date)
                      : exportPdfFigure(source, c, date),
                );
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
        {source === null && <p className="hint">{t('export.figure.none')}</p>}
        <p className="hint">{t('export.pdf.hint', { size: pdfSize })}</p>
        <div role="status" className="hint">
          {phase.kind === 'loadingFonts'
            ? t('export.pdf.loading', { percent: phase.percent })
            : phase.kind === 'making'
              ? t('export.pdf.making')
              : (note ?? '')}
        </div>
      </fieldset>
      <fieldset className="export-section">
        <legend>{t('export.network')}</legend>
        <p className="hint">{t('export.network.hint')}</p>
        <div className="metrics-actions">
          {(
            [
              ['graphml', 'export.graphml'],
              ['gexf', 'export.gexf'],
            ] as const
          ).map(([kind, key]) => (
            <button
              key={kind}
              type="button"
              disabled={network === null || network.graph.order === 0}
              aria-disabled={active === kind}
              onClick={() => {
                if (network === null) return;
                void run(kind, () => {
                  exportNetworkFile(kind, dataset, network.graph, date);
                  return {};
                });
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </fieldset>
      <h3>{t('export.table')}</h3>
      <CsvExportControls
        dataset={dataset}
        filter={filter}
        result={result}
        graphOptions={graphOptions}
      />
      {result === null && <p className="hint">{t('csv.metricsPending')}</p>}
      <div role="alert">{failed ? t('export.failed') : ''}</div>
    </div>
  );
}
