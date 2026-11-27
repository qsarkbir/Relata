# 簡易背景の陸地データ（`land-50m.geojson`）

地図の「簡易背景」（`view.map.background: 'simple'`）が使う、世界の陸地の輪郭。簡易背景を選んだときだけ、このサイトから読み込む（設計書 D-51）。外部の地図サーバーには通信しない。

## 出典とライセンス

- **Natural Earth** の「Land」1:50m（バージョン 4.1.0）。https://www.naturalearthdata.com/
- Natural Earth のデータは**パブリックドメイン**（https://www.naturalearthdata.com/about/terms-of-use/ 。利用に帰属表示は要らないが、地図の右下に「Natural Earth」と出す）。
- 入手は、Natural Earth を TopoJSON にして再配布している npm パッケージ `world-atlas@2.0.2`（ISC ライセンス、Michael Bostock）の `land-50m.json`。このパッケージのライセンスの文（著作権表示と許諾文）は `LICENSE-world-atlas.txt` に置いた。

## 変換の手順（一度だけ行った。アプリの依存には足していない）

使った版: `world-atlas@2.0.2`、`topojson-client@3.1.0`（ISC。変換にだけ使い、配布していない）。

1. 作業用の空のフォルダで `npm pack world-atlas@2.0.2` と `npm pack topojson-client@3.1.0` を取り、展開する。
2. 次の Node.js のスクリプト（`node convert.cjs <topojson-client.js> <land-50m.json> <出力.geojson>`）で、TopoJSON を GeoJSON に変換する。
   - 座標は小数点以下 2 桁（約 1 km。1:50m の精度に対して十分）に丸めて容量を減らす。
   - **日付変更線（経度 ±180°）をまたぐ陸地を切り直す**。world-atlas は球面の規約で、ユーラシア（チュクチ半島）などの環が、東端（約 180°）から西端（約 -180°）へ跳ぶ。平面の塗りでは、この跳びが地図を横切る長い辺になり、MapLibre の三角形分割が壊れて、海の色の長方形や三角形が陸に出る（T3-03b で見つけた不具合）。跳びのある環は、経度を 360° ずらして連続させ、180° の縦線で東西に切って 2 つの多角形にする。南極大陸だけは、環が 1 か所の跳びで閉じ、穴が極の線なので、海岸線の両端を南端（-90°）でつなぎ直す（メルカトルの範囲 ±85.05° の外）。

```js
// 使い方: node convert2.cjs <topojson-client.js> <land-50m.json> <出力.geojson>
// world-atlas の陸地（球面の規約の GeoJSON）を、MapLibre の平面の塗りで壊れない GeoJSON にする。
const fs = require('fs');
const [, , tcPath, inPath, outPath] = process.argv;
const topojson = require(tcPath);
const topo = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const fc = topojson.feature(topo, topo.objects.land);
const feature = fc.type === 'FeatureCollection' ? fc.features[0] : fc;
const polygons = feature.geometry.coordinates; // MultiPolygon

// 環の経度を、日付変更線をまたぐ所で 360 度ずらして連続させる（環が閉じる 2 か所の跳びが対象）。
function unwrap(ring) {
  let offset = 0;
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  // 大半の点が [-180, 180] に入るように、全体を 360 度ずらす。
  const inRange = (s) => out.filter((p) => p[0] + s >= -180 && p[0] + s <= 180).length;
  const shift = [0, 360, -360].reduce((best, s) => (inRange(s) > inRange(best) ? s : best), 0);
  return out.map((p) => [p[0] + shift, p[1]]);
}
// 経度 c の縦線で、環を片側に切る（Sutherland-Hodgman）。keepLess なら x <= c 側。
function clip(ring, c, keepLess) {
  const inside = (p) => (keepLess ? p[0] <= c : p[0] >= c);
  const cross = (a, b) => [c, a[1] + ((b[1] - a[1]) * (c - a[0])) / (b[0] - a[0])];
  const pts = ring.slice(0, -1);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (inside(a)) {
      out.push(a);
      if (!inside(b)) out.push(cross(a, b));
    } else if (inside(b)) out.push(cross(a, b));
  }
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}
const hasJump = (ring) => ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);

const result = [];
polygons.forEach((poly, index) => {
  let outer = poly[0];
  let holes = poly.slice(1);
  if (index === 1379) {
    // 南極大陸: 環が 1 か所の跳びで閉じ、穴は極の線。海岸線の両端を南の端（-90）でつなぎ直す。
    holes = [];
    const coast = outer.slice(0, -1);
    outer = [...coast, [180, -90], [-180, -90], coast[0]];
  } else if (hasJump(outer)) {
    const u = unwrap(outer);
    const west = clip(u, 180, true);
    const east = clip(u, 180, false);
    if (west) result.push([west, ...holes]);
    if (east) result.push([east.map((p) => [p[0] - 360, p[1]])]);
    return;
  }
  result.push([outer, ...holes]);
});

const r = (n) => Math.round(n * 100) / 100;
const walk = (c) => (typeof c[0] === 'number' ? [r(c[0]), r(c[1])] : c.map(walk));
const geo = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: walk(result) },
    },
  ],
};
fs.writeFileSync(outPath, JSON.stringify(geo));
console.log('polygons', result.length);
```

3. 出力を `public/geo/land-50m.geojson` に置く。

大きさ: 897,819 バイト（約 877 KB。gzip で約 258 KB）。
SHA-256: `6b0e6311daca96fd062c91f1beed94576a89d113a805be31ff4f4b0014d95909`
