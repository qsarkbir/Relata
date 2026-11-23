/**
 * 図（SVG・PNG・PDF）の書き出しの窓口。グラフの部品が登録し、「書き出し」のダイアログが呼ぶ（FR-OUT-01、03、04、07）。
 *
 * 【なぜ】図を作るには、グラフの部品が持つ値（位置、見た目の割り当て、文字の幅の測り方、選択中のノード）が要る。
 * これらを「書き出し」のダイアログで作り直すと、計算が二重になり、画面と書き出した図が食い違うおそれがある。
 * そこで、グラフの部品が「今の図を作る関数」をここへ登録し、ダイアログはそれを呼ぶだけにする。
 * SVG・PNG・PDF は、この関数が返す同じシーンから作る（書き出し専用の別の描画処理を持たない）。
 */
import { useSyncExternalStore } from 'react';
import type { SvgExport } from '../io/export';
import type { MeasureText } from '../render';

/** 図を作るときの要求。 */
export interface FigureRequest {
  /** 凡例を入れるか。 */
  readonly legend: boolean;
  /** 出典表記（データ名、作成日、「Relata で作成」）を入れるか。 */
  readonly credit: boolean;
  /** 作成日（`YYYY-MM-DD`）。 */
  readonly createdAt: string;
  /**
   * 時間の再生で薄く表示している要素を、書き出した図でも薄く描くか（D-38）。
   * 時刻が決まっていなければ、true でも何も変わらない。
   */
  readonly timeFade: boolean;
  /**
   * 文字の幅を測る関数。省略すると画面と同じ測り方。PDF では、PDF に描くフォントで測る関数を渡す
   * （ラベルと凡例の重なり・はみ出しの判断を、描く文字と一致させるため）。
   */
  readonly measureText?: MeasureText;
}

/** 今の図の作り手。 */
export interface FigureSource {
  /** データの題名（ファイル名と PDF の題名に使う）。 */
  readonly title: string;
  /** 図を作る。 */
  readonly build: (request: FigureRequest) => SvgExport;
}

// 【TS】`Set<() => void>` は、引数も戻り値も無い関数の集合。変化を知らせる購読者を持つ。
let current: FigureSource | null = null;
const listeners = new Set<() => void>();

/**
 * 図の作り手を登録する。図が無くなったら null を渡す。
 *
 * @param source - 今の図の作り手、または null
 */
export function setFigureSource(source: FigureSource | null): void {
  if (current === source) return;
  current = source;
  for (const listener of listeners) listener();
}

/**
 * 登録されている図の作り手を、変化に追従して読む。
 *
 * @returns 今の図の作り手。図が無いときは null
 */
export function useFigureSource(): FigureSource | null {
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
