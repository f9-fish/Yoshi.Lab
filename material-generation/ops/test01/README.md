# 作成済みTEST01を使う接続準備（生成・追記はまだ無効）

対象：<https://docs.google.com/spreadsheets/d/1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc/edit>

**このシートを作り直しません。** 本番main、稼働Functions、既存Apps Script、Pagesを変更しません。本番2シートID拒否・英単語追記禁止・未承認公開禁止は維持します。

## 確認状況

5タブの列仕様は、利用者が確認した構成とコードの期待値が一致しています。一方、この環境には認証済みSheets接続がないため、実シートの現在の列・6文・共有権限は直接確認していません。「実接続確認済み」とは扱いません。

次の読み取り専用の関数で、管理者自身のGoogleアカウントから確認できます。これらの実行は教材生成・シート追記・公開をしません。

- `mgInspectTest01Sheet`：5タブの列名・列順・データ行数、科目/Lesson/Part別の文数を表示。本文はログに出しません。
- `mgShowAppsScriptAudience`：本人トークンのaudienceとissuerだけ表示。トークン全体・メール・subは出しません。ここでのデコードは署名検証ではなく、サーバー設定値の発見だけです。
- `mgCheckTest01Connection`：署名・教員権限・列メタデータを専用サーバーで確認。ジョブ・保存・生成・追記はすべて拒否するモードです。

## 1. まずGoogle Sheets / Apps Scriptだけで確認する

1. 上の作成済みテストシートを開く。「拡張機能」→「Apps Script」を開く。
2. 新規のテスト用プロジェクトであることを確認し、分かりやすい名前（例：YoshiLab TEST01 接続確認）にする。既存コードがある場合は削除しない。本番シートのプロジェクトへは貼り付けない。
3. 左の「＋」→「スクリプト」で、次の2ファイルの内容をそれぞれ追加する。
   - `apps-script/material-generation-client.gs`
   - `apps-script/material-generation-preflight.gs`
4. 左の歯車「プロジェクトの設定」で「appsscript.json マニフェスト ファイルをエディタで表示する」をオンにする。
5. この新規テストプロジェクトの `appsscript.json` に、`material-generation-preflight-appsscript.example.json` の内容を設定する。初期段階ではDrive権限・高度なSheets書き込みサービスを追加しない。
6. 関数選択欄で `mgInstallTest01Defaults` を選び「実行」。本人の権限承認が必要。組織が未承認アプリを禁止している場合は学校の管理者へ確認し、知らないアプリの警告を回避しない。
7. 「プロジェクトの設定」→「スクリプト プロパティ」で、下の安全な初期値が入ったことを確認する。この関数は既存設定を上書きしない。
8. `mgInspectTest01Sheet` を実行し、「実行ログ」を確認する。期待値は5タブで `headersMatch:true`、本文マスター6行、他4タブ0行、TEST01/Part1が6文。合わない場合は停止し、シートを勝手に修正しない。
9. 任意で `installMaterialPreparationMenu` を実行すると、同じテストシートに「AI教材・接続準備」メニューを表示できる。onOpen/onEditや時間トリガーは作成しない。

初期マニフェストのSpreadsheet権限はGoogleの表示上は広い編集権限を含みます（Apps Scriptの標準Spreadsheetサービスを使うため）。確認関数はコード上のID固定と読取処理だけを使い、シートへ書き込むメソッドを呼びません。権限をID単位に制限するOAuth設定だと誤解しないでください。

### 初期Script Properties

`script-properties.json` を参照。APIキーやトークンは一切入れません。

| 名前 | 初期値 |
|---|---|
| MG_SOURCE_SPREADSHEET_ID | `1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc` |
| MG_TEST_SPREADSHEET_ID | 同じID |
| MG_MODE | TEST |
| MG_ENABLED | false（生成ジョブ操作OFF） |
| MG_PREFLIGHT_ENABLED | false（サーバー準備後だけtrue） |
| MG_TEST_APPEND_ENABLED | false |
| MG_AUTH_VERIFIED | false |
| MG_JOB_STORAGE_VERIFIED | false |
| MG_SERVER_URL | 空欄（新規テストサーバーURLを後で設定） |
| MG_TEST_JOB_FOLDER_ID | 空欄（生成段階まで不要） |
| MG_GENERATION_SETTINGS | 英作文10問だけ、ミステリー、revision 1。他の種類0 |

## 2. Apps ScriptのOAuth client IDを確認する

1. `mgShowAppsScriptAudience` を実行する。`openid`・メールの承認が必要。
2. 実行ログまたはダイアログの `audience` だけをコピーする。通常 `...apps.googleusercontent.com` という文字列。
3. 新規サーバーの `MG_GOOGLE_AUDIENCE` にそのまま設定する。トークン全体をチャット、シート、Script Propertiesへ貼らない。
4. サーバーは別途Google公式ライブラリで署名・期限・audienceを検証する。表示されたaudienceだけで「認証成功」と判断しない。

Cloud側で確認する場合は、Apps Scriptの「プロジェクトの設定」→「Google Cloud Platform（GCP）プロジェクト」のプロジェクト番号を確認し、Google Cloud Consoleでそのプロジェクトを選ぶ。「Google Auth Platform → クライアント」、または「APIとサービス → 認証情報」で該当OAuth client IDを照合する。デフォルトプロジェクトで一覧が見えない場合は、無理に別のIDを使わず、先に上の関数のaudienceを確認する。標準Cloudプロジェクトへの切替が必要なら、**新規テストプロジェクトだけ**を管理者が設定する。変更後はaudienceを再取得する。

## 3. 推奨Google Cloud構成と費用

推奨は**本番とは別のテスト用Google Cloudプロジェクト**に、以下を置く方法です。現在はどれも作成・デプロイしていません。

| リソース | 接続確認段階 | 生成段階 |
|---|---|---|
| Cloud Run：新規テストサービス | 必要。最小インスタンス0、最大1、同時実行1、512MiB程度から、リクエスト課金 | 同じサービスをテスト用に更新。既存Functionsは触らない |
| 専用サービスアカウント | 必要。本人認証後の教員照合用 | 同じアカウントへ必要な権限だけ追加 |
| Artifact Registry / Cloud Build | コンテナ作成・保存に使用 | 更新時に使用 |
| Cloud Storage | 接続確認だけなら不要 | 私有のテスト専用バケットでジョブ・ロック・回数管理を永続保存 |
| Secret Manager | 接続確認だけなら不要 | Geminiキーだけを対象Secretとして参照 |
| Firestore / 新規Functions / VM / 固定IP / 独自ドメイン | 不要 | この構成では不要 |

Cloud Runの一時ディスクには保存しません。追加したGCSアダプタは、オブジェクト世代番号の条件付き作成で排他ロックし、条件付き更新で競合を検出します。停止時の不明なロックは自動解除せず、既存の管理者復旧手順を使います。

費用はCloud Runの要求・実行時間、コンテナ保存・ビルド、GCSの小容量保存とAPI操作、Secret Manager、ログ、Gemini利用量で決まります。最小0なら常時VM課金を避けやすい構成ですが、無料を保証しません。正確な現在価格は未取得です。Cloud Consoleの料金見積りで管理者が月予算を確認してください。東京リージョンでVMを常時稼働する構成は、ディスク・外部IPv4も継続課金されるため、今回は選びません。

最大インスタンス1・1日10種類生成・教員確認・テスト1ケースからの開始で費用を抑えます。予算アラートは通知であり、自動的な支出停止ではありません。Gemini側の利用制限も確認してください。

## 4. サービスアカウントと権限を管理者が確認する

- テストプロジェクトに専用サービスアカウントを作り、Cloud Runの実行IDとして指定する。Owner/Editorを一括付与しない。JSON秘密鍵を作成・共有しない。Cloud RunのADCを使う。
- 教員確認は本番Firebaseの既存アカウントと `teacherUids/{uid}` を**読み取りだけ**で照合する。新しいユーザー・権限を作らない。
- Firebase Authenticationの参照権限（例：Firebase Authentication Viewer、または管理者が確認した最小カスタム権限）と、Realtime Databaseの読み取り権限が必要。未付与ならここで停止する。
- **IAMだけでRTDBの参照範囲をteacherUidsだけに制限できるとは保証しない。** Admin SDKの権限はSecurity Rulesと同じ境界ではない。コードはteacherUidsだけを読むが、サービスアカウントへ付ける実際の閲覧権限範囲を本番管理者が確認する。過剰なDatabase Admin/Editorを便宜的に付与しない。
- 接続確認段階ではGeminiキー・GitHubトークン・GCS書き込み権限を渡さない。
- 生成段階だけ、テストバケット単位のオブジェクト読取・作成・更新・削除（例：Storage Object User）と、Gemini用Secret単位のSecret Accessorを追加する。プロジェクト全体のStorage Adminや全Secret参照権限を付与しない。
- 実行者がFirebaseでGoogle providerとして登録済み・確認済みメール・無効化されていない・teacherUids=trueであることを確認する。メールだけでなくGoogle subもサーバーで照合する。

IAMやGoogle Workspaceの設定は今回変更していません。上の権限が組織方針上許可できない場合は、未検証の別認証方式で強行しないでください。

## 5. 新規Cloud Runサービスを接続確認モードで用意する（管理者のみ）

この段階で課金設定・新規サービスの作成が発生します。管理者が構成と費用に同意してから行ってください。本番studioapiは選択しません。

1. テストCloudプロジェクトを選び、Cloud Run / Cloud Build / Artifact RegistryのAPIを有効にする。
2. コードは `feat/sheet-material-generation-phase3` の最新コミットを使う。Dockerfileは `material-generation/ops/test01/Dockerfile`、ビルドコンテキストはリポジトリのルート。Cloud Buildで管理者がコンテナイメージを作り、Artifact Registryへ保存する。Dockerfileには有効化設定や秘密値を焼き込んでいない。
3. Cloud Runで「サービスを作成」。新しい名前（例：yoshilab-material-test01）、asia-northeast1など管理者が選んだリージョン、専用実行アカウント、ポート8080、タイムアウト120秒、最小0・最大1・同時実行1を設定。
4. 環境変数は `preflight.env.yaml` を参照し、**空欄のMG_GOOGLE_AUDIENCEだけを確認値で埋める**。`MG_PREFLIGHT_ENABLED=true`、`MG_ENABLED=false`、`MG_TEST_APPEND_ENABLED=false` の組合せにする。モデル・キー・保存先はこのモードには不要。
5. Cloud Runのプラットフォーム認証を使う場合、Apps Scriptのaudienceは通常のCloud RunサービスURLとは違い、そのままではIAMの手前で拒否される。本実装の標準手順は、新規テストサービスだけをプラットフォーム上は未認証呼出し可にし、アプリ内でGoogle署名・教員権限を必ず検証する方式。**URLは外部から到達可能だが、無認証で教材や生成機能を使える構成ではない。** 認証必須の既存サービス設定は変更しない。組織方針でこの方式を禁止している場合は停止して管理者と設計を再検討する。
6. 新規サービスをデプロイ後、表示されたHTTPS URLをコピーする。初回はアプリのGETページが404でも異常とは限らない。確認はApps ScriptからPOSTで行う。
7. 新規サーバーは `/preflight` だけを使う。`/enqueue`・`/step`・`/plan`・`/get` は接続確認モードで拒否され、ジョブ・回数データも保存しない。`/publish` は存在しない。

この環境からCloud Build・Cloud Runの作成/デプロイは実行していません。既存Functionsの再デプロイも不要です。

## 6. 認証・Sheets接続だけを検証する

1. Apps ScriptのScript Propertiesで、`MG_SERVER_URL` に新しいHTTPS URL、`MG_PREFLIGHT_ENABLED` にtrueを設定する。
2. **MG_ENABLED / MG_TEST_APPEND_ENABLED / MG_AUTH_VERIFIED / MG_JOB_STORAGE_VERIFIEDはfalseのまま**にする。Driveフォルダもまだ不要。
3. `mgCheckTest01Connection` を実行する。
4. 成功時はmode=PREFLIGHT、authenticated=true、teacherVerified=true、5タブの列一致、generationEnabled=false、testAppendAllowed=false、publishEnabled=false、vocabularyAppendAllowed=falseとなる。
5. 実行ログには列名・件数・認証結果だけが出る。本文・トークン・Geminiキーは出ない。

失敗時の目安：401はaudience/Googleトークン/権限承認、403は教員登録・Google sub・テストID、503は教員登録の参照権限や接続確認モードを管理者が確認する。Cloud Runの手前で403ならプラットフォームIAMも確認する。エラーを避けるため本番Rulesを緩和しない。

## 7. 実Geminiで英作文だけを生成する（接続確認後の別段階）

1. 現行studioapiのCloud Run設定を**閲覧だけ**し、`STUDIO_GEMINI_MODEL` の正確な値を管理者が確認する。未設定なら稼働コードの指定箇所を確認。モデル名を推測しない。既存サービスの編集・保存・再デプロイはしない。
2. テスト専用GCSバケットを作る。一般公開禁止・Uniform bucket-level accessを使用。本番バケットを指定しない。ロックオブジェクトを削除できなくなる保持期間ロックは設定しない。soft deleteや世代保存の費用・復旧方針も管理者が決める。
3. GeminiキーをSecret Managerから新規テストサービスへ環境変数 `MG_GEMINI_API_KEY` として紐付ける。コード・YAML・Script Properties・チャットに値を貼らない。
4. `generation.env.yaml` に確認済みaudience・モデル・テストバケットを設定する。接続確認専用モードを終了し、管理者確認後だけ `MG_ENABLED=true, MG_AUTH_VERIFIED=true, MG_STORAGE_VERIFIED=true` にする。`MG_TEST_APPEND_ENABLED=false` は維持。Cloud RunでFileStoreを選ぶと起動を拒否する。
5. Driveに教員本人だけのテスト用フォルダを作る。共有ユーザーと一般アクセスを確認する。Apps Scriptには、そのフォルダID、確認済みの `MG_AUTH_VERIFIED=true, MG_JOB_STORAGE_VERIFIED=true` を設定。生成段階では元の `material-generation-appsscript.example.json` をレビューして使い、Drive権限を承認する。高度なSheetsサービスは追記時に使う。
6. Apps Scriptの `MG_PREFLIGHT_ENABLED=false, MG_ENABLED=true` に変更。英作文10問だけの初期設定を維持し、本文マスターのTEST01/Part1の行を選択して `mgEnqueue` → `mgRunWorker` を実行する。
7. `mgRunWorker` または状態取得で要確認になることを確認し、私有Driveの結果を見る。シートへの追記はまだしない。
8. `writing-review.cjs` とPhase 3評価手順に従い、和英対応・文法・指定語・別解・ヒント・独立性・難易度・起承転結を教員が評価する。重大不備があれば不採用。実モデルID・日時・設定・本文ハッシュを記録する。

## 8. テストシートへ要確認で追記する（生成品質確認後）

1. 同じ作成済みテストID、ヘッダー、既存行を再確認。既存同期や公開トリガーがこのテストブックへ付いていないことを確認する。
2. 高度なSheets APIを新規テストApps Scriptで有効にし、承認する。
3. `mgPreviewAppend` を実行。英作文だけなら追加10・変更0・削除0が目安。生成不足や既存重複があれば実際の件数を見る。
4. 教員確認後、新規テストサーバーとApps Scriptの両方の `MG_TEST_APPEND_ENABLED=true` を設定する。
5. `mgAppendTestDrafts` を実行し、ダイアログのIDが作成済みテストIDであることを確認。全行「要確認」で末尾追加される。
6. 同じ操作を再実行し、追加0・重複として検出されることを確認。既存値や公開状態が変わっていないことを確認。
7. 確認後、両方の追記フラグをfalseへ戻す。英単語はこの設定でも追記できない。

4系統を試すのは英作文の確認後。設定のcountsを単語15/Q&A10/英作文10/正誤10へ変更し、revisionも増やして新規候補とする。英単語は生成・保存まで。Discussionは既存行を保持し、必要なときだけ任意に追加生成する。

本番シートへの接続・教材公開・mainマージ・Pages変更・既存Functions再デプロイは、この手順にも含めません。
