/**
 * Force-Directed Edge Bundling の本体。段階ごとに進められる「セッション」を作る（FR-VG-13、D-55）。
 *
 * 出典:
 * - Holten, D. & van Wijk, J. J. (2009). "Force-Directed Edge Bundling for Graph Visualization".
 *   Computer Graphics Forum 28(3), EuroVis 2009.（分割点、ばねと引力、互換度、段階ごとの細分化）
 * - 向きの扱いの検討: Selassie, D., Heller, B. & Heer, J. (2011). "Divided Edge Bundling for
 *   Directional Network Data". IEEE TVCG 17(12), InfoVis 2011.（逆向きのエッジを別の車線に分ける）
 *
 * 【規約】
 * - 自己ループと長さ 0 のエッジは束ねず、2 点の線のまま返す（件数は info と結果に入る）。
 * - 処理は ID の昇順（コード単位の比較）で行い、入力の順序に結果が依存しない（NFR-08）。
 *   乱数も `Date` も使わない。浮動小数点の足し算の順序も固定される。
 * - 端点は動かさず、結果の先頭と末尾は入力の座標と完全に同じ値にする。
 * - 向きは算法に影響しない。逆向きに並ぶエッジ（有向でも無向でも）は、点の対応を反転して
 *   引き合わせ、1 本の中心線に束ねる。各 path は始点から終点の順のままなので、向きは描画側で分かる。
 *
 * 【なぜ車線に分けないか（D-55 の補足）】Selassie ほか（2011）のように逆向きを別の線に分けるずらし幅を
 * データの座標で持つと、束の太さを画面の px で保ちズームで束ね直さない規則（§8.1、D-54、D-55）と
 * 食い違う（縮小で重なり、拡大で離れすぎる）。そこで車線の分離は描画側（T3-02）が画面の px で行う。
 * そのため、このファイルには車線の設定も y 軸の向きの設定も無い。
 *
 * 【なぜ力でなく「目標の平均への移動」か】Holten ほか（2009）の式（力の合計 × ステップ幅 S）は、
 * 近傍が多いと、あるいは距離が小さいと、1 反復で目標を飛び越えて振動する（座標の尺度と近傍の数で
 * 安定なステップ幅が変わる）。ここでは、各点がばねの目標（両隣の中点）と引力の目標（互換エッジの
 * 対応点）の重みつき平均へ割合 stepSize（0〜1）だけ動く形にする。重みは互換度/(距離+ε) で、
 * 近く互換度の高いエッジほど強く効く点は原論文と同じ。凸結合なので飛び越えず、必ず安定する。
 *
 * 【座標の正規化】力の大きさは長さに依るので、内部では中心を原点、平均のエッジの長さを 1 に
 * 直した座標で計算し、最後に元の座標へ戻す。これで設定の意味が座標の尺度（ピクセル、メルカトル）に
 * 依らない。
 *
 * 計算量: 準備 O(E log E + 近傍探索)（近傍探索は compatibility.ts。互換な組の一覧は作らず、
 * エッジごとに上位 maxNeighbors 件だけを保つので、メモリは O(E · maxNeighbors)）。1 反復は
 * O(Σ 点の数 × 近傍の数) ≤ O(E · 2^c · maxNeighbors)。全体は段階 c の反復回数 I·(2/3)^c を足して、
 * おおよそ O(E · maxNeighbors · 2^cycles · I)。素朴な O(E²) の比較は長さの階級ごとの格子で避ける。
 * 上限で切った近傍は対称でない（P の近傍に Q がいても、Q の近傍に P がいるとは限らない）。
 */
import { buildNeighborTable, type CompatEdge } from './compatibility';
import {
  resolveBundlingSettings,
  type BundledPath,
  type BundleEdge,
  type BundlingInfo,
  type BundlingProgress,
  type BundlingResult,
  type BundlingSettings,
} from './settings';

/** 1 つの段階（分割数が 2 倍になる）を進める窓口。 */
export interface BundlingSession {
  /** 準備で分かった情報。 */
  readonly info: BundlingInfo;
  /** 次の段階を 1 つ進める。すべて終わっていれば何もせず done を返す。 */
  step(): BundlingProgress;
  /** いまの折れ線を返す（途中でも呼べる。段階の途中経過を見せるときに使う）。 */
  result(): BundlingResult;
}

/** 引力の重みの分母のやわらげ（正規化座標での長さ）。距離が 0 に近いとき重みが発散しないため。 */
const SOFTENING = 0.02;
/** 反復回数を段階ごとに掛ける割合（Holten ほか 2009）。 */
const ITERATION_DECAY = 2 / 3;

/** 座標の絶対値の上限（layout と同じ）。 */
export const MAX_BUNDLING_COORDINATE = 1e9;

// ID の昇順（コード単位）の比較。ロケールに依らず決定的。
function compareId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// 入力のエッジを検査する。
function validateEdges(edges: readonly BundleEdge[]): void {
  const seen = new Set<string>();
  for (const e of edges) {
    for (const v of [e.x1, e.y1, e.x2, e.y2]) {
      if (!Number.isFinite(v)) {
        throw new RangeError(`エッジ ${e.id} の座標が有限の数ではありません。`);
      }
      // 【なぜ】layout の座標と同じ上限（1e9）。これを超えると 2 乗の計算で精度が落ちる。
      if (Math.abs(v) > MAX_BUNDLING_COORDINATE) {
        throw new RangeError(
          `エッジ ${e.id} の座標の絶対値が ${String(MAX_BUNDLING_COORDINATE)} を超えています。`,
        );
      }
    }
    if (seen.has(e.id)) throw new RangeError(`エッジ ID ${e.id} が重複しています。`);
    seen.add(e.id);
  }
}

/**
 * 束ねる計算のセッションを作る。
 *
 * @param inputEdges - 束ねるエッジ（順序は問わない）
 * @param inputSettings - 設定（一部だけでよい）
 * @returns step で段階を進め、result で折れ線を取り出すセッション
 * @throws RangeError 設定が範囲外、座標が有限でない・絶対値が 1e9 を超える、ID が重複しているとき
 * @example
 * const session = createBundlingSession(edges, { cycles: 4 });
 * while (!session.step().done);
 * const { paths } = session.result();
 */
export function createBundlingSession(
  inputEdges: readonly BundleEdge[],
  inputSettings: Partial<BundlingSettings> = {},
): BundlingSession {
  const settings = resolveBundlingSettings(inputSettings);
  validateEdges(inputEdges);

  // 1. ID の順に並べ、束ねない（自己ループ・長さ 0）エッジを分ける。 O(E log E)
  const sorted = [...inputEdges].sort(compareId);
  const bundledEdges = sorted.filter((e) => e.x1 !== e.x2 || e.y1 !== e.y2);
  const unbundledCount = sorted.length - bundledEdges.length;
  const m = bundledEdges.length;

  // 2. 座標を正規化する（中心 0、平均の長さ 1）。
  let cx = 0;
  let cy = 0;
  let meanLength = 0;
  for (const e of bundledEdges) {
    cx += e.x1 / 2 + e.x2 / 2;
    cy += e.y1 / 2 + e.y2 / 2;
    const dx = e.x2 - e.x1;
    const dy = e.y2 - e.y1;
    // 【なぜ】Math.hypot でなく平方根を直接使う（hypot は実行環境で最後の桁が違いうる。NFR-08）。
    meanLength += Math.sqrt(dx * dx + dy * dy);
  }
  if (m > 0) {
    cx /= m;
    cy /= m;
    meanLength /= m;
  }
  const norm = (x: number, y: number): [number, number] => [
    (x - cx) / meanLength,
    (y - cy) / meanLength,
  ];
  const normalized: CompatEdge[] = bundledEdges.map((e) => {
    const [x1, y1] = norm(e.x1, e.y1);
    const [x2, y2] = norm(e.x2, e.y2);
    return { x1, y1, x2, y2 };
  });
  // 【TS】配列の添字アクセスは undefined を含む型になる（noUncheckedIndexedAccess）。
  //   内部では範囲内と分かっているので、小さな関数に閉じ込めて一度だけ確かめる。
  const edgeAt = (i: number): CompatEdge => {
    const e = normalized[i];
    if (e === undefined) throw new RangeError('内部エラー: エッジの番号が範囲外です。');
    return e;
  };
  // 3. 互換なエッジの近傍（CSR 形式）を、上位 maxNeighbors 件だけ保つ形で作る。
  //    組の一覧は作らない（密集した入力でもメモリが組の数に比例しない）。
  const table = buildNeighborTable(
    normalized,
    settings.compatibilityThreshold,
    settings.maxNeighbors,
  );
  const { offsets, compat: nbCompat, index: nbIndex } = table;
  // 逆向きに並ぶ組は、点の対応を反転する（無向も有向も同じ）。
  const nbFlip = new Uint8Array(nbIndex.length);
  for (let i = 0; i < m; i++) {
    const a = edgeAt(i);
    for (let k = offsets[i] ?? 0; k < (offsets[i + 1] ?? 0); k++) {
      const b = edgeAt(nbIndex[k] ?? 0);
      const dot = (a.x2 - a.x1) * (b.x2 - b.x1) + (a.y2 - a.y1) * (b.y2 - b.y1);
      nbFlip[k] = dot < 0 ? 1 : 0;
    }
  }

  // 4. 各エッジの折れ線（正規化座標）。最初は始点と終点だけ（分割数 1）。
  let points: Float64Array[] = normalized.map((e) => Float64Array.of(e.x1, e.y1, e.x2, e.y2));
  let segments = 1;
  let completed = 0;
  const cycles = settings.cycles;
  // 束ねる強さ → ばねの重み。強さ 1 でも 0 にはせず、点が暴れないようにする。
  // 【なぜ】ばねの強さは、Holten ほかの kP = K/|P|（分割数にも比例して変わる）にせず、定数にする。
  //   重みつき平均では、ばねの目標と引力の目標の重みの比だけが意味を持つ。引力の重みの合計は、
  //   近い互換エッジが数十本あるとき 互換度/(距離+ε) の ε = 0.02 により数百〜千のオーダーになる。
  //   そこで strength = 0 のとき 400 + 0.5（引力と同程度で、ほぼ束ならない）、strength = 1 のとき
  //   0.5（ほぼ引力だけ）になるよう、400 を実験で決めた（20 本の平行なエッジで、強さ 0 / 0.5 / 1 の
  //   中央の広がりが 6 / 0.9 / 0 に分かれる）。
  const springWeight = 0.5 + 400 * (1 - settings.strength);

  /** 分割数を 2 倍にする。隣り合う点の中点を新しい点にする（いまの形を保つ）。 */
  const subdivide = (): void => {
    points = points.map((p) => {
      const count = p.length / 2;
      const next = new Float64Array((2 * (count - 1) + 1) * 2);
      for (let k = 0; k < count; k++) {
        next[4 * k] = p[2 * k] ?? 0;
        next[4 * k + 1] = p[2 * k + 1] ?? 0;
        if (k < count - 1) {
          next[4 * k + 2] = ((p[2 * k] ?? 0) + (p[2 * k + 2] ?? 0)) / 2;
          next[4 * k + 3] = ((p[2 * k + 1] ?? 0) + (p[2 * k + 3] ?? 0)) / 2;
        }
      }
      return next;
    });
    segments *= 2;
  };

  // 1 反復。全エッジの全点の変位を先に求めてから、まとめて動かす（順序に依らない）。
  const iterate = (stepSize: number): void => {
    const interior = segments - 1;
    const displacement = new Float64Array(m * interior * 2);
    for (let e = 0; e < m; e++) {
      const p = points[e];
      if (p === undefined) continue;
      const start = offsets[e] ?? 0;
      const end = offsets[e + 1] ?? 0;
      for (let i = 1; i <= interior; i++) {
        const px = p[2 * i] ?? 0;
        const py = p[2 * i + 1] ?? 0;
        // 4a. ばね: 両隣の点の中点を目標にする（重み springWeight）。Hooke の法則のばねを、
        //     「目標への引き寄せ」に書き直したもの（下の【なぜ】）。
        let sumW = springWeight;
        let sumX = springWeight * (((p[2 * i - 2] ?? 0) + (p[2 * i + 2] ?? 0)) / 2);
        let sumY = springWeight * (((p[2 * i - 1] ?? 0) + (p[2 * i + 3] ?? 0)) / 2);
        // 4b. 引力: 互換なエッジの対応する点を目標にする。重みは 互換度 / (距離 + ε)
        //     （Holten ほか 2009 の「力の大きさは距離に反比例」を、重みとして使う）。
        for (let k = start; k < end; k++) {
          const q = points[nbIndex[k] ?? 0];
          if (q === undefined) continue;
          const at = nbFlip[k] === 1 ? segments - i : i;
          const tx = q[2 * at] ?? 0;
          const ty = q[2 * at + 1] ?? 0;
          const ddx = tx - px;
          const ddy = ty - py;
          // 【なぜ】Math.hypot は遅い（内側のループで数億回呼ぶ）ので、平方根を直接使う。
          const w = (nbCompat[k] ?? 0) / (Math.sqrt(ddx * ddx + ddy * ddy) + SOFTENING);
          sumW += w;
          sumX += w * tx;
          sumY += w * ty;
        }
        // 4c. 重みつきの目標の平均へ、割合 stepSize だけ動く。
        displacement[(e * interior + (i - 1)) * 2] = stepSize * (sumX / sumW - px);
        displacement[(e * interior + (i - 1)) * 2 + 1] = stepSize * (sumY / sumW - py);
      }
    }
    for (let e = 0; e < m; e++) {
      const p = points[e];
      if (p === undefined) continue;
      for (let i = 1; i <= interior; i++) {
        p[2 * i] = (p[2 * i] ?? 0) + (displacement[(e * interior + (i - 1)) * 2] ?? 0);
        p[2 * i + 1] = (p[2 * i + 1] ?? 0) + (displacement[(e * interior + (i - 1)) * 2 + 1] ?? 0);
      }
    }
  };

  const info: BundlingInfo = {
    cycles,
    bundledCount: m,
    unbundledCount,
    compatiblePairCount: table.pairCount,
  };

  return {
    info,
    step(): BundlingProgress {
      if (completed < cycles) {
        // 5. 段階 c: 分割数を 2 倍にし（初回は 1 → 2）、ステップ幅は半分、反復回数は 2/3 倍にして繰り返す。
        subdivide();
        const stepSize = settings.stepSize / 2 ** completed;
        const count = Math.max(1, Math.round(settings.iterations * ITERATION_DECAY ** completed));
        if (m > 0) for (let n = 0; n < count; n++) iterate(stepSize);
        completed++;
      }
      return { cycle: completed, cycles, done: completed >= cycles };
    },
    result(): BundlingResult {
      // 6. 元の座標へ戻し、端点は入力と完全に同じ値にする。ID の順に並べる。
      const paths: BundledPath[] = [];
      let b = 0;
      for (const e of sorted) {
        if (e.x1 === e.x2 && e.y1 === e.y2) {
          paths.push({
            id: e.id,
            points: [e.x1, e.y1, e.x2, e.y2],
            bundled: false,
            directed: e.directed,
          });
          continue;
        }
        const p = points[b++] ?? new Float64Array(0);
        const out: number[] = [];
        for (let k = 0; k < p.length; k += 2) {
          out.push((p[k] ?? 0) * meanLength + cx, (p[k + 1] ?? 0) * meanLength + cy);
        }
        out[0] = e.x1;
        out[1] = e.y1;
        out[out.length - 2] = e.x2;
        out[out.length - 1] = e.y2;
        paths.push({ id: e.id, points: out, bundled: true, directed: e.directed });
      }
      return { paths, unbundledCount };
    },
  };
}

/**
 * すべての段階を続けて計算する（テストと小さな入力向けの便利関数）。
 *
 * @param edges - 束ねるエッジ
 * @param settings - 設定（一部だけでよい）
 * @returns 束ねた結果
 */
export function bundleEdges(
  edges: readonly BundleEdge[],
  settings: Partial<BundlingSettings> = {},
): BundlingResult {
  const session = createBundlingSession(edges, settings);
  while (!session.step().done) {
    /* 段階を最後まで進める。 */
  }
  return session.result();
}
