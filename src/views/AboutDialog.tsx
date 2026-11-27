import { useEffect, useRef } from 'react';
// 【なぜ】LICENSE の全文と著作権表示は、ファイルそのものを `?raw` で読む。コピーを持つと食い違うため（D-25）。
import licenseText from '../../LICENSE?raw';
import { FONTS, LIBRARIES } from './libraries';
import { useT, useUi } from './hooks';

/** Palladio のリポジトリ。 */
const PALLADIO_URL = 'https://github.com/humanitiesplusdesign/palladio';

/** LICENSE の 'Copyright (c) …' で始まる行（著作権表示）。 */
const COPYRIGHT_LINES: readonly string[] = licenseText
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('Copyright'));

/**
 * 「このツールについて」のダイアログ（FR-UI-05）。
 *
 * @returns `<dialog>` 要素
 */
// 【なぜ】ネイティブの <dialog> と showModal() を使う。Esc で閉じる、フォーカスを中に閉じ込める、
//       閉じたら元のボタンに戻す、が標準で働き、キーボードだけで操作できる（NFR-07）。
export function AboutDialog() {
  const t = useT();
  const open = useUi((s) => s.openDialog === 'about');
  const setOpenDialog = useUi((s) => s.setOpenDialog);
  // 【TS】`useRef<HTMLDialogElement>(null)` は、型引数で「中身は dialog 要素」と指定する。
  //       描画前は null なので、使う前に null を確かめる。
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="about-dialog"
      aria-labelledby="about-title"
      onClose={(event) => {
        // 【なぜ】close イベントは遅れて届く。開き直した後の古い close では閉じない（ModalDialog と同じ）。
        if (!event.currentTarget.open) setOpenDialog(null);
      }}
    >
      <h2 id="about-title">{t('about.title')}</h2>
      <p>{t('about.origin')}</p>
      <p>
        <a href={PALLADIO_URL} target="_blank" rel="noopener noreferrer">
          {t('about.palladioLink')}
        </a>
      </p>
      <p>{t('about.license')}</p>
      <h3>{t('about.copyright')}</h3>
      <ul dir="ltr">
        {COPYRIGHT_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <details>
        <summary>{t('about.licenseFull')}</summary>
        <pre dir="ltr" className="license-text">
          {licenseText}
        </pre>
      </details>
      <p>{t('about.privacy')}</p>
      <p data-testid="about-map-privacy">{t('about.mapPrivacy')}</p>
      <p>{t('about.mapSources')}</p>
      <h3>{t('about.libraries')}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('about.libraries.name')}</th>
            <th scope="col">{t('about.libraries.license')}</th>
          </tr>
        </thead>
        <tbody>
          {LIBRARIES.map((lib) => (
            <tr key={lib.name}>
              <td dir="ltr">{lib.name}</td>
              <td dir="ltr">{lib.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t('about.fonts')}</h3>
      <p>{t('about.fonts.note')}</p>
      <p>{t('about.harfbuzz')}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('about.libraries.name')}</th>
            <th scope="col">{t('about.libraries.license')}</th>
            <th scope="col">{t('about.copyright')}</th>
          </tr>
        </thead>
        <tbody>
          {FONTS.map((font) => (
            <tr key={font.name}>
              <td dir="ltr">{font.name}</td>
              <td dir="ltr">
                <a
                  href={`${import.meta.env.BASE_URL}fonts/${font.licenseFile}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {font.license}
                </a>
              </td>
              <td dir="ltr">{font.copyright}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form method="dialog">
        <button type="submit">{t('about.close')}</button>
      </form>
    </dialog>
  );
}
