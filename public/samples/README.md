# Maghrib sample

Title: Scholars and Sufis of the Maghrib in the Fifteenth and Sixteenth Centuries

This dataset records the social network of scholars and Sufis in the Maghrib during the fifteenth and sixteenth centuries. It is derived from _Dawḥat al-nāshir li-maḥāsin man kāna bi-l-Maghrib min mashāyikh al-qarn al-ʿāshir_ by Ibn ʿAskar al-Shafshāwanī (d. 986/1578), and was originally prepared for Palladio to visualize the network on a map.

利用者が公開を承認した `tests/fixtures/io/palladio/maghrib-20231106.json`（D-28）を、`npm run sample:generate` で再生成できるRelataプロジェクトへ変換したものです。

- 人物219、関係204をすべて保持。人物は元のIdで識別し、元表で一意なラベルから関係の参照を解決しています。From→Toの向きを保持し、師弟などの意味を補っていません。
- 元の型番号1〜4は意味を推測せずType 1〜4と表示します。
- YearはD-28に従いヒジュラ暦の年として幅のある日付に変換し、原文を保ちます。年40も含め、データを年代の推測で修正していません。生年・没年の区別は付けていません。
- 地名と座標を保持。空欄は記載なし（unrecorded）です。公開用の見本に架空の人物や関係を追加していません。
- 題名と説明は利用者が承認した英語です。JSON内のsourceでは書名のMarkdown強調記号を除いた平文を保存します。画面の日本語表示では和訳も添えます。
- savedAtの固定値は再生成の再現性のためで、史料や元データの作成日時ではありません。

元のPalladioプロジェクトを直接ブラウザへ読み込む機能はフェーズ4のFR-IN-11で、今回の見本変換はその一般化された実装ではありません。
