import { describe, expect, it } from 'vitest';
import { DEFAULT_BUNDLING_VIEW } from '../../core/project';
import { DEFAULT_BUNDLING_SETTINGS } from './settings';

// 【なぜ】束ねる強さの既定は、算法の設定（render/bundling）と、保存する画面の設定（core/project の
//   `BundlingViewSettings`）の 2 か所に書かれている。片方だけを変えると、保存した既定と計算の既定が
//   食い違うので、等しいことをここで確かめる（設計書 D-55 の補足、D-59 の補足）。
describe('束ねる強さの既定値', () => {
  it('FR-VG-13: 算法の既定と保存する設定の既定が同じ（0.85）', () => {
    expect(DEFAULT_BUNDLING_SETTINGS.strength).toBe(DEFAULT_BUNDLING_VIEW.strength);
    expect(DEFAULT_BUNDLING_VIEW.strength).toBe(0.85);
  });
});
