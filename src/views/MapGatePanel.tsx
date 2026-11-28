import { mapGateStore } from './mapGate';
import { MainViewTabs } from './MainViewTabs';
import { useT } from './hooks';
import { Toolbar } from './ui/Toolbar';
import './graph.css';
import './map.css';

/** {@link MapGate} の props。 */
interface Props {
  /** タイルのホスト名。 */
  readonly host: string;
}

/**
 * 利用者のタイルを使うファイルを開いたときの、地図の枠の代わりの確認（D-51 補足）。
 *
 * ホスト名と「表示すると表示範囲がそのサーバーに伝わる」ことを示し、押したときだけ地図を読み込む。
 * 【なぜ】ファイルの作者が、開いた人の IP と時刻を知れる形にしないため。グラフへ戻るタブも置く。
 *
 * @param props - タイルのホスト名
 * @returns 確認の表示
 */
export function MapGate({ host }: Props) {
  const t = useT();
  return (
    <section className="graph-view map-view" aria-labelledby="map-gate-title">
      <h2 id="map-gate-title" className="visually-hidden">
        {t('map.title')}
      </h2>
      <Toolbar label={t('map.toolbar')}>
        <MainViewTabs host="gate" />
      </Toolbar>
      <div className="graph-canvas map-canvas map-gate" data-main-frame="map">
        <div className="map-overlay map-overlay-center" data-testid="map-gate">
          <p>{t('map.gate.body', { host })}</p>
          <button
            type="button"
            onClick={() => {
              mapGateStore.getState().release();
            }}
          >
            {t('map.gate.show')}
          </button>
        </div>
      </div>
    </section>
  );
}
