/** GraphML の書き出し（FR-OUT-05）。仕様: GraphML Primer（graphml.graphdrawing.org）。 */
import type { RelataGraph } from '../../core/graph';
import type { Dataset } from '../../core/model';
import { buildNetworkTable } from './network';
import type { NetworkColumn, NetworkTable, NetworkValue } from './network';
import { xmlAttr, xmlText } from './xml';

// 値を GraphML の本文にする。真偽値は `true`、`false`。
function valueText(v: NetworkValue): string {
  return typeof v === 'string' ? xmlText(v) : String(v);
}

/** GraphML の `attr.type`。整数は `int`、実数は `double`。 */
const GRAPHML_TYPE = {
  string: 'string',
  double: 'double',
  integer: 'int',
  boolean: 'boolean',
} as const satisfies Record<NetworkColumn['type'], string>;

/**
 * 書き出し用の表を GraphML の文字列にする。
 *
 * 構造: `<key>`（属性の宣言）、`<graph>`、`<node>`、`<edge>`。ノードの ID は元の ID をそのまま使い、
 * 読み戻したときに元のデータと突き合わせられるようにする（Gephi、NetworkX、yEd は任意の文字列の ID を受け付ける）。
 * ラベルは `label` の列に入れる。エッジの向きは、全体が有向か無向なら `edgedefault` に、混在のときは
 * 各エッジの `directed` に書く。文字は UTF-8 のまま（アラビア文字を実体参照にしない）。
 * 計算量: 出力の大きさに比例。
 *
 * @param table - 書き出し用の表
 * @returns XML 宣言つきの GraphML
 */
export function graphmlFromTable(table: NetworkTable): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
  // 【なぜ】キーの id は、ノードとエッジで別の接頭辞（n、e）の連番にしてあるので衝突しない。
  const labelKey = 'nlabel';
  out.push(`  <key id="${labelKey}" for="node" attr.name="label" attr.type="string"/>`);
  const keyFor = (c: NetworkColumn): string =>
    `  <key id="${xmlAttr(c.id)}" for="${c.target}" attr.name="${xmlAttr(c.name)}" attr.type="${GRAPHML_TYPE[c.type]}"/>`;
  for (const c of table.nodeColumns) out.push(keyFor(c));
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
 * @returns GraphML の文字列
 */
export function exportGraphml(dataset: Dataset, graph: RelataGraph): string {
  return graphmlFromTable(buildNetworkTable(dataset, graph));
}
