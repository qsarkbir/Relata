# PDF の書き出し用フォント（D-43、T2-08）

PDF の書き出しのときだけ、アプリが読み込みます（最初の画面の読み込みには入りません）。
外部のサーバーには接続せず、このフォルダのファイルを同じサイトから取得します（NFR-02）。

| ファイル                                   | フォント                  | 用途         | ライセンス                                             |
| ------------------------------------------ | ------------------------- | ------------ | ------------------------------------------------------ |
| `NotoSansJP-Regular.ttf`（約 5.7 MB）      | Noto Sans JP Regular      | 日本語、欧文 | SIL Open Font License 1.1（`OFL-NotoSansJP.txt`）      |
| `NotoNaskhArabic-Regular.ttf`（約 0.2 MB） | Noto Naskh Arabic Regular | アラビア文字 | SIL Open Font License 1.1（`OFL-NotoNaskhArabic.txt`） |

- 入手元: npm パッケージ `@expo-google-fonts/noto-sans-jp` 0.4.4、`@expo-google-fonts/noto-naskh-arabic` 0.4.5 が配布する
  Google Fonts の Noto の TrueType ファイル（改変していない）。
- ライセンスの全文は、同じフォルダの `OFL-*.txt`。「このツールについて」にも、フォントとライセンスを載せている。
- フォントは加工せず、ファイルのまま配信する（OFL の予約フォント名の規定のため。使った文字だけに絞ると改変にあたる）。
- 文字は、harfbuzzjs で整形した字形の輪郭として PDF に描く。フォントそのものは PDF に埋め込まない。
