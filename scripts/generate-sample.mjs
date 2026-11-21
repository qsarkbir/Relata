// 実際のTS変換処理をViteで読む。別の暦変換やID規則を生成スクリプトに写さない。
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { format } from 'prettier';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { buildMaghribSample } = await server.ssrLoadModule('/src/io/samples/buildSample.ts');
  const { serializeProject } = await server.ssrLoadModule('/src/io/project/index.ts');
  const source = JSON.parse(
    await readFile(
      new URL('../tests/fixtures/io/palladio/maghrib-20231106.json', import.meta.url),
      'utf8',
    ),
  );
  const project = buildMaghribSample(source);
  await mkdir(new URL('../public/samples/', import.meta.url), { recursive: true });
  // 再生成時に差分を出さない固定日時。元データの作成日時を意味しない。
  await writeFile(
    new URL('../public/samples/maghrib.relata.json', import.meta.url),
    await format(serializeProject(project, '2026-11-21T00:00:00.000Z'), { parser: 'json' }),
  );
  process.stdout.write(
    `Sample: ${project.dataset.nodes.length} nodes, ${project.dataset.edges.length} edges\n`,
  );
} finally {
  await server.close();
}
