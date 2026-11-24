/** GraphML の書き出し（FR-OUT-05）。仕様: GraphML Primer（graphml.graphdrawing.org）。 */
import type { RelataGraph } from '../../core/graph';
import type { Dataset } from '../../core/model';
import { buildNetworkTable } from './network';
import type { NetworkColumn, NetworkTable, NetworkValue } from './network';
import { hexColor, num } from './visual';
import type { EdgeVisual, NetworkVisual, NodeVisual, VisualShape } from './visual';
import { xmlAttr, xmlText } from './xml';

// 値を GraphML の本文にする。真偽値は `true`、`false`。
function valueText(v: NetworkValue): string {
  return typeof v === 'string' ? xmlText(v) : String(v);
}

// 【TS】`as const satisfies Record<K, string>`: `as const` で値を文字列リテラルの型に固定し、
//       `satisfies` で「列の型（K）のすべてに値がある」ことだけを検査する（足し忘れは型エラー）。
/** GraphML の `attr.type`。整数は `int`、実数は `double`。 */
const GRAPHML_TYPE = {
  string: 'string',
  double: 'double',
  integer: 'int',
  boolean: 'boolean',
} as const satisfies Record<NetworkColumn['type'], string>;

// yFiles の図形名。
const YFILES_SHAPE = {
  circle: 'ellipse',
  square: 'rectangle',
  triangle: 'triangle',
  diamond: 'diamond',
} as const satisfies Record<VisualShape, string>;

/**
 * yFiles（yEd、yFiles の GraphML ビューア）のノードの図形。
 *
 * `y:Geometry` の x、y は、中心ではなく左上の角。y は下向きに増える（SVG と同じ）ので、
 * シーンの座標をそのまま使える（Gephi は y が上向きなので、`y` の属性は符号を反転する。下の説明を見よ）。
 * ラベルはノードの下（`sides`、`s`）に置く。ノードの中に置くと、長いアラビア文字のラベルが丸からはみ出す。
 * アラビア文字の向きは、yEd が文字から判断して描く（ここでは書式を指定しない）。
 *
 * @param label - ノードのラベル
 * @param v - ノードの表示情報
 * @returns `<y:ShapeNode>` の XML 断片
 */
function yNode(label: string, v: NodeVisual): string {
  const size = Math.max(2 * v.r, 4);
  const fontSize = 12;
  // 【なぜ】yEd は `autoSizePolicy="content"` で大きさを計算し直すが、初期値が無い読み手のために概算を書く。
  const labelWidth = Math.max(label.length * 7 + 8, 10);
  return [
    '<y:ShapeNode>',
    `<y:Geometry x="${num(v.x - size / 2)}" y="${num(v.y - size / 2)}" width="${num(size)}" height="${num(size)}"/>`,
    `<y:Fill color="${hexColor(v.color)}" transparent="false"/>`,
    '<y:BorderStyle color="#000000" type="line" width="1.0"/>',
    `<y:NodeLabel alignment="center" autoSizePolicy="content" fontFamily="Dialog" fontSize="${String(fontSize)}" fontStyle="plain" hasBackgroundColor="false" hasLineColor="false" horizontalTextPosition="center" modelName="sides" modelPosition="s" textColor="#000000" verticalTextPosition="bottom" visible="true" width="${num(labelWidth)}" height="${String(fontSize + 8)}">${xmlText(label)}</y:NodeLabel>`,
    `<y:Shape type="${YFILES_SHAPE[v.shape]}"/>`,
    '</y:ShapeNode>',
  ].join('');
}

/**
 * yFiles のエッジの図形。矢印は有向のエッジの終点側（target）だけに付ける。
 *
 * @param directed - 有向か
 * @param v - エッジの表示情報
 * @returns `<y:PolyLineEdge>` の XML 断片
 */
function yEdge(directed: boolean, v: EdgeVisual): string {
  return [
    '<y:PolyLineEdge>',
    '<y:Path sx="0.0" sy="0.0" tx="0.0" ty="0.0"/>',
    `<y:LineStyle color="${hexColor(v.color)}" type="line" width="${num(Math.max(v.width, 0.5))}"/>`,
    `<y:Arrows source="none" target="${directed ? 'standard' : 'none'}"/>`,
    '<y:BendStyle smoothed="false"/>',
    '</y:PolyLineEdge>',
  ].join('');
}

/**
 * 書き出し用の表を GraphML の文字列にする。
 *
 * 構造: `<key>`（属性の宣言）、`<graph>`、`<node>`、`<edge>`。ノードの ID は元の ID をそのまま使い、
 * 読み戻したときに元のデータと突き合わせられるようにする（Gephi、NetworkX、yEd は任意の文字列の ID を受け付ける）。
 * ラベルは `label` の列に入れる。エッジの向きは、全体が有向か無向なら `edgedefault` に、混在のときは
 * 各エッジの `directed` に書く。文字は UTF-8 のまま（アラビア文字を実体参照にしない）。
 *
 * 表示情報（`visual`）があれば、外部のビューアが図の見た目で開けるように 2 通りで書く（FR-OUT-05）。
 * - yFiles の拡張（yEd、yFiles の GraphML ビューア）: ノードは `y:ShapeNode`（位置、大きさ、形、塗り、ラベル）、
 *   エッジは `y:PolyLineEdge`（線の色と太さ、矢印）。`yfiles.type="nodegraphics"` と `"edgegraphics"` のキーに入れる。
 * - 属性 `x`、`y`、`size`、`r`、`g`、`b`（Gephi と NetworkX が読む）。
 *
 * 【なぜ y の向きが 2 通りか】シーンの座標は SVG と同じ y 下向き。yEd も y 下向き（画面の座標）なので、
 * `y:Geometry` はそのまま書く。Gephi は y 上向き（数学の座標）で、そのまま読むと図が上下に反転して見える。
 * そこで属性 `y` は符号を反転して書く（Gephi の読み込みの挙動は資料からの推測で、実機では未確認）。
 * NetworkX の `pos` に使うと matplotlib の y 上向きに合うので、同じく画面と同じ向きに見える。
 * 計算量: 出力の大きさに比例。
 *
 * @param table - 書き出し用の表
 * @param visual - 表示情報。省略すると、属性と構造だけを書く
 * @returns XML 宣言つきの GraphML
 */
export function graphmlFromTable(table: NetworkTable, visual?: NetworkVisual): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  // 【なぜ】xsi と schemaLocation は GraphML の標準のヘッダ。検証や形式の判定をするビューアが見る。
  // yFiles の名前空間は、使うとき（表示情報があるとき）だけ宣言する。
  const yns = visual === undefined ? '' : '\n         xmlns:y="http://www.yworks.com/xml/graphml"';
  out.push(
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"' +
      '\n         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      yns +
      '\n         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
  );
  // 【なぜ】キーの id は、ノードとエッジで別の接頭辞（n、e）の連番にしてあるので衝突しない。
  const labelKey = 'nlabel';
  out.push(`  <key id="${labelKey}" for="node" attr.name="label" attr.type="string"/>`);
  const keyFor = (c: NetworkColumn): string =>
    `  <key id="${xmlAttr(c.id)}" for="${c.target}" attr.name="${xmlAttr(c.name)}" attr.type="${GRAPHML_TYPE[c.type]}"/>`;
  for (const c of table.nodeColumns) out.push(keyFor(c));
  if (visual !== undefined) {
    out.push('  <key id="ynode" for="node" yfiles.type="nodegraphics"/>');
    out.push('  <key id="yedge" for="edge" yfiles.type="edgegraphics"/>');
    out.push('  <key id="nx" for="node" attr.name="x" attr.type="double"/>');
    out.push('  <key id="ny" for="node" attr.name="y" attr.type="double"/>');
    out.push('  <key id="nsize" for="node" attr.name="size" attr.type="double"/>');
    for (const k of ['r', 'g', 'b'])
      out.push(`  <key id="n${k}" for="node" attr.name="${k}" attr.type="int"/>`);
  }
  const hasTime = table.hasTime;
  if (hasTime) {
    out.push('  <key id="nstart" for="node" attr.name="start" attr.type="string"/>');
    out.push('  <key id="nend" for="node" attr.name="end" attr.type="string"/>');
  }
  for (const c of table.edgeColumns) out.push(keyFor(c));
  if (hasTime) {
    out.push('  <key id="estart" for="edge" attr.name="start" attr.type="string"/>');
    out.push('  <key id="eend" for="edge" attr.name="end" attr.type="string"/>');
  }
  // 混在のときの既定は無向にし、有向のエッジだけ `directed="true"` を書く。
  const edgedefault = table.edgeDefault === 'directed' ? 'directed' : 'undirected';
  out.push(`  <graph id="G" edgedefault="${edgedefault}">`);
  for (const n of table.nodes) {
    out.push(`    <node id="${xmlAttr(n.id)}">`);
    out.push(`      <data key="${labelKey}">${xmlText(n.label)}</data>`);
    for (const c of table.nodeColumns) {
      const v = n.values.get(c.id);
      if (v !== undefined) out.push(`      <data key="${xmlAttr(c.id)}">${valueText(v)}</data>`);
    }
    if (n.start !== undefined) out.push(`      <data key="nstart">${n.start}</data>`);
    if (n.end !== undefined) out.push(`      <data key="nend">${n.end}</data>`);
    const nv = visual?.nodes.get(n.id);
    if (nv !== undefined) {
      out.push(`      <data key="ynode">${yNode(n.label, nv)}</data>`);
      out.push(`      <data key="nx">${num(nv.x)}</data>`);
      // y の向きは関数の説明を参照（Gephi は y 上向きなので符号を反転する）。
      out.push(`      <data key="ny">${num(-nv.y)}</data>`);
      out.push(`      <data key="nsize">${num(2 * nv.r)}</data>`);
      out.push(`      <data key="nr">${String(nv.color.r)}</data>`);
      out.push(`      <data key="ng">${String(nv.color.g)}</data>`);
      out.push(`      <data key="nb">${String(nv.color.b)}</data>`);
    }
    out.push('    </node>');
  }
  for (const e of table.edges) {
    const directed =
      e.directed !== (edgedefault === 'directed') ? ` directed="${String(e.directed)}"` : '';
    out.push(
      `    <edge id="${xmlAttr(e.id)}" source="${xmlAttr(e.source)}" target="${xmlAttr(e.target)}"${directed}>`,
    );
    for (const c of table.edgeColumns) {
      const v = e.values.get(c.id);
      if (v !== undefined) out.push(`      <data key="${xmlAttr(c.id)}">${valueText(v)}</data>`);
    }
    if (e.start !== undefined) out.push(`      <data key="estart">${e.start}</data>`);
    if (e.end !== undefined) out.push(`      <data key="eend">${e.end}</data>`);
    const ev = visual?.edges.get(e.graphKey);
    if (ev !== undefined) out.push(`      <data key="yedge">${yEdge(e.directed, ev)}</data>`);
    out.push('    </edge>');
  }
  out.push('  </graph>', '</graphml>', '');
  return out.join('\n');
}

/**
 * 表示中のグラフを GraphML にする。
 *
 * @param dataset - 元のデータセット
 * @param graph - 表示中のグラフ
 * @param visual - 図の位置・大きさ・色（`visualFromScene`）。図が無いときは省略する
 * @returns GraphML の文字列
 */
export function exportGraphml(
  dataset: Dataset,
  graph: RelataGraph,
  visual?: NetworkVisual,
): string {
  return graphmlFromTable(
    buildNetworkTable(dataset, graph, { reserveVisualNames: visual !== undefined }),
    visual,
  );
}
