/** BroadcastChannel の、使う部分だけの型（テストで偽物に替えられる）。 */
export interface TabChannel {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
  close: () => void;
}

/**
 * 同じアプリが別のタブでも開かれていることを検出する（D-33 (5)）。
 *
 * 開いたときに 'hello' を送り、'hello' を受けたら 'present' を返す。どちらかを受けたら `onOtherTab` を呼ぶ。
 * 【なぜ】自動保存は 1 つの場所に書くので、別のタブの保存で上書きされることを知らせるため。
 * データは送らない（合図だけ。NFR-02）。
 *
 * @param create - チャンネルを作る関数。`BroadcastChannel` が無い環境では undefined を返す
 * @param onOtherTab - 別のタブを見つけたとき（何度でも呼ばれうる）
 * @returns 止める関数
 */
export function watchOtherTabs(
  create: (name: string) => TabChannel | undefined,
  onOtherTab: () => void,
): () => void {
  let channel: TabChannel | undefined;
  try {
    channel = create('relata-tabs');
  } catch {
    channel = undefined;
  }
  if (channel === undefined) return () => undefined;
  const ch = channel;
  ch.onmessage = (event) => {
    if (event.data === 'hello') ch.postMessage('present');
    if (event.data === 'hello' || event.data === 'present') onOtherTab();
  };
  ch.postMessage('hello');
  return () => {
    ch.close();
  };
}
