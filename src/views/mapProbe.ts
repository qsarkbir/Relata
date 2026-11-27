/**
 * 地図の部品の E2E 用の一時の入口（T3-03。`map-probe.html` から読む）。
 *
 * 地図の部品を `import('../map')` で動的に読み込み、ページの URL の問い合わせ（`?background=osm|simple|custom`、
 * `url`、`attribution`、`nowebgl`）で背景を選ぶ。操作と状態を `window.__mapProbe` に出して、E2E が使う。
 * ui の `MapView.tsx` が正式に作られたら不要になる。
 */

/** E2E が使う操作。 */
interface Probe {
  engine: import('../map').MapEngine | null;
  reason: string | null;
  errors: string[];
}

declare global {
  interface Window {
    __mapProbe?: Probe;
  }
}

const params = new URLSearchParams(location.search);
const probe: Probe = { engine: null, reason: null, errors: [] };
window.__mapProbe = probe;

// 【なぜ】WebGL2 が無い環境の表示を確かめるため、問い合わせで WebGL2 の取得を失敗させる。
if (params.has('nowebgl')) {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- 元の関数を、this を付けて呼び直すために取り出す
  const original = HTMLCanvasElement.prototype.getContext;
  // 【TS】`getContext` は引数ごとに戻り値の型が違う（オーバーロード）。型を保つため、差し替えは `apply` で元へ委譲する。
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    if (args[0] === 'webgl2') return null;
    return Reflect.apply(original, this, args) as ReturnType<typeof original>;
  } as typeof original;
}

// 最初の表示範囲（`?lon=44&lat=33&zoom=5`）。無ければ世界全体。
const lon = Number(params.get('lon'));
const lat = Number(params.get('lat'));
const zoom = Number(params.get('zoom'));
const viewport =
  params.has('lon') && params.has('lat') && params.has('zoom') ? { lon, lat, zoom } : null;

const message = document.getElementById('message');
const mapEl = document.getElementById('map');
const rawBackground = params.get('background');
const background = rawBackground === 'simple' || rawBackground === 'custom' ? rawBackground : 'osm';

if (mapEl !== null) {
  void import('../map').then((m) => {
    const result = m.createMapEngine(mapEl, {
      background: {
        background,
        customTiles: { url: params.get('url') ?? '', attribution: params.get('attribution') ?? '' },
      },
      viewport,
      texts: params.has('report') ? { reportMapErrorLabel: 'Report a map error' } : {},
      onError: (e) => probe.errors.push(`${e.kind}: ${e.message}`),
    });
    if (!result.ok) {
      probe.reason = result.reason;
      if (message !== null) message.textContent = 'この環境では地図を描けません';
      return;
    }
    probe.engine = result.engine;
  });
}
