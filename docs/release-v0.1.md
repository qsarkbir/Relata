# v0.1 公開前チェック

最終更新2026-11-22。T1-25は準備中。公開準備は[draft PR #33](https://github.com/qsarkbir/relata/pull/33)（CI成功）、統合版はPR #31。mainへの統合は利用者が行う。

| 項目                 | 証跡と状態                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------- |
| MVP統合・UC-1        | ローカル730単体・E2E88件・型・lint・整形・build成功。PR #31のCI成功                   |
| 個別タスクのレビュー | PR #18〜#30を参照。#26〜#30はGitHub CI成功                                                  |
| 旧Palladio精査       | [対応表](regression-coverage.md)のMVP範囲は検証済み。地図等の後続フェーズを完了扱いにしない |
| NFR-03〜05 性能      | 以下の測定を実施し条件と結果を記録する。閾値未達なら未達のまま記録する                      |
| NFR-06 対応ブラウザ  | Chromium E2E成功。最新版Chrome・Edge・Firefox・Safari実機は未確認                           |
| NFR-11 core網羅率    | `npm test`でcore各80%以上の閾値が成功。統合PR #31のCI成功                                     |
| 操作案内             | READMEの日英を統合版の操作に更新。配信済みと未統合を区別する                                |
| 版                   | 現在package.jsonは0.0.0。公開条件を満たすときに0.1.0へ更新する                              |
| 配信と公開サイト     | 利用者がmainへ統合後、CI verify→deploy成功、実際のサンプル・取込・SVG・保存復元を確認する   |

## 性能測定

Node24で依存を導入し、他のテストと同時に実行せず、専用ポートで測定する。

```powershell
$env:RELATA_E2E_PORT = '4194'
npm exec -- playwright test --config playwright.performance.config.ts
```

通常CIはこの測定を実行しない。`performance-results/results.json`のJSON添付に再描画・指標の時間、パンのフレーム間隔と目標達成判定を残す。機種、OS、ブラウザ、描画条件も結果に併記する。閾値の成否はJSONの判定を見る。テストの成功は操作と測定の完走を意味し、性能目標の達成を意味しない。

初期配置は保存済みの固定座標、ラベルは選択中のみ。NFR-04は1000ノード/5000エッジから半数の型へ絞り込み、操作開始から画面確認までを測る。指標はdebounce時間を含む。NFR-03/05は2000/8000と5000/20000で、指標を取消後にキーでパンを30回行う。ズームや別の配置・全ラベルでの性能、実際の表示装置での描画フレームを保証する測定ではない。

## ブラウザの確認

```powershell
$env:RELATA_E2E_PORT = '4195'
npm exec -- playwright test --config playwright.browsers.config.ts --project chrome --project edge --output test-results/chrome-edge
# Firefox/WebKitを未導入なら先に npm exec -- playwright install firefox webkit
npm exec -- playwright test --config playwright.browsers.config.ts --project firefox --project webkit --output test-results/firefox-webkit
```

Chrome/Edgeはインストール済み製品版を使う。Firefox/WebKitはPlaywright同梱エンジンであり、WebKit成功を実機Safariの確認と同一視しない。性能測定と同時に実行しない。ブラウザ群を並行実行する場合は、上記のように記録の出力先を分ける。各結果にはバージョンを残す。

## 2026-11-21 の測定記録

Windows 10.0.26300 x64、Intel Core Ultra 5 225F（10論理CPU）、Playwright Chromium 159.0.8154.6、ヘッドレス。実行中に他のブラウザ検証は行っていない。以下は保存済み固定配置と選択中のみラベルでの単回診断値。

| 条件                                    | 結果                                | この条件での判定                |
| --------------------------------------- | ----------------------------------- | ------------------------------- |
| 1000ノード/5000エッジから半数の型に絞込 | 再描画227.2ms、指標完了635.9ms      | 500ms/2000ms以内                |
| 2000ノード/8000エッジのパン             | requestAnimationFrame基準55.48回/秒 | 診断上30回/秒以上               |
| 5000ノード/20000エッジのパン            | 操作完走、同23.05回/秒              | この規模のfps閾値は設けていない |

実画面の描画fps、全ラベル・ForceAtlas2初回計算・他のデータ形状の性能まで確認済みとは扱わない。各対応ブラウザの結果と公開サイトの確認は別に記録する。

## Firefoxで残る確認（2026-11-21）

- フィルタのキーボードE2E: FirefoxではSUMMARY→スクロール一覧UL→checkboxのTab順になることを実測。最大5回のTabで対象に到達してSpaceで選ぶ検証へ変更し、Firefox単独で成功。操作自体の不具合ではない。
- 保存・再読込E2E: ノード型を追加で絞った後、適用中のフィルタの文字列を読む付近でPage crashed。workers=1でも再現したため調査中。アプリの問題かエンジン・自動化環境の問題かは未確定。

通常のChromium、製品版Chrome/Edge、WebKitの成功をFirefox確認の代わりにしない。公開準備PRはdraftで提出し、調査結果を追記する。
