import { useState } from 'react';
import { useT, useUi } from './hooks';
import type { Task } from '../state';

/**
 * 進行中の処理の一覧と「取り消し」ボタン（FR-UI-03）。
 *
 * 領域（section）は常に描画し、処理が無いときは中身を空にする。
 * 開始と終了は、短い文で読み上げ用の領域（role="status"）に出す。進み具合は `<progress>` が伝える。
 *
 * @returns 進行表示の要素
 */
export function TaskPanel() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const tasks = useUi((s) => s.tasks);
  const cancelTask = useUi((s) => s.cancelTask);

  // 【なぜ】「開始しました／終わりました」は、前回の一覧との差から作る。
  //       描画中に state を更新する書き方（React 公式の「前の props から state を調整する」）で、effect を使わない。
  const [prev, setPrev] = useState<readonly Task[]>([]);
  const [announcement, setAnnouncement] = useState('');
  if (prev !== tasks) {
    const started = tasks.find((x) => !prev.some((p) => p.id === x.id));
    const finished = prev.find((p) => !tasks.some((x) => x.id === p.id));
    setPrev(tasks);
    if (started !== undefined) {
      setAnnouncement(t('tasks.started', { label: t(started.label.key, started.label.params) }));
    } else if (finished !== undefined) {
      setAnnouncement(t('tasks.finished', { label: t(finished.label.key, finished.label.params) }));
    }
  }

  // 【なぜ】割合の文字は、言語ごとの書き方（アラビア語圏の数字など）に Intl に任せる。
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });

  return (
    <section className="task-panel" aria-label={t('tasks.region')} hidden={tasks.length === 0}>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      <ul>
        {tasks.map((task) => {
          const label = t(task.label.key, task.label.params);
          return (
            <li key={task.id} className="task">
              {/* 【なぜ】ラベルは人名などを含みうるので <bdi> で向きを隔離する（NFR-09）。 */}
              <bdi className="task-label">{label}</bdi>
              {task.fraction === undefined ? (
                <progress aria-label={label}>{t('tasks.unknownProgress')}</progress>
              ) : (
                <>
                  <progress aria-label={label} value={task.fraction} max={1} />
                  <span className="task-percent">{percent.format(task.fraction)}</span>
                </>
              )}
              {task.cancel !== undefined && (
                <button
                  type="button"
                  aria-label={t('tasks.cancelLabel', { label })}
                  onClick={() => {
                    cancelTask(task.id);
                  }}
                >
                  {t('tasks.cancel')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
