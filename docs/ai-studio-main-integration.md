# AI教材スタジオ：最新mainへの統合

## 基準と範囲

基準main: `8a4728c6`（PR #75最終確認時に取り込み）。
元実装: PR #66 / `feature/ai-material-studio-foundation` / `1eb335152213df3b47f254a406a2e86f83c3497f`。
古いブランチのマージは行わず、新しい統合ブランチに必要ファイルだけを取り込んでいます。

- 本番用 `teacher-studio.html`、`studio-study.html`、`studio-config.js`、`studio-content.json`。
- デプロイ済み構成に対応する `studio-functions/` と `studio.firebase.json`。
- HOMEメニューに生徒用AI教材・教員用スタジオへのリンク。教員画面にはスタジオリンクのみ追加。
- 旧 `functions/studio-api.js`、`functions/studio-core.js`、`studio-practice.html`、`studio-materials.json` は取り込まない。既存の英作文添削Functionsには変更なし。
- プレビュー専用認証、公開無効化、プレビュー用localStorageキー、Pages設定は取り込まない。

## 接続・モデル・デプロイ

フロントエンドのAPI接続先は `https://studioapi-bfaa4wjjga-an.a.run.app`。既存の `account.js` によるGoogleログイン・教員権限確認を再利用し、サーバーも教員UID・Google認証・確認済みメールを検証します。

**この統合にFunctionsの再デプロイは含まれません。既存の稼働APIを使います。** `studio-core.cjs`・package定義とlockは元ブランチから変更していません。PR #75最終確認では、index.jsのモデル未設定時の自動フォールバックだけを廃止しました。

利用者から稼働モデルはGemini 3.8 Flashと報告されています。稼働環境の正確なモデルIDは、この環境に認証済み管理CLI・APIがないため未確認です。モデル名を推測した設定は追加せず、既存の `STUDIO_GEMINI_MODEL` の値を使います。

元実装にあった未設定時の `gemini-2.5-flash` への自動フォールバックは廃止しました。再デプロイで変数が失われた場合、生成だけを503で拒否し、利用回数を消費せず、別モデルへの送信も行いません。公開前照合・公開処理には影響しません。今回、稼働中のFunctions・環境変数・Secretsは変更していません。

将来の再デプロイ前に、管理者がGoogle Cloud ConsoleのCloud Run → studioapi → 現在のリビジョン → 変数で `STUDIO_GEMINI_MODEL` の**正確な値だけ**を確認し、同じ値をデプロイ設定で保持してください。値がない場合は、稼働コードのモデル指定箇所を確認してください。Geminiキーなどの秘密値は表示・共有しないでください。実際のモデルIDが確認できるまでは再デプロイしないでください。

## 公開の挙動と注意

生成 → 編集・採用チェック → 公開前プレビュー → 利用者による確認 → 公開の順です。公開前プレビューは既存JSONのSHAを返し、公開ではそのSHAを照合します。別の更新があれば409で拒否します。

公開APIは `f9-fish/Yoshi.Lab` の `main` にある **studio-content.jsonだけ** をGitHub APIで更新します。既存のlessons/vocabulary/ronpyo/eiken/wordbook JSONへは書き込みません。公開を押すと本番にコミットされます。試験教材を公開しないでください。今回の検証ではAPIをすべてモックし、実公開・実生成は行っていません。

mainには当該ファイルがなかったため空配列 `[]` を追加しています。マージ直前にAPIがファイルを新規作成していた場合は、実データを空配列で上書きせず既存内容を保持してください。

## 生徒画面

`studio-study.html` は `studio-content.json` をcache:no-storeで取得し、科目 → Lesson/Part → 5種類から選択します。教材未登録の科目は開始できません。フィルター変更時は進行中の問題表示を閉じ、異なる問題種別の回答が混在しないようにしています。

通常教材への自動混入は行いません。AI教材は独立した練習で、XP・ランキング・学習履歴は変更しません。自由回答は模範解答との比較による自主学習で、AI採点はありません。T/Fだけ登録正解との一致を表示します。現行データには元本文の保存項目がないため、生徒用の本文閲覧機能はありません。

## ローカル検証

```sh
node --test --test-isolation=none tests/*.test.cjs
node --test --test-isolation=none studio-functions/tests/*.test.cjs
node --check studio-functions/index.js
node --check studio-functions/studio-core.cjs
node --check studio-config.js
python tests/studio-browser.py
```

ブラウザーテストはPython Playwrightと `/usr/bin/chromium` を使用し、外部通信をすべてモック・遮断します。390/1366pxで教員権限、生成の二重送信防止、編集、下書き保存復元、公開キャンセル／確認（モック）、ログアウト時の結果消去、生徒の5形式、科目分離、フィルター変更、横はみ出しを検証します。

APIテストもVMとメモリー内代替で実施し、認証・CORS・回数制限・モデル設定・生成失敗・公開前照合・SHA競合・公開先が専用JSONに限定されることを確認します。実Firebase・Gemini・GitHubのデータ変更はありません。

既存mainのNodeテストは414件中408成功・Q&A関連6失敗・スキップ0でした。既存のヒント／状態遷移／公開JSONとサーバースナップショットの不一致で、今回の変更前にも再現しています。期待値変更や該当コードの変更は行いません。

## マージ前後の管理者確認

- 稼働APIの正確なモデル・CORS・教員権限・GitHubトークン権限は未確認。既存プレビューで動作確認済みとの報告はありますが、本PRで実APIの再検証は行っていません。
- GitHub PagesのOriginは本番と既存プレビューで共通の `https://f9-fish.github.io`。配信設定・承認済みドメイン・Rulesは変更していません。
- マージ後に実教員アカウントの認証・生成・保存復元を確認し、公開は正式教材のみで行う。
- 本番用下書きは元実装のブラウザ内保存です。端末間共有・自動バックアップはなく、プレビューの下書きは自動移行されません。
- 既存mainは教材の自動同期で更新されます。マージ前に最新mainと専用JSONの有無を再確認する。

統合後の結果：既存414件中408成功・6失敗・スキップ0（変更前と同じ）。スタジオ用20件は全成功。390/1366pxのブラウザーテストは成功。git diff --check・JavaScript構文チェックも成功。


## PR #75：最新main追従・最終検証

- 最新main `8a4728c6` を競合なしでマージ。mainにstudio-content.jsonはまだ存在せず、既存の公開データを空配列で上書きしていません。
- 元の導線追加以外、HOME・教員画面の構造、既存Functions・既存教材・認証・XP・ランキング・Daily・単語帳は変更なし。
- 最新mainをgit archiveで別の一時フォルダへ展開し、変更前414件を独立して再実行。統合側も414件を実行し、両方とも408成功・同一の6失敗・スキップ0。
- 失敗原因：公開Q&Aは25問、Functionsスナップショットは21問。Lesson8のPart1が4問追加され、旧テストの科目／Lessonを絞らないPart1抽出が9問を選んでいます。
  - Spark交代3件：5問の想定に対して9問で失敗。
  - Functionsのヒント1件・Spark状態遷移1件：全LessonのPart1から作ったバージョンと、Lesson7だけを使うルーム作成のバージョンが不一致。
  - JSON整合性1件：公開25問とサーバー用21問が不一致。
- 上記は変更前mainでも再現し、本PRと無関係です。Q&Aコード・データ・期待値は修正していません。
- スタジオ23件は全成功（モデル未設定・空白・明示値・公開前照合の追加検証を含む）。PC1366px・スマホ390pxの外部通信遮断ブラウザーテスト、構文チェック、git diff --check成功。
- 稼働モデルの確認は管理者によるConsole確認が残ります。これはソースのモックテストでは代替できません。mainへのマージ・Pages設定変更・再デプロイ・教材公開は行っていません。

最終取り込みmainは8a4728c6です。独立テストを実行した13a84e00とgit diffで全ファイルの内容が同一であることを確認しました（教材同期の履歴だけ追加）。
