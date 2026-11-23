// @vitest-environment node
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as hb from 'harfbuzzjs';
import { applyFilters, DEFAULT_FILTER_STATE } from '../../src/core/filter';
import { buildGraph } from '../../src/core/graph';
import { makeAttrs, toEdgeId, toNodeId, toNodeTypeId, type Dataset } from '../../src/core/model';
import { buildPdf, buildScene, renderPdfContent, renderSvg } from '../../src/render';
import { PDF_FONT_BYTES_ESTIMATE, PDF_FONT_FILES } from '../../src/io/export/pdf';
import { createTextShaper, splitRuns, visualOrder } from '../../src/io/export/pdfText';

const fontPath = (name: string): string =>
  new URL(`../../public/fonts/${name}`, import.meta.url).pathname;
const read = (name: string): ArrayBuffer => {
  const b = readFileSync(fontPath(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); // 理由: Buffer の裏の ArrayBuffer を切り出すだけ
};
const shaper = createTextShaper(hb, {
  latin: read(PDF_FONT_FILES.latin),
  japanese: read(PDF_FONT_FILES.japanese),
  arabic: read(PDF_FONT_FILES.arabic),
});
const glyphIds = (text: string, direction: 'ltr' | 'rtl'): number[][] =>
  shaper.shapeVisual(text, direction).map((r) => r.glyphs.map((g) => g.gid));

describe('FR-OUT-04 / NFR-09: PDF の文字の整形', () => {
  it('フォントの大きさの目安が、実際のファイルの合計とおおむね合う（UI の「数 MB」の根拠）', () => {
    const total = Object.values(PDF_FONT_FILES).reduce((n, f) => n + statSync(fontPath(f)).size, 0);
    expect(Math.abs(total - PDF_FONT_BYTES_ESTIMATE) / total).toBeLessThan(0.05);
  });
  it('ランの分割: 双方向のレベルとフォントが変わる所で割る。空白と約物は前の文字に付く', () => {
    const text = 'abc ابج 12';
    const runs = splitRuns(text, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2], () => true);
    expect(runs.map((r) => [r.text, r.level, r.font])).toEqual([
      ['abc ', 0, 'latin'],
      ['ابج ', 1, 'arabic'],
      ['12', 2, 'latin'],
    ]);
  });
  it('ランの並べ替え（UAX #9 L2）: 奇数レベルの連なりは反転し、その中の偶数レベルは相対の順を保つ', () => {
    expect(visualOrder([0, 0, 0])).toEqual([0, 1, 2]);
    expect(visualOrder([1, 1, 1])).toEqual([2, 1, 0]);
    expect(visualOrder([0, 1, 1, 0])).toEqual([0, 2, 1, 3]);
    // 右から左の段落に埋め込まれた数字: [アラビア(1), 数字(2), アラビア(1)] → 数字は左から右のまま
    expect(visualOrder([1, 2, 1])).toEqual([2, 1, 0]);
  });
  it('アラビア文字は連結形になる: 語頭・語中・語末で、独立形とは別の字形が選ばれる', () => {
    // 【なぜ】Noto Naskh Arabic は、点を別の字形（幅 0 の記号）で持つ。幅のある字形が本体の字形。
    const bodies = (text: string, dir: 'ltr' | 'rtl'): number[] =>
      shaper
        .shapeVisual(text, dir)
        .flatMap((r) => r.glyphs)
        .filter((g) => g.xAdvance > 0)
        .map((g) => g.gid);
    const isolated = bodies('ب', 'rtl')[0];
    const word = bodies('ببب', 'rtl');
    expect(word).toHaveLength(3);
    for (const g of word) expect(g).not.toBe(isolated);
    // 見た目の左から、語末形、語中形、語頭形。3 つとも別の字形。
    expect(new Set(word).size).toBe(3);
    // 同じ字を整形せずに独立形で並べた結果とは違う（連結が効いている）。
    expect(word).not.toEqual([isolated, isolated, isolated]);
  });
  it('ラム・アリフ（لا）は、独立形の ل と ا を並べたものとは違う字形になる', () => {
    const joined = glyphIds('لا', 'rtl')[0]?.join();
    const separate = [
      ...(glyphIds('ا', 'rtl')[0] ?? []),
      ...(glyphIds('ل', 'rtl')[0] ?? []),
    ].join();
    expect(joined).not.toBe(separate);
  });
  it('右から左の段落の中の欧文と数字は、左から右のまま並ぶ', () => {
    const runs = shaper.shapeVisual('محمد 123 abc', 'rtl');
    // 見た目の左から: abc（左から右）、空白、123（左から右）、アラビア文字（段落が右から左なので右端）。
    expect(runs.map((r) => [r.font, r.rtl])).toEqual([
      ['latin', false],
      ['latin', true],
      ['latin', false],
      ['arabic', true],
    ]);
    expect(runs[0]?.glyphs).toHaveLength(3);
    expect(runs[2]?.glyphs).toHaveLength(3);
  });
  it('日本語は字形が見つかる（.notdef の 0 ではない）', () => {
    const ids = glyphIds('東京 テスト', 'ltr').flat();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((g) => g !== 0)).toBe(true);
  });
  it('輪郭の幅は、文字の大きさに比例する', () => {
    const a = shaper.outline('ابن خلدون', 12, 'rtl');
    const b = shaper.outline('ابن خلدون', 24, 'rtl');
    expect(a.glyphs.length).toBeGreaterThan(5);
    expect(b.width / a.width).toBeCloseTo(2, 5);
    for (const g of a.glyphs) {
      expect(Number.isFinite(g.x + g.y + g.scale)).toBe(true);
      expect(g.commands.length).toBeGreaterThan(0);
    }
  });
});

// ---- 欠けた字形（豆腐）が出ないこと ----
/** 値の中の文字列を、再帰的にすべて集める。 */
function collectStrings(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (typeof value === 'object' && value !== null)
    for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}
const notdef = (text: string, dir: 'ltr' | 'rtl' = 'ltr'): number =>
  shaper
    .shapeVisual(text, dir)
    .flatMap((r) => r.glyphs)
    .filter((g) => g.gid === 0).length;

describe('NFR-09: 転写記号・トルコ語・日本語・アラビア文字に、字形の欠け（gid 0）が出ない', () => {
  const transliteration = [
    'Ḥ ḥ ṣ ṭ ḍ ẓ ḏ ṯ ẖ ḳ ẕ ʿ ʾ ʼ',
    'Ṣ Ṭ Ḍ Ẓ Ḏ Ṯ Ḫ Ḳ Ḥ Ġ',
    'ḥ\u0323 ṭ\u0323 s\u0323 d\u0323 z\u0323',
    'Ibn ʿAskar',
    'Ramaḍān 1050 AH',
    'Şş Ğğ İı Çç Öö Üü ţ',
    'Ṭabarī al-ʾAnṣārī',
  ];
  it('欧文のフォント（Noto Sans）を選ぶ: 転写記号とトルコ語の字は、日本語のフォントでなく欧文のフォントの字形を使う', () => {
    for (const ch of Array.from('ḤḥṣṭḍẓḏṯẖḳẕʿʾʼŞşğıţ')) {
      const cp = ch.codePointAt(0) ?? 0;
      expect(shaper.has('latin', cp)).toBe(true);
      expect(shaper.fontOf(cp)).toBe('latin');
    }
  });
  it('転写記号、結合記号、トルコ語は、豆腐にならない', () => {
    for (const text of transliteration) expect(notdef(text), text).toBe(0);
  });
  it('サンプルの全ラベル・属性・出典と、日本語・アラビア文字・約物の混在は、豆腐にならない', () => {
    const sample: unknown = JSON.parse(
      readFileSync(
        new URL('../../public/samples/maghrib.relata.json', import.meta.url).pathname,
        'utf8',
      ),
    );
    const strings = [...collectStrings(sample)].filter(
      (t) => t.length < 200 && !/^[\d.:TZ+-]+$/.test(t),
    );
    expect(strings.length).toBeGreaterThan(30);
    for (const text of strings)
      expect(notdef(text, /[\u0600-\u06ff]/.test(text) ? 'rtl' : 'ltr'), text).toBe(0);
    for (const text of [
      '東京の学者（Tokyo）',
      'データ: Maghrib sample',
      '作成日: 2026-11-23',
      'Relata で作成',
    ])
      expect(notdef(text), text).toBe(0);
    expect(notdef('علی・محمد', 'rtl')).toBe(0);
    expect(notdef('محمد「本」', 'rtl')).toBe(0);
  });
  it('結合記号は土台の字と同じランに入る（ランを割らない）', () => {
    const runs = shaper.shapeVisual('t\u0323aş', 'ltr');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.font).toBe('latin');
  });
  it('ZWJ は前の文字と同じランに入り、アラビア文字の連結が保たれる（ب‍ب は語頭形＋語末形）', () => {
    const bodies = (t: string): number[] =>
      shaper
        .shapeVisual(t, 'rtl')
        .flatMap((r) => r.glyphs)
        .filter((g) => g.xAdvance > 0)
        .map((g) => g.gid);
    expect(shaper.shapeVisual('ب\u200dب', 'rtl')).toHaveLength(1);
    const isolated = bodies('ب')[0];
    const joined = bodies('ب\u200dب');
    expect(joined).toHaveLength(2);
    for (const g of joined) expect(g).not.toBe(isolated);
    expect(joined).toEqual(bodies('بب'));
    expect(notdef('ب\u200dب', 'rtl')).toBe(0);
  });
  it('改行とタブは空白に、制御文字は除かれて、豆腐や幅にならない', () => {
    expect(notdef('a\nb\tc\u0001d')).toBe(0);
    expect(shaper.outline('a\nb', 12, 'ltr').width).toBeCloseTo(
      shaper.outline('a b', 12, 'ltr').width,
      6,
    );
    expect(shaper.measure('ab\u0007', '12px sans-serif')).toBeCloseTo(
      shaper.measure('ab', '12px sans-serif'),
      6,
    );
  });
});

const type = toNodeTypeId('person');
function sample(): { dataset: Dataset } {
  const mk = (id: string, label: string) => ({
    id: toNodeId(id),
    type,
    label,
    attrs: makeAttrs([]),
  });
  return {
    dataset: {
      graphMode: 'directed',
      nodeTypes: [{ id: type, label: '人物' }],
      nodes: [
        mk('a', 'ابن خلدون'),
        mk('b', '東京の学者（Tokyo）'),
        mk('c', 'محمد 123 abc'),
        mk('d', 'الطبري'),
      ],
      edges: [
        ['e1', 'a', 'b'],
        ['e2', 'b', 'a'],
        ['e3', 'b', 'c'],
        ['e4', 'c', 'd'],
        ['e5', 'd', 'a'],
      ].map(([id = '', s = '', t = '']) => ({
        id: toEdgeId(id),
        source: toNodeId(s),
        target: toNodeId(t),
        directed: true,
        weight: 1,
        attrs: makeAttrs([]),
      })),
      schema: [],
      meta: { title: 'サンプル' },
    },
  };
}

describe('FR-OUT-04: PDF のファイル', () => {
  const { dataset } = sample();
  const graph = buildGraph(dataset, applyFilters(dataset, DEFAULT_FILTER_STATE));
  const positions = new Map([
    [toNodeId('a'), { x: 0, y: 0 }],
    [toNodeId('b'), { x: 220, y: 0 }],
    [toNodeId('c'), { x: 220, y: 160 }],
    [toNodeId('d'), { x: 0, y: 160 }],
  ]);
  const scene = buildScene(
    graph,
    positions,
    {},
    {
      legend: {
        title: '凡例 / مفتاح',
        items: [
          { label: '人物', fill: '#0072b2' },
          { label: '向き', fill: '#666666', mark: 'arrow', lineWidth: 2 },
          { label: '欠損（値）', fill: '#999999', dashed: true },
          { label: 'ملاحظة', fill: '#999999', mark: 'line', dashed: true, attrMissing: true },
        ],
      },
    },
  );
  const content = renderPdfContent(scene, { background: '#ffffff', outline: shaper.outline });
  it('ページの内容に NaN や Infinity を含まず、図の大きさを pt で持つ', () => {
    expect(content.stream).not.toMatch(/NaN|Infinity|undefined/);
    expect(content.widthPt).toBeCloseTo(scene.width * 0.75, 6);
    expect(content.heightPt).toBeCloseTo(scene.height * 0.75, 6);
  });
  it('先頭は %PDF、末尾は %%EOF で、xref の位置が各オブジェクトの位置と一致する', async () => {
    const bytes = await buildPdf(content, { title: '日本語の題名 / عنوان' }, (d) =>
      Promise.resolve(new Uint8Array(deflateSync(d))),
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const entries = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5 + content.forms.length);
    entries.forEach((offset, i) => {
      expect(text.startsWith(`${String(i + 1)} 0 obj\n`, offset)).toBe(true);
    });
    // 日本語の題名は UTF-16BE の 16 進文字列（BOM FEFF）で入る
    expect(text).toMatch(/\/Title <FEFF[0-9A-F]+>/);
    expect(text).toContain('/Filter /FlateDecode');
    const out = process.env.RELATA_SAMPLE_DIR;
    if (out !== undefined) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/sample.pdf`, bytes);
      writeFileSync(`${out}/sample.svg`, renderSvg(scene, { background: '#ffffff' }));
    }
  });
});
