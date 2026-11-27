/**
 * エッジどうしの互換度と、互換なエッジの組の探索（FR-VG-13、設計書 §8.4）。
 *
 * 出典: Holten, D. & van Wijk, J. J. (2009). "Force-Directed Edge Bundling for Graph
 * Visualization". Computer Graphics Forum 28(3), EuroVis 2009, pp. 983-990.
 *
 * 【規約】向きは互換度に関与しない（角度は |cos| で測る）。逆向きに並ぶエッジの扱い
 * （点の対応の反転）は session.ts で決める。
 * 自己ループと長さ 0 のエッジは、ここへ渡さない（呼び出し側で除く）。
 * 長さには Math.hypot でなく平方根を直接使う（hypot は実行環境で最後の桁が違いうる。
 * しきい値の境目の判定が変わると NFR-08 の再現性が崩れるため）。
 */

/** 互換度の計算に使う、エッジ 1 本の始点と終点の座標。 */
export interface CompatEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** 互換な組。i < j。 */
export interface CompatPair {
  readonly i: number;
  readonly j: number;
  readonly compat: number;
}

/** 互換なエッジの近傍（CSR 形式。エッジ i の近傍は offsets[i] 以上 offsets[i+1] 未満）。 */
// 【TS】`readonly` は代入を禁じる印。`Int32Array` などの型付き配列は、数だけを詰める固定長の配列（軽く、Worker へ送りやすい）。
export interface NeighborTable {
  /** 各エッジの近傍の開始位置（長さ エッジ数 + 1）。エッジ i の近傍は index[offsets[i] 〜 offsets[i+1]) 。 */
  readonly offsets: Int32Array;
  /** 近傍のエッジの番号。 */
  readonly index: Int32Array;
  /** 近傍との互換度。 */
  readonly compat: Float64Array;
  /** しきい値以上の組の総数（上限で切る前）。 */
  readonly pairCount: number;
}

function length(e: CompatEdge): number {
  const dx = e.x2 - e.x1;
  const dy = e.y2 - e.y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// 視認性 V(P, Q): Q を P の直線へ射影した線分が、P の中央にどれだけ向き合うか（0〜1）。
// V = max(1 - 2 |Pm - Im| / |I0 - I1|, 0)（Holten ほか 2009、式 6、7）。
function visibility(p: CompatEdge, q: CompatEdge): number {
  const dx = p.x2 - p.x1;
  const dy = p.y2 - p.y1;
  const lengthP = Math.sqrt(dx * dx + dy * dy);
  // P の向きの単位ベクトルへ、Q の両端を射影した位置（P の始点からの距離）。
  const t0 = ((q.x1 - p.x1) * dx + (q.y1 - p.y1) * dy) / lengthP;
  const t1 = ((q.x2 - p.x1) * dx + (q.y2 - p.y1) * dy) / lengthP;
  const span = Math.abs(t1 - t0);
  if (span === 0) return 0; // 射影が 1 点につぶれる（直交）。向き合わない。
  // |Pm - Im| = |lengthP/2 - (t0 + t1)/2|。両辺を 2 倍して整理した。
  return Math.max(1 - Math.abs(lengthP - t0 - t1) / span, 0);
}

/**
 * 2 本のエッジの互換度 C = Ca · Cs · Cp · Cv（角度・長さ・位置・可視性の積。0〜1）。
 *
 * - Ca = |cos α|: 角度。平行（向きは問わない）なら 1、直交なら 0。
 * - Cs = 2 / (lavg / min(lP, lQ) + max(lP, lQ) / lavg): 長さ。同じ長さなら 1。
 * - Cp = lavg / (lavg + |Pm - Qm|): 位置。中点が近いほど 1。
 * - Cv = min(V(P, Q), V(Q, P)): 可視性。
 *
 * 計算量 O(1)。
 *
 * @param p - 1 本め（長さが 0 でない）
 * @param q - 2 本め（長さが 0 でない）
 * @returns 互換度
 */
export function edgeCompatibility(p: CompatEdge, q: CompatEdge): number {
  const pdx = p.x2 - p.x1;
  const pdy = p.y2 - p.y1;
  const qdx = q.x2 - q.x1;
  const qdy = q.y2 - q.y1;
  const lp = Math.sqrt(pdx * pdx + pdy * pdy);
  const lq = Math.sqrt(qdx * qdx + qdy * qdy);
  const angle = Math.min(Math.abs(pdx * qdx + pdy * qdy) / (lp * lq), 1);
  if (angle === 0) return 0;
  const lavg = (lp + lq) / 2;
  const scale = 2 / (lavg / Math.min(lp, lq) + Math.max(lp, lq) / lavg);
  // 中点は x1/2 + x2/2 の形で出す（大きな座標での桁あふれと丸めを避ける）。
  const mx = p.x1 / 2 + p.x2 / 2 - (q.x1 / 2 + q.x2 / 2);
  const my = p.y1 / 2 + p.y2 / 2 - (q.y1 / 2 + q.y2 / 2);
  const position = lavg / (lavg + Math.sqrt(mx * mx + my * my));
  const vis = Math.min(visibility(p, q), visibility(q, p));
  return angle * scale * position * vis;
}

/**
 * 互換度がしきい値以上の組を、全組の比較で探す（O(n²)）。照合用の基準で、実際の処理では使わない。
 *
 * @param edges - 束ねる対象
 * @param threshold - しきい値
 * @returns 互換な組（i の昇順、同じ i では j の昇順）
 */
export function findCompatiblePairsBruteForce(
  edges: readonly CompatEdge[],
  threshold: number,
): CompatPair[] {
  const pairs: CompatPair[] = [];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      // 【TS】noUncheckedIndexedAccess により edges[i] は undefined を含む。範囲内だが、型を満たすため確かめる。
      const a = edges[i];
      const b = edges[j];
      if (a === undefined || b === undefined) continue;
      const compat = edgeCompatibility(a, b);
      if (compat >= threshold) pairs.push({ i, j, compat });
    }
  }
  return pairs;
}

/**
 * 長さの比の上限 rmax を求める。
 *
 * 互換度の長さの項 Cs が t 以上になる、長い方 / 短い方 の最大値。
 * Cs は比 r = max/min について、Cs(r) = 2 / ((1 + r)/2 + 2r/(1 + r)) と書け、r ≥ 1 で単調に減る。
 * 二分法で Cs(r) = t となる r を求める（回数を固定して決定的にする）。
 *
 * @param threshold - しきい値 t
 * @returns 比の上限（Cs(r) ≥ t を満たす最大の r より、わずかに大きい側）
 */
function maxLengthRatio(threshold: number): number {
  const cs = (r: number): number => 2 / ((1 + r) / 2 + (2 * r) / (1 + r));
  let low = 1;
  let high = 2;
  while (cs(high) >= threshold && high < 1e12) high *= 2;
  for (let n = 0; n < 80; n++) {
    const mid = (low + high) / 2;
    if (cs(mid) >= threshold) low = mid;
    else high = mid;
  }
  return high;
}

/** 長さの階級 1 つ分の、中点の格子。 */
interface LengthClass {
  readonly cell: number;
  readonly members: number[];
  readonly grid: Map<string, number[]>;
}

/**
 * 互換度がしきい値以上の組を、長さの階級ごとの格子（中点）で絞って探し、組ごとに callback を呼ぶ。
 * 各組は 1 度だけ（i < j の向きで）呼ばれる。順序は決まっていない。
 * 長さが 0 または有限でないエッジは対象外で、どの組にも現れない。
 *
 * 【なぜ絞れるか】互換度は 1 以下の 4 つの項の積なので、C ≥ t なら各項が t 以上になる。
 * - Cs ≥ t: 長い方 / 短い方 ≤ rmax。そこで長さを、比 rmax ごとの階級に分ける。互換な組は同じ階級か隣の階級に入る。
 * - Cp ≥ t: 中点の距離 ≤ lavg (1 - t) / t。lavg は 2 本の長さの平均で、階級の最長 Lmax 以下。
 *   階級ごとに 1 マスの幅を Lmax (1 - t) / t にすれば、互換な組の中点は隣り合う 3×3 のマスに入る。
 * 長い 1 本のせいで、短いエッジの格子がつぶれることがない（階級が別なので）。
 * 全組の比較と同じ組になる（テストで照合する）。
 *
 * 計算量: 中点が一様なら、1 マスの本数 m に対して O(E · 9m)。
 * 最悪は、ほぼ同じ長さのエッジが 1 つの狭い範囲に集まる場合で、O(E²) の比較になる（互換な組が E² 個あるため。
 * 組の一覧は作らないのでメモリは増えないが、時間は増える。5,000 本を超えたら警告する理由の 1 つ）。
 *
 * @param edges - 束ねる対象
 * @param threshold - しきい値（0 より大きく 1 未満）
 * @param callback - 互換な組（i < j）ごとに呼ぶ
 */
function forEachCompatiblePair(
  edges: readonly CompatEdge[],
  threshold: number,
  callback: (i: number, j: number, compat: number) => void,
): void {
  if (edges.length === 0) return;
  const ratio = maxLengthRatio(threshold) * (1 + 1e-9);
  const logRatio = Math.log(ratio);
  const keyOf = (ix: number, iy: number): string => `${String(ix)},${String(iy)}`;
  // 1. 長さの階級に分け、階級ごとの最長を求める。
  const lengths = edges.map(length);
  const classes = new Map<number, { longest: number; members: number[] }>();
  lengths.forEach((l, index) => {
    // 長さが 0 または有限でないエッジは対象外（log 0 = -∞ で階級が決まらず、互換度も NaN になるため）。
    if (!(l > 0) || !Number.isFinite(l)) return;
    const id = Math.floor(Math.log(l) / logRatio);
    const entry = classes.get(id);
    if (entry === undefined) classes.set(id, { longest: l, members: [index] });
    else {
      entry.longest = Math.max(entry.longest, l);
      entry.members.push(index);
    }
  });
  // 2. 階級ごとに、中点を格子に振り分ける。
  const built = new Map<number, LengthClass>();
  for (const [id, { longest, members }] of classes) {
    // 丸め誤差で境目の組を落とさないよう、わずかに大きくとる。
    const cell = ((longest * (1 - threshold)) / threshold) * (1 + 1e-9);
    const grid = new Map<string, number[]>();
    for (const index of members) {
      const e = edges[index];
      if (e === undefined) continue;
      const key = keyOf(
        Math.floor((e.x1 / 2 + e.x2 / 2) / cell),
        Math.floor((e.y1 / 2 + e.y2 / 2) / cell),
      );
      const bucket = grid.get(key);
      if (bucket === undefined) grid.set(key, [index]);
      else bucket.push(index);
    }
    built.set(id, { cell, members, grid });
  }
  // 3. 各エッジについて、同じ階級（自分より後ろの番号）と 1 つ長い階級の、隣り合う 3×3 のマスだけを調べる。
  for (const [id, own] of built) {
    const targets: { cls: LengthClass; sameClass: boolean }[] = [{ cls: own, sameClass: true }];
    const upper = built.get(id + 1);
    if (upper !== undefined) targets.push({ cls: upper, sameClass: false });
    for (const i of own.members) {
      const a = edges[i];
      if (a === undefined) continue;
      const mx = a.x1 / 2 + a.x2 / 2;
      const my = a.y1 / 2 + a.y2 / 2;
      for (const { cls, sameClass } of targets) {
        const ix = Math.floor(mx / cls.cell);
        const iy = Math.floor(my / cls.cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const j of cls.grid.get(keyOf(ix + dx, iy + dy)) ?? []) {
              if (sameClass && j <= i) continue; // 同じ階級の組は 1 度だけ数える。
              const b = edges[j];
              if (b === undefined) continue;
              const compat = edgeCompatibility(a, b);
              if (!(compat >= threshold)) continue; // NaN も捨てる。
              // 呼び出しは常に i < j の向きにそろえる（別の階級では番号の大小が決まっていない）。
              if (i < j) callback(i, j, compat);
              else callback(j, i, compat);
            }
          }
        }
      }
    }
  }
}

/**
 * 互換度がしきい値以上の組を一覧で返す。照合とテスト用（組の数だけ object を作るので、密集した入力には使わない）。
 * 実際の処理は {@link buildNeighborTable} を使う。
 *
 * @param edges - 束ねる対象
 * @param threshold - しきい値（0 より大きく 1 未満）
 * @returns 互換な組（i の昇順、同じ i では j の昇順）
 */
export function findCompatiblePairs(edges: readonly CompatEdge[], threshold: number): CompatPair[] {
  const pairs: CompatPair[] = [];
  forEachCompatiblePair(edges, threshold, (i, j, compat) => pairs.push({ i, j, compat }));
  return pairs.sort((a, b) => a.i - b.i || a.j - b.j);
}

/**
 * エッジごとに、互換度の高い上位 maxNeighbors 件だけを保つ近傍の表を作る。
 *
 * 組の一覧を作らず、探索の中で固定長の並び（互換度の降順、同じなら番号の昇順）へ挿入する。
 * メモリは O(E · min(maxNeighbors, E - 1))（互換な組の数に依らない）。
 * 時間は探索の O(組の候補数) に、挿入 O(maxNeighbors) が上限（満杯のときは多くが比較 1 回で捨てられる）。
 *
 * 【注意】上限で切ると近傍は対称でなくなる（P の近傍に Q がいても、Q の近傍に P がいるとは限らない）。
 * 順位は (互換度の降順, 番号の昇順) の全順序なので、探索の順序に結果が依らない（決定的）。
 *
 * @param edges - 束ねる対象
 * @param threshold - しきい値
 * @param maxNeighbors - 1 本あたりの上限
 * @returns 近傍の表（各エッジの近傍は互換度の降順）
 */
export function buildNeighborTable(
  edges: readonly CompatEdge[],
  threshold: number,
  maxNeighbors: number,
): NeighborTable {
  const m = edges.length;
  const k = Math.max(1, Math.min(maxNeighbors, m - 1));
  const slotIndex = new Int32Array(m * k);
  const slotCompat = new Float64Array(m * k);
  const count = new Int32Array(m);
  let pairCount = 0;
  // エッジ owner の上位 k 件へ (other, c) を挿入する。
  const insert = (owner: number, other: number, c: number): void => {
    const base = owner * k;
    let n = count[owner] ?? 0;
    if (n === k) {
      const lastC = slotCompat[base + k - 1] ?? 0;
      const lastJ = slotIndex[base + k - 1] ?? 0;
      // 最下位より順位が低ければ捨てる。
      if (c < lastC || (c === lastC && other > lastJ)) return;
      n--; // 最下位を押し出す。
    }
    let p = n;
    while (p > 0) {
      const prevC = slotCompat[base + p - 1] ?? 0;
      const prevJ = slotIndex[base + p - 1] ?? 0;
      if (prevC > c || (prevC === c && prevJ < other)) break;
      slotCompat[base + p] = prevC;
      slotIndex[base + p] = prevJ;
      p--;
    }
    slotCompat[base + p] = c;
    slotIndex[base + p] = other;
    count[owner] = n + 1;
  };
  forEachCompatiblePair(edges, threshold, (i, j, c) => {
    pairCount++;
    insert(i, j, c);
    insert(j, i, c);
  });
  // 詰め直して CSR にする。
  const offsets = new Int32Array(m + 1);
  for (let i = 0; i < m; i++) offsets[i + 1] = (offsets[i] ?? 0) + (count[i] ?? 0);
  const index = new Int32Array(offsets[m] ?? 0);
  const compat = new Float64Array(offsets[m] ?? 0);
  for (let i = 0; i < m; i++) {
    const n = count[i] ?? 0;
    const o = offsets[i] ?? 0;
    for (let s = 0; s < n; s++) {
      index[o + s] = slotIndex[i * k + s] ?? 0;
      compat[o + s] = slotCompat[i * k + s] ?? 0;
    }
  }
  return { offsets, index, compat, pairCount };
}
