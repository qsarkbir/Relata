/**
 * 図（SVG）の保存の窓口。グラフの部品が登録し、「保存」のダイアログが呼ぶ。
 *
 * 【なぜ】SVG を作るには、グラフの部品が持つ値（位置、見た目の割り当て、文字の幅の測り方、
 * 選択中のノード）が要る。これらを「保存」のダイアログで作り直すと、計算が二重になり、
 * 画面と保存した図が食い違うおそれがある。そこで、グラフの部品が「今の図を保存する関数」を
 * ここへ登録し、ダイアログはそれを呼ぶだけにする。
 */
import { useSyncExternalStore } from 'react';

/** 今の図を SVG として保存する関数。図が無いときは null。 */
export type SvgExporter = (() => void) | null;

let current: SvgExporter = null;
const listeners = new Set<() => void>();

/**
 * 保存の関数を登録する。図が無くなったら null を渡す。
 *
 * @param exporter - 今の図を保存する関数、または null
 */
export function setSvgExporter(exporter: SvgExporter): void {
  if (current === exporter) return;
  current = exporter;
  for (const listener of listeners) listener();
}

/**
 * 登録されている保存の関数を、変化に追従して読む。
 *
 * @returns 今の図を保存する関数。図が無いときは null
 */
export function useSvgExporter(): SvgExporter {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
