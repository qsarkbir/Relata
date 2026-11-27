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
   - **日付変更線（経度 ±180°）をまたぐ陸地を切り直す**。world-atlas は球面の規約で、ユーラシア（チュクチ半島）などの環が、東端（約 180°）から西端（約 -180°）へ跳ぶ。平面の塗りでは、この跳びが地図を横切る長い辺になり、MapLibre の三角形分割が壊れて、海の色の長方形や三角形が陸に出る（T3-03b で見つけた不具合）。跳びのある環は、経度を 360° ずらして連続させ、幅 360° の帯（-180°〜180° を基準に、帯の番号 k ごと）で切って、k の分だけ戻す。基準を「頂点の多い側」で選ぶと、西経側の頂点が多い島（ウランゲリ島）で東経側が -180° を下回って残るので、そうしない。出力の座標が経度 [-180, 180]、緯度 [-90, 90] に入ることは、スクリプトの末尾と単体テスト で確かめる。南極大陸だけは、環が 1 か所の跳びで閉じ、穴が極の線なので、海岸線の両端を南端（-90°）でつなぎ直す（メルカトルの範囲 ±85.05° の外）。

```js
// 使い方: node convert.cjs <topojson-client.js> <land-50m.json> <出力.geojson>
// world-atlas の陸地（球面の規約の GeoJSON）を、MapLibre の平面の塗りで壊れない GeoJSON にする。
// 出力のすべての座標が経度 [-180, 180]、緯度 [-90, 90] に入る。
const fs = require('fs');
const [, , tcPath, inPath, outPath] = process.argv;
const topojson = require(tcPath);
const topo = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const fc = topojson.feature(topo, topo.objects.land);
const feature = fc.type === 'FeatureCollection' ? fc.features[0] : fc;
const polygons = feature.geometry.coordinates; // MultiPolygon

// 環の経度を、日付変更線をまたぐ所で 360 度ずらして連続させる（環が閉じる 2 か所の跳びが対象）。
// 全体を [-180, 180] に戻すずらしは、ここでは選ばない。選ぶと、西経側の点が多い島（ウランゲリ島）で
// 東経側の部分が -180 を下回ったまま残る。範囲に収めるのは、下の clipToStrips に任せる。
function unwrap(ring) {
  let offset = 0;
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
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
// 連続にした環を、幅 360 度の帯 [-180+360k, 180+360k] ごとに切り、帯の番号 k の分だけ戻す。
// 基準を「頂点の多い側」で選ばず、どの帯でも同じ手順で切るので、島がどちら側に偏っても両側が残る。
function clipToStrips(u) {
  const xs = u.map((p) => p[0]);
  const kMin = Math.floor((Math.min(...xs) + 180) / 360);
  const kMax = Math.floor((Math.max(...xs) + 180) / 360);
  const parts = [];
  for (let k = kMin; k <= kMax; k++) {
    const lo = -180 + 360 * k;
    const hi = 180 + 360 * k;
    const a = clip(u, hi, true);
    const b = a && clip(a, lo, false);
    if (b) parts.push(b.map((p) => [p[0] - 360 * k, p[1]]));
  }
  return parts;
}
// 点が環の中にあるか（偶奇の規則。光線を右へ飛ばして辺と交わる数を数える）。
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
const jumps = (ring) =>
  ring.filter((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180).length;

const result = [];
let antarctica = 0;
polygons.forEach((poly) => {
  let outer = poly[0];
  let holes = poly.slice(1);
  const minLat = Math.min(...outer.map((p) => p[1]));
  if (minLat < -60 && jumps(outer) === 1) {
    // 南極大陸: 環が 1 か所の跳びで閉じ、穴は極の線。海岸線の両端を南の端（-90）でつなぎ直す。
    // 【なぜ】性質（南緯 60 度より南で、跳びが 1 回）で選ぶ。配列の番号（land-50m.json では 1379）は
    // 版が変わると合わなくなる。該当が 1 つでなければ、下で止める。
    antarctica++;
    holes = [];
    const coast = outer.slice(0, -1);
    outer = [...coast, [180, -90], [-180, -90], coast[0]];
  } else if (jumps(outer) > 0) {
    // 跳びのある環は、連続にしてから帯ごとに切る。
    // 穴（ユーラシアのカスピ海など）は、跳びを持たない（確かめる）。穴の最初の点を含む部分に付ける。
    const parts = clipToStrips(unwrap(outer)).map((part) => [part]);
    for (const hole of holes) {
      if (jumps(hole) > 0) throw new Error('跳びのある穴は未対応');
      const owner = parts.find((pp) => inRing(hole[0], pp[0]));
      if (!owner) throw new Error('穴を含む部分が見つからない');
      owner.push(hole);
    }
    result.push(...parts);
    return;
  }
  result.push([outer, ...holes]);
});
if (antarctica !== 1)
  throw new Error('南極大陸の環が ' + antarctica + ' 個見つかった（1 個のはず）');

const r = (n) => Math.round(n * 100) / 100;
const walk = (c) => (typeof c[0] === 'number' ? [r(c[0]), r(c[1])] : c.map(walk));
const out = walk(result);
// 出力の検査: 範囲を外れた座標があれば止める。
for (const poly of out)
  for (const ring of poly)
    for (const [x, y] of ring) {
      if (x < -180 || x > 180 || y < -90 || y > 90) throw new Error('範囲外: ' + x + ',' + y);
    }
const geo = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: out } },
  ],
};
fs.writeFileSync(outPath, JSON.stringify(geo));
console.log('polygons', result.length);
```

3. 出力を `public/geo/land-50m.geojson` に置く。

大きさ: 897,895 バイト（約 877 KB。gzip -6 で 262,843 バイト、約 257 KB）。
SHA-256: `a4ebb3831ffdb071dbcc6179d61ece3a3f07f62ceea965a436d93e657b47d499`
