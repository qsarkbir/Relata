import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../hooks';
import { Icon } from './icons';

/** {@link InfoTip} の props。 */
interface InfoTipProps {
  /** 何についての説明か。ダイアログの見出しと、ボタンの名前に使う。 */
  readonly topic: string;
  /** 説明の本文。 */
  readonly children: ReactNode;
  /** アイコンの横に小さく示す件数（注意の数など）。0 や省略なら出さない。 */
  readonly count?: number;
}

/**
 * 〇の中に「！」のアイコンを押すと、説明のダイアログが開く。
 *
 * 【なぜ】画面に説明の文を並べると、操作の部品が間延びして見える（利用者の指摘、2026-11-22）。
 * 説明はアイコンにまとめ、ダイアログでは場所を気にせず詳しく書く。
 * 開閉はこの部品の中だけの状態なので、ストアには入れない（フィルタなどの共有する状態ではないため）。
 * ネイティブの `<dialog>` を使い、Esc で閉じる・フォーカスを戻す、を標準の動きに任せる（NFR-07）。
 * @param props - 話題、本文、件数
 * @returns アイコンのボタンとダイアログ
 */
export function InfoTip({ topic, children, count }: InfoTipProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // 【なぜ】閉じている間は見出しと本文を描かない。画面の中に同じ文が隠れて二重に存在すると、
  // 支援技術の検索や文字での探索が紛らわしくなるため。
  const [open, setOpen] = useState(false);
  const label =
    count !== undefined && count > 0
      ? t('info.openWithCount', { topic, count })
      : t('info.open', { topic });
  return (
    <>
      <button
        type="button"
        className="info-tip"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
      >
        <Icon name="info" />
        {count !== undefined && count > 0 && (
          <span className="info-count" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {/* 【なぜ】ダイアログは body の直下へ描く（portal）。見出し・legend・フォームの中にアイコンを
          置いても、dialog とその見出しが入れ子にならず、HTML として正しい構造を保つため。 */}
      {createPortal(
        <dialog
          ref={ref}
          className="modal-dialog info-dialog"
          aria-labelledby={titleId}
          // 【なぜ】portal で描いても、React のイベントは部品の親（読み込みのウィザードなど）へ伝わる。
          // そのままだと、このダイアログを Esc で閉じたとき、親のダイアログの close や cancel の
          // 処理まで動き、親も閉じてしまう。ここで止める。
          onCancel={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onClose={(event) => {
            event.stopPropagation();
            // 【なぜ】close イベントは遅れて届く。開き直した後の古い close では本文を消さない。
            if (!event.currentTarget.open) setOpen(false);
          }}
        >
          <h2 id={titleId}>{open ? topic : ''}</h2>
          {open && <div className="info-body">{children}</div>}
          {/* 【なぜ】form method="dialog" を使わない。この部品は検索のフォームの中にも置くので、
            form を入れ子にしないため。 */}
          <button
            type="button"
            onClick={() => {
              ref.current?.close();
            }}
          >
            {t('about.close')}
          </button>
        </dialog>,
        document.body,
      )}
    </>
  );
}
