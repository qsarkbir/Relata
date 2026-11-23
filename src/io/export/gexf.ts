/** GEXF 1.3 の書き出し（FR-OUT-05）。仕様: gexf.net/1.3。 */
import type { RelataGraph } from '../../core/graph';
import type { Dataset } from '../../core/model';
import { buildNetworkTable } from './network';
import type { NetworkColumn, NetworkTable, NetworkValue } from './network';
import { xmlAttr } from './xml';

const GEXF_TYPE = {
  string: 'string',
  double: 'double',
  integer: 'integer',
  boolean: 'boolean',
} as const satisfies Record<NetworkColumn['type'], string>;

// GEXF の属性値は XML の属性なので、文字列は属性用にエスケープする。
function valueAttr(v: NetworkValue): string {
  return xmlAttr(String(v));
}

/** GEXF の書き出しの選択肢。 */
export interface GexfOptions {
  /** `<meta lastmodifieddate>` に入れる日付（`YYYY-MM-DD`）。省略すると書かない（io は Date を使わない）。 */
  readonly modifiedDate?: string;
}

/**
 * 書き出し用の表を GEXF 1.3 の文字列にする。
 *
 * 期間を持つノードかエッジがあれば動的グラフ（`mode="dynamic"`、`timeformat="date"`）にし、
 * `start` と `end` を ISO 8601 の日付で書く。GEXF の spells（複数の区間）は使わず、
 * 最も広い範囲の 1 区間にする（network.ts の方針）。エッジの重みは GEXF 標準の `weight`、関係名は `label` に書く。
 * 計算量: 出力の大きさに比例。
 *
 * @param table - 書き出し用の表
 * @param options - 選択肢
 * @returns XML 宣言つきの GEXF
 */
export function gexfFromTable(table: NetworkTable, options: GexfOptions = {}): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push('<gexf xmlns="http://gexf.net/1.3" version="1.3">');
  const date =
    options.modifiedDate === undefined
      ? ''
      : ` lastmodifieddate="${xmlAttr(options.modifiedDate)}"`;
  out.push(
    `  <meta${date}>`,
    '    <creator>Relata</creator>',
    `    <description>${xmlAttr(table.title)}</description>`,
    '  </meta>',
  );
  const mode = table.hasTime ? 'dynamic' : 'static';
  const extra = table.hasTime ? ' timeformat="date"' : '';
  out.push(`  <graph defaultedgetype="${table.edgeDefault}" mode="${mode}"${extra}>`);
  // エッジの weight と label は GEXF の標準の項目なので、属性の列からは除く。
  const edgeColumns = table.edgeColumns.filter((c) => c.name !== 'weight' && c.name !== 'relation');
  const declare = (cls: 'node' | 'edge', cols: readonly NetworkColumn[]): void => {
    if (cols.length === 0) return;
    out.push(`    <attributes class="${cls}" mode="static">`);
    for (const c of cols)
      out.push(
        `      <attribute id="${xmlAttr(c.id)}" title="${xmlAttr(c.name)}" type="${GEXF_TYPE[c.type]}"/>`,
      );
    out.push('    </attributes>');
  };
  declare('node', table.nodeColumns);
  declare('edge', edgeColumns);
  const span = (s: string | undefined, e: string | undefined): string =>
    (s === undefined ? '' : ` start="${s}"`) + (e === undefined ? '' : ` end="${e}"`);
  const attvalues = (
    cols: readonly NetworkColumn[],
    values: ReadonlyMap<string, NetworkValue>,
  ): void => {
    const lines: string[] = [];
    for (const c of cols) {
      const v = values.get(c.id);
      if (v !== undefined)
        lines.push(`            <attvalue for="${xmlAttr(c.id)}" value="${valueAttr(v)}"/>`);
    }
    if (lines.length === 0) return;
    out.push('          <attvalues>', ...lines);
    out.push('          </attvalues>');
  };
  out.push('    <nodes>');
  for (const n of table.nodes) {
    out.push(
      `      <node id="${xmlAttr(n.id)}" label="${xmlAttr(n.label)}"${span(n.start, n.end)}>`,
    );
    attvalues(table.nodeColumns, n.values);
    out.push('      </node>');
  }
  out.push('    </nodes>', '    <edges>');
  for (const e of table.edges) {
    const label = e.label === undefined ? '' : ` label="${xmlAttr(e.label)}"`;
    out.push(
      `      <edge id="${xmlAttr(e.id)}" source="${xmlAttr(e.source)}" target="${xmlAttr(e.target)}"` +
        ` type="${e.directed ? 'directed' : 'undirected'}" weight="${String(e.weight)}"${label}${span(e.start, e.end)}>`,
    );
    attvalues(edgeColumns, e.values);
    out.push('      </edge>');
  }
  out.push('    </edges>', '  </graph>', '</gexf>', '');
  return out.join('\n');
}

/**
 * 表示中のグラフを GEXF にする。
 *
 * @param dataset - 元のデータセット
 * @param graph - 表示中のグラフ
 * @param options - 選択肢
 * @returns GEXF の文字列
 */
export function exportGexf(
  dataset: Dataset,
  graph: RelataGraph,
  options: GexfOptions = {},
): string {
  return gexfFromTable(buildNetworkTable(dataset, graph), options);
}
