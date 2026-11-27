/**
 * E2E テストの共通の `test`。すべての spec は `@playwright/test` ではなく、ここから `test` と `expect` を import する。
 *
 * 【なぜ】OpenStreetMap のタイルサーバーは、自動の取得を利用規約で禁じている（D-51 の補足 (4)）。
 * 地図のタブを開く spec が増えると、既定の背景（osm）で本物のサーバーに要求が飛ぶ。どの spec でも
 * 漏れなく止めるため、`context` の自動 fixture で OSM への要求を常に小さな PNG に差し替える。
 * さらに、localhost 以外へ出ようとする要求は、通信せずに失敗させる（NFR-02: 地図タイル以外は外に出さない）。
 * 個別の spec が後から `context.route` を足せば、そちらが優先される（Playwright は後に登録した route を先に試す）。
 */
import { test as base } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';

export * from '@playwright/test';

/**
 * 1 色だけの PNG（256×256、RGB 8 ビット）を作る。タイルの代わりに返す。
 *
 * @param r - 赤（0〜255）
 * @param g - 緑（0〜255）
 * @param b - 青（0〜255）
 * @returns PNG のバイト列
 */
export function solidTilePng(r: number, g: number, b: number): Buffer {
  const size = 256;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 【TS】`base.extend` は fixture を足した新しい `test` を返す。`{ auto: true }` は、テストが名前を
//   使わなくても毎回自動で実行される。`use` を呼ぶ前が準備、後が後始末。
export const test = base.extend<{ guardNetwork: true }>({
  guardNetwork: [
    async ({ context }, use) => {
      // 先に登録したものは後から登録したものに負けるので、広い「外部は失敗」を先に、狭い OSM を後に置く。
      await context.route(
        (url) => url.hostname !== 'localhost' && url.protocol.startsWith('http'),
        (route) => route.abort(),
      );
      const osm = solidTilePng(200, 120, 80);
      await context.route('https://tile.openstreetmap.org/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: osm }),
      );
      await use(true);
    },
    { auto: true },
  ],
});
