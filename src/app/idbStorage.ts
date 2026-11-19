import type { AutosaveStorage } from './autosave';

const DB_NAME = 'relata';
const STORE_NAME = 'autosave';
const KEY = 'current';

/**
 * IndexedDB の要求 1 件を Promise にする。
 *
 * @param req - IndexedDB の要求
 * @returns 結果
 */
function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB の要求に失敗しました'));
    };
  });
}

/**
 * IndexedDB に自動保存の文字列を 1 件だけ持つ保存先を作る（FR-PJ-02、NFR-02: 端末の中だけ）。
 *
 * 【なぜ】保存の形は `serializeProject` の JSON 文字列そのもの。復元は通常の読み込みと同じ道を通り、
 * 版の検査と移行がそのまま効く（D-32）。IndexedDB が無い環境（`factory` が undefined）や、
 * 開けない環境（プライベートブラウズなど）では、各操作が reject する。呼ぶ側が一度だけ利用者に知らせる。
 *
 * @param factory - `indexedDB`。テストで偽物に替えられる
 * @returns 保存先
 */
export function createIdbStorage(factory: IDBFactory | undefined): AutosaveStorage {
  const open = (): Promise<IDBDatabase> => {
    if (factory === undefined) return Promise.reject(new Error('IndexedDB がありません'));
    return new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(DB_NAME, 1);
      } catch (e) {
        reject(e instanceof Error ? e : new Error('IndexedDB を開けません'));
        return;
      }
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      // 【なぜ】onblocked で reject した後でも、開く処理は続いて onsuccess が来ることがある。
      //   そのときは誰も使わない接続になるので、閉じる（閉じないと他のタブの更新を止め続ける）。
      let abandoned = false;
      req.onsuccess = () => {
        if (abandoned) req.result.close();
        else resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB を開けません'));
      };
      req.onblocked = () => {
        abandoned = true;
        reject(new Error('IndexedDB が他のタブで使われています'));
      };
    });
  };

  // 保存先を開いて 1 つの操作を行い、必ず閉じる。
  // 【TS】`<T>` はジェネリクス。操作が返す値の型（読み取りなら unknown、書き込みなら IDBValidKey）を、そのまま戻り値の型にする。
  const withStore = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('IndexedDB の書き込みに失敗しました'));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error('IndexedDB の書き込みが中止されました'));
        };
      });
      // 【なぜ】要求の結果とトランザクションの完了を同時に待つ。順に待つと、先の待ちが失敗したとき、
      //   後の Promise の reject を誰も受けず、未処理の拒否になる。
      const [result] = await Promise.all([promisify(fn(tx.objectStore(STORE_NAME))), done]);
      return result;
    } finally {
      db.close();
    }
  };

  return {
    load: async () => {
      const v = await withStore<unknown>('readonly', (s) => s.get(KEY));
      // 【なぜ】文字列以外（壊れた保存）は、無いものとして扱う。アプリを止めない。
      return typeof v === 'string' ? v : null;
    },
    save: async (text) => {
      await withStore('readwrite', (s) => s.put(text, KEY));
    },
    clear: async () => {
      await withStore('readwrite', (s) => s.delete(KEY));
    },
  };
}
