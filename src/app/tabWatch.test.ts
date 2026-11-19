import { describe, expect, it, vi } from 'vitest';
import { watchOtherTabs } from './tabWatch';
import type { TabChannel } from './tabWatch';

function fakeChannel() {
  const sent: unknown[] = [];
  const ch: TabChannel = {
    postMessage: (m) => {
      sent.push(m);
    },
    onmessage: null,
    close: vi.fn(),
  };
  return { ch, sent };
}

describe('watchOtherTabs', () => {
  it('FR-PJ-02: 起動時に hello を送り、hello を受けたら present を返して知らせる', () => {
    const { ch, sent } = fakeChannel();
    const on = vi.fn();
    const stop = watchOtherTabs(() => ch, on);
    expect(sent).toEqual(['hello']);
    ch.onmessage?.(new MessageEvent('message', { data: 'hello' }));
    expect(sent).toEqual(['hello', 'present']);
    expect(on).toHaveBeenCalledTimes(1);
    ch.onmessage?.(new MessageEvent('message', { data: 'present' }));
    expect(on).toHaveBeenCalledTimes(2);
    stop();
    expect(ch.close).toHaveBeenCalled();
  });

  it('FR-PJ-02: BroadcastChannel が無い環境や作れない環境では何もしない', () => {
    const on = vi.fn();
    expect(() => {
      watchOtherTabs(() => undefined, on)();
    }).not.toThrow();
    expect(() => {
      watchOtherTabs(() => {
        throw new Error('x');
      }, on)();
    }).not.toThrow();
    expect(on).not.toHaveBeenCalled();
  });
});
