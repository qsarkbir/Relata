# 簡易背景の陸地データ（`land-50m.geojson`）

地図の「簡易背景」（`view.map.background: 'simple'`）が使う、世界の陸地の輪郭。簡易背景を選んだときだけ、このサイトから読み込む（設計書 D-51）。外部の地図サーバーには通信しない。

## 出典とライセンス

- **Natural Earth** の「Land」1:50m（バージョン 4.1.0）。https://www.naturalearthdata.com/
- Natural Earth のデータは**パブリックドメイン**（https://www.naturalearthdata.com/about/terms-of-use/ 。利用に帰属表示は要らないが、地図の右下に「Natural Earth」と出す）。
- 入手は、Natural Earth を TopoJSON にして再配布している npm パッケージ `world-atlas@2.0.2`（ISC ライセンス、Michael Bostock）の `land-50m.json`。

## 変換の手順（一度だけ行った。アプリの依存には足していない）

1. 作業用の空のフォルダで `npm pack world-atlas@2` と `npm pack topojson-client@3`（3.1.0。ISC）を取り、展開する。
2. 次の Node.js のスクリプトで、TopoJSON を GeoJSON（1 つの MultiPolygon の FeatureCollection）に変換する。座標は小数点以下 2 桁（約 1 km。1:50m の精度に対して十分）に丸めて容量を減らす。

```js
// node convert.cjs <topojson-client.js> <land-50m.json> <出力.geojson>
const fs = require('fs');
const [, , tcPath, inPath, outPath] = process.argv;
const topojson = require(tcPath);
const topo = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const fc = topojson.feature(topo, topo.objects.land);
const r = (n) => Math.round(n * 100) / 100;
const walk = (c) => (typeof c[0] === 'number' ? [r(c[0]), r(c[1])] : c.map(walk));
const feats = (fc.type === 'FeatureCollection' ? fc.features : [fc]).map((f) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: f.geometry.type, coordinates: walk(f.geometry.coordinates) },
}));
fs.writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features: feats }));
```

3. 出力を `public/geo/land-50m.geojson` に置く。

大きさ: 約 880 KB（gzip で約 258 KB）。
