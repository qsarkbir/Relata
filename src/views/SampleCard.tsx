import { useEffect, useRef, useState } from 'react';
import { MAGHRIB_SAMPLE } from '../io/samples/catalog';
import { dataStore, uiStore } from '../state';
import { useT, useUi } from './hooks';
import { loadProjectText } from './projectLoad';

/**
 * 空の画面から承認済みの見本を1クリックで開く（FR-IN-09）。
 *
 * 【なぜ】既存のプロジェクトがある画面には置かない。取得中に利用者がファイルを開いた場合も上書きしない。
 * @returns 題名・出典・読み込みボタン
 */
export function SampleCard() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  const open = async (): Promise<void> => {
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setLoading(true);
    setFailed(false);
    const task = uiStore.getState().startTask({ key: 'sample.task' }, () => {
      controller.abort();
    });
    try {
      // サイトに同梱したデータだけを取得する。利用者のデータを送る通信は行わない。
      const response = await fetch(import.meta.env.BASE_URL + MAGHRIB_SAMPLE.path, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Sample is not available');
      const text = await response.text();
      if (controller.signal.aborted || dataStore.getState().dataset !== null) return;
      // 検査と反映は同期。上の確認の後に別ファイルの読み込みが割り込む await を挟まない。
      loadProjectText(text, 'file');
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      uiStore.getState().endTask(task);
      setLoading(false);
    }
  };
  return (
    <section aria-labelledby="sample-title">
      <h3 id="sample-title">{t('sample.title')}</h3>
      <p lang="en">{MAGHRIB_SAMPLE.title}</p>
      <p lang="en">{MAGHRIB_SAMPLE.description}</p>
      {locale === 'ja' && <p lang="ja">{t('sample.description.ja')}</p>}
      <button
        type="button"
        disabled={loading}
        onClick={() => {
          void open();
        }}
      >
        {t('sample.open')}
      </button>
      <div role="alert">{failed && <p>{t('sample.error')}</p>}</div>
    </section>
  );
}
