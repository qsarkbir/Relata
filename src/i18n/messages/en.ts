import type { MessageKey } from './ja';

/**
 * 英語の辞書。日本語の辞書と同じキーをすべて持つ。
 */
// 【TS】`satisfies` は「この型の条件を満たすか」を検査しつつ、値の型は推論のまま残す演算子。
//       `Record<MessageKey, string>` は「キーが MessageKey のすべてで、値が文字列」の型。
//       キーが足りなければ訳し漏れ、余分なら打ち間違いとして、どちらも型エラーになる。
// 【なぜ】型注釈（`: Record<...>`）ではなく `satisfies` を使うのは、検査だけを行い、型を広げないため。
export const en = {
  'app.title': 'Relata',
  'app.documentTitle': 'Relata',
  'app.tagline': 'A network visualization tool for historical research',
  'app.empty.title': 'No data has been loaded yet',
  'app.empty.body':
    'Once you load tabular data (CSV, Excel, etc.), graphs and metrics will appear here. Loading is not available yet.',
  'app.region.filters': 'Filters',
  'app.region.main': 'Main display',
  'app.region.metrics': 'Metrics',
  'app.region.filters.placeholder': 'The filter panel will be placed here.',
  'app.region.metrics.placeholder': 'Metrics will be shown here.',
  'locale.label': 'Language',
  'about.open': 'About this tool',
  'about.title': 'About this tool',
  'about.close': 'Close',
  'about.origin':
    'Relata carries over the features of Palladio by Humanities + Design, Stanford University (BSD-3-Clause), rebuilt in TypeScript.',
  'about.license':
    'Relata is licensed under BSD-3-Clause. The Stanford University copyright notice applies to the portions derived from Palladio.',
  'about.privacy': 'The data you load is never sent outside your browser.',
  'about.libraries': 'Libraries used',
  'about.libraries.name': 'Name',
  'about.libraries.license': 'License',
  'about.palladioLink': 'Palladio repository (GitHub)',
  'about.copyright': 'Copyright notices',
  'about.licenseFull': 'Full license text (BSD 3-Clause)',
  'tasks.started': '"{label}" started',
  'tasks.finished': '"{label}" finished',
  'tasks.region': 'Tasks in progress',
  'tasks.cancel': 'Cancel',
  'tasks.cancelLabel': 'Cancel "{label}"',
  'tasks.unknownProgress': 'Working',
} satisfies Record<MessageKey, string>;
