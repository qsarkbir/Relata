"""指標の正解値を networkx で作る（T1-09、FR-MT-01、FR-MT-02、設計書 §7.3、D-30）。

使い方（リポジトリの直下で）:
    python tests/golden/metrics/generate.py
    npx prettier --write tests/golden/metrics/golden.json

Python と networkx は正解値の生成にだけ使う（設計書 §17）。出力の JSON に networkx の版を記録する。

# グラフの規約（src/core/metrics/ のコメントと同じ）
- Relata のグラフは、同じ 2 点間のエッジを 1 本にまとめた単純グラフ（自己ループは許す）。
- 混在グラフ: 無向エッジを「両向きの 2 本の有向エッジ」とみなす（D-30）。無向の自己ループは
  向きのある自己ループ 1 本にする。networkx では DiGraph に変換して計算する。同じ 2 点間に無向と有向の
  エッジがあれば 1 本の弧にまとめ、重みを足す（ケース mixed_overlap）。
- 重み 0 のエッジ: 次数、媒介、近接（重みを使わない）では普通のエッジ。PageRank、固有ベクトル、HITS では
  重み 0 の弧は何も足さない（ケース *_zero_*）。HITS は重みの合計が 0 だと定義されないので、正解値に
  hubs と authorities を置かず、`hitsDefined: false` と書く。
- k-core、クラスタ係数、推移性: 向きと自己ループを無視した単純な無向グラフ（`to_undirected()`、
  自己ループを除去）で計算する。networkx の core_number は自己ループがあると例外になるため。
- 連結成分: 有向と混在は弱連結成分（`weakly_connected_components`）、無向は `connected_components`。

# 各指標の networkx の対応関数と正規化
- 次数: `G.degree`。無向の自己ループは 2 と数える。有向は in + out（自己ループは入と出に 1 ずつ）。
- 重み付き次数: `G.degree(weight='weight')`（同じ数え方）。
- 媒介中心性: `betweenness_centrality(G, normalized=True, weight=None)`。重みを使わない（ホップ数。D-30）。
  正規化は 1 / ((n-1)(n-2))（有向、無向とも。無向は対の二重計上が約分される）。
- 近接中心性: `closeness_centrality(G, wf_improved=True)`（既定）。重みなし。有向は「他の点から自分への」
  距離（入）。出は `G.reverse()` で求める。非連結では Wasserman-Faust の補正（到達できる点の割合を掛ける）。
- PageRank: `pagerank(G, alpha=0.85, weight='weight', tol=1e-14, max_iter=10000)`。
  行き止まりの点は全ノードに一様に配る。
- 固有ベクトル中心性（無向のみ）: `eigenvector_centrality(G, weight='weight', tol=1e-12)`。L2 正規化。
- HITS（有向、混在）: `hits(G, tol=1e-14, normalized=True)`。ハブと権威は、それぞれ総和 1。
- k-core: `core_number`。クラスタ係数: `clustering(G)`（重みなし）。
- 密度: `density(G)`（無向 2m/(n(n-1))、有向 m/(n(n-1))。自己ループも m に数える）。
  混在は DiGraph（無向 1 本を 2 本と数える）での値。n < 2 は 0。
- 平均次数: 有向と混在は m/n（混在は DiGraph の m）、無向は 2m/n。
- 推移性: `transitivity(単純な無向グラフ)`。三角形がないときは 0。
- 相互性: `overall_reciprocity(有向エッジだけの DiGraph)`。混在では無向エッジを数えない。
"""

import json
import sys

import networkx as nx

# エッジは (source, target, weight)。type は "directed" / "undirected" / "mixed"。
# 混在では 4 番目に directed の真偽を持つ。
CASES = {
    "undirected_weighted": {
        "type": "undirected",
        "nodes": ["a", "b", "c", "d", "e", "f", "g"],
        "edges": [
            ("a", "b", 1), ("b", "c", 2), ("a", "c", 3), ("c", "d", 1),
            ("d", "e", 4), ("e", "f", 1), ("d", "f", 2), ("f", "g", 1),
        ],
    },
    "undirected_selfloop": {
        "type": "undirected",
        "nodes": ["a", "b", "c", "d", "e"],
        "edges": [
            ("a", "a", 2), ("a", "b", 1), ("b", "c", 1), ("c", "a", 3),
            ("c", "d", 1), ("d", "e", 2), ("e", "e", 1),
        ],
    },
    "undirected_disconnected": {
        # 2 つの成分（三角形つきの塊と 4 点の道）と、孤立ノード 2 つ。
        "type": "undirected",
        "nodes": ["a", "b", "c", "d", "p", "q", "r", "s", "iso1", "iso2"],
        "edges": [
            ("a", "b", 1), ("b", "c", 1), ("c", "a", 1), ("c", "d", 2),
            ("p", "q", 1), ("q", "r", 1), ("r", "s", 1),
        ],
    },
    "bipartite": {
        # 人（p1〜p3）と場所（l1〜l4）の二部グラフ。
        "type": "undirected",
        "nodes": ["p1", "p2", "p3", "l1", "l2", "l3", "l4"],
        "edges": [
            ("p1", "l1", 1), ("p1", "l2", 2), ("p2", "l2", 1), ("p2", "l3", 1),
            ("p3", "l3", 3), ("p3", "l4", 1), ("p1", "l4", 1),
        ],
    },
    "directed_weighted": {
        # 往復の対（a-b、c-d）、行き止まり（g）、自己ループ（e）を含む。
        "type": "directed",
        "nodes": ["a", "b", "c", "d", "e", "f", "g"],
        "edges": [
            ("a", "b", 1), ("b", "a", 2), ("b", "c", 1), ("c", "d", 1),
            ("d", "c", 1), ("d", "e", 2), ("e", "e", 2), ("e", "f", 1),
            ("f", "b", 2), ("f", "g", 1), ("a", "f", 3),
        ],
    },
    "directed_disconnected": {
        # 弱連結成分が 3 つ（塊、2 点、孤立 1 点）。
        "type": "directed",
        "nodes": ["a", "b", "c", "d", "x", "y", "z"],
        "edges": [
            ("a", "b", 1), ("b", "c", 1), ("c", "a", 1), ("c", "d", 1),
            ("x", "y", 2),
        ],
    },
    "mixed_overlap": {
        # 無向 a-b（1）と有向 a→b（2）が同じ 2 点間にある。弧 a→b は 3、弧 b→a は 1 になる。
        "type": "mixed",
        "nodes": ["a", "b", "c", "d"],
        "edges": [
            ("a", "b", 1, False), ("a", "b", 2, True), ("b", "c", 1, True),
            ("c", "d", 2, False), ("d", "a", 1, True),
        ],
    },
    "undirected_zero_partial": {
        # 重み 0 のエッジが 2 本。a は重み 0 のエッジだけを持つ。
        "type": "undirected",
        "nodes": ["a", "b", "c", "d", "e"],
        "edges": [
            ("a", "b", 0, False), ("b", "c", 2, False), ("c", "d", 1, False),
            ("d", "e", 0, False), ("c", "e", 3, False),
        ],
    },
    "undirected_zero_all": {
        "type": "undirected",
        "nodes": ["a", "b", "c", "d"],
        "edges": [("a", "b", 0, False), ("b", "c", 0, False), ("c", "d", 0, False)],
    },
    "directed_zero_partial": {
        # a は出る重みが 0 だけ（PageRank では行き止まり）。
        "type": "directed",
        "nodes": ["a", "b", "c", "d", "e"],
        "edges": [
            ("a", "b", 0, True), ("b", "c", 2, True), ("c", "d", 1, True),
            ("d", "b", 3, True), ("d", "e", 0, True), ("e", "c", 1, True),
        ],
    },
    "directed_zero_all": {
        "type": "directed",
        "nodes": ["a", "b", "c"],
        "edges": [("a", "b", 0, True), ("b", "c", 0, True)],
    },
    "mixed": {
        # 無向 3 本（うち自己ループ 1）と有向 5 本（往復 1 対を含む）。
        "type": "mixed",
        "nodes": ["a", "b", "c", "d", "e", "f"],
        "edges": [
            ("a", "b", 1, False), ("b", "c", 2, False), ("c", "c", 1, False),
            ("c", "d", 1, True), ("d", "e", 2, True), ("e", "d", 1, True),
            ("e", "f", 1, True), ("f", "a", 3, True),
        ],
    },
}


def build_simple_undirected(case):
    """向きと自己ループを無視した単純な無向グラフ。"""
    g = nx.Graph()
    g.add_nodes_from(case["nodes"])
    for e in case["edges"]:
        if e[0] != e[1]:
            g.add_edge(e[0], e[1])
    return g


def build_main(case):
    """指標の本体に使うグラフ。混在は DiGraph（無向は両向き）にする。"""
    t = case["type"]
    g = nx.Graph() if t == "undirected" else nx.DiGraph()
    g.add_nodes_from(case["nodes"])

    def add(s, d, w):
        # 同じ弧が重なったら、重みを足す。
        if g.has_edge(s, d):
            g[s][d]["weight"] += w
        else:
            g.add_edge(s, d, weight=w)

    for e in case["edges"]:
        s, d, w = e[0], e[1], e[2]
        if t == "mixed" and not e[3]:
            add(s, d, w)
            if s != d:
                add(d, s, w)
        else:
            add(s, d, w)
    return g


def compute(case):
    t = case["type"]
    g = build_main(case)
    simple = build_simple_undirected(case)
    directed = t != "undirected"
    nodes = case["nodes"]

    node = {}
    hits_defined = True
    if directed:
        node["degreeIn"] = dict(g.in_degree())
        node["degreeOut"] = dict(g.out_degree())
        node["degree"] = dict(g.degree())
        node["weightedDegreeIn"] = dict(g.in_degree(weight="weight"))
        node["weightedDegreeOut"] = dict(g.out_degree(weight="weight"))
        node["weightedDegree"] = dict(g.degree(weight="weight"))
        node["closenessOut"] = nx.closeness_centrality(g.reverse())
        hits_defined = sum(w for _, _, w in g.edges(data="weight")) > 0
        if hits_defined:
            hubs, auths = nx.hits(g, max_iter=100000, tol=1e-14, normalized=True)
            node["hubs"] = hubs
            node["authorities"] = auths
    else:
        node["degree"] = dict(g.degree())
        node["weightedDegree"] = dict(g.degree(weight="weight"))
        node["eigenvector"] = nx.eigenvector_centrality(
            g, max_iter=100000, tol=1e-12, weight="weight"
        )
    node["betweenness"] = nx.betweenness_centrality(g, normalized=True, weight=None)
    node["closeness"] = nx.closeness_centrality(g)
    node["pagerank"] = nx.pagerank(g, alpha=0.85, weight="weight", tol=1e-14, max_iter=10000)
    node["kCore"] = nx.core_number(simple)
    node["clustering"] = nx.clustering(simple)

    n = g.number_of_nodes()
    if t == "mixed":
        # 画面に出すエッジ数は元のエッジ数（無向 1 本は 1 本）。
        edge_count = len(case["edges"])
    else:
        edge_count = g.number_of_edges()
    arcs = g.number_of_edges()
    comps = (
        nx.weakly_connected_components(g) if directed else nx.connected_components(g)
    )
    glob = {
        "nodeCount": n,
        "edgeCount": edge_count,
        "density": nx.density(g),
        "averageDegree": (arcs / n) if directed else (2 * arcs / n),
        "components": len(list(comps)),
        "transitivity": nx.transitivity(simple),
    }
    if directed:
        dg = nx.DiGraph()
        dg.add_nodes_from(nodes)
        for e in case["edges"]:
            if t == "directed" or e[3]:
                dg.add_edge(e[0], e[1])
        glob["reciprocity"] = nx.overall_reciprocity(dg)

    # JSON の順序をノードの順にそろえる。
    node = {k: {nid: v[nid] for nid in nodes} for k, v in node.items()}
    result = {"node": node, "global": glob}
    if directed and not hits_defined:
        result["hitsDefined"] = False
    return result


def main():
    out = {"networkxVersion": nx.__version__, "cases": {}}
    for name, case in CASES.items():
        edges = []
        for e in case["edges"]:
            directed = case["type"] == "directed" or (case["type"] == "mixed" and e[3])
            edges.append(
                {"source": e[0], "target": e[1], "weight": e[2], "directed": directed}
            )
        out["cases"][name] = {
            "type": case["type"],
            "nodes": case["nodes"],
            "edges": edges,
            "expected": compute(case),
        }
    path = sys.argv[1] if len(sys.argv) > 1 else "tests/golden/metrics/golden.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
