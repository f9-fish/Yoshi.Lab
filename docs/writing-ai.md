# 英作文AI添削：ドラフト実装・設定・リリース手順

## 今回の状態

既存の「解答する」を押すと、確認済みGoogleログイン時にcallable `reviewWriting`を1回呼び、正解／修正が必要／要確認、改善英文、日本語解説、良かった点、改善点、指定表現の判定を既存の結果パネルへ表示します。模範解答・別解・教材解説も維持します。追加のAIボタンはありません。

**初期状態はフロント・サーバーともAI無効です。** キー・課金・App Check・サーバー未設定でも、従来の登録解答との照合で学習できます。AI失敗・上限・未ログイン時も同じフォールバックです。XPは0のままです。既存account.js、Realtime Database、ランキング、Daily、通常学習、英検、教員画面の処理は変更していません。

本番Firebaseへの接続、課金変更、Secret登録、デプロイは実施していません。稼働中のRealtime Database Rulesは未確認で、変更しません。

## 構成

- `writing-ai-config.js`：公開設定（enabled、region、App Checkサイトキー）。秘密情報は置きません。
- `writing-ai-client.js`：既存Firebaseアプリを再利用する遅延SDK読み込み。Googleプロバイダー・確認済みメールを確認し、App Check limited-use token付きで第2世代callableを呼びます。
- `writing-ai-support.js`：AI結果の検査・25秒待機上限・従来判定へのフォールバック。
- `writing.js`：送信ロック、処理中表示、画面／問題／ログイン世代による古い結果破棄。次へ進めるのは添削完了後です。
- `functions/index.cjs`：Node.js 22・asia-northeast1・第2世代callable。認証、App Check強制とトークン消費、Secret、パラメーターを設定します。
- `functions/review-core.cjs`：入力・認証・問題バージョンの検証、個人識別情報の検査、プロンプト・構造化結果の検証。
- `functions/openai.cjs`：OpenAI Responses API。固定モデル `gpt-4.1-mini`、Structured Outputsのstrict JSON Schema、`store:false`、出力最大1000トークン、18秒で中止。自動再試行しません。
- `functions/quota.cjs`：専用の名前付きFirestore DB **writing-ai** で原子的な回数管理。既存のRTDB・Firestore既定DBを使いません。
- `functions/data/writing_questions.json`：サーバーが信頼する公開問題の配備用スナップショット。
- `functions/scripts/snapshot.cjs`：デプロイ前に既存パーサーで教材を検証し、上記へコピー。ネットワーク接続なし。
- `firestore.writing-ai.rules`：専用DBの全クライアント読み書きを拒否。Admin SDKはIAMで動作します。

## 問題データの整合性

クライアントが送るのは `questionId`、`answer`、`requestId`、`questionVersion`（採点対象教材のSHA-256）だけです。問題文・模範解答の申告は受け付けません。サーバーが配備済みの公開教材から、問題ID、日本語、指定表現、模範解答、許容解答、科目・Lesson・解説を取得し、これと英文をOpenAIへ送ります。

Apps Scriptによる教材更新後は、AI関数も再配備してください。`firebase.json`のpredeployが必ずスナップショットを更新します。未再配備／古いブラウザーの場合は教材ハッシュの不一致でAIを呼ばず、従来判定へ戻ります。既存のApps Script同期コードは変更していません。

## 認証・回数制限・費用の上限

- callableのFirebase Auth検証に加え、`email_verified === true`、`firebase.sign_in_provider === google.com`をサーバーで確認。未ログイン・匿名・他プロバイダー・未確認メールは拒否します。
- `enforceAppCheck: true`、`consumeAppCheckToken: true`。使用済みトークンは拒否します。App Checkのデバッグ用バイパスはコードにありません。
- サーバーの日本時間00:00区切りで、生徒別 **10回／日**、全生徒合計 **200回／日** が初期値です。`WRITING_AI_DAILY_LIMIT`（1〜100）と `WRITING_AI_GLOBAL_DAILY_LIMIT`（1〜10000）で変更できます。0等の不正値は停止として扱います。
- 生徒・全体・リクエストの3文書をFirestoreトランザクションで確認・予約してからOpenAIを呼びます。同じrequestIdは再実行せず、生徒ごとの同時添削も1件に制限します。別端末・別インスタンスでも上限を共有します。
- エラー・タイムアウト・画面離脱でも予約は消費します。返金・自動再送をしないため、失敗を繰り返して上限を回避できません。画面を閉じても、送信済みのサーバー処理が完了する場合があります。
- リクエスト本文は英文2000文字・UTF-8で6000 bytes以下、問題情報12000 bytes以下、OpenAIへの入力＋指示24000 bytes以下に制限。制御文字・未知のフィールドも拒否します。
- OpenAI応答全体は64000 bytesまで読み込み、返す添削結果は8000 bytes以下、文字列・配列にも上限があります。拒否・不完全出力・不正JSON・不整合な判定はフォールバックです。
- callable全体30秒、maxInstances=3、concurrency=10。クライアントも待機上限を持ちます。
- `WRITING_AI_ENABLED=false` がサーバー側の停止スイッチです。フロントだけの無効化は料金対策として信用しません。

**予算アラートは支出停止ではありません。** Firebase/GCP予算通知もOpenAIプロジェクトの予算通知も、通知だけで確実に停止する前提にはしません。この実装ではサーバー側の全体回数上限と固定モデル・トークン上限でOpenAIリクエスト量を制限します。最悪見積もりは「全体回数 ×（入力上限相当トークンの料金＋出力1000トークンの料金）」を使い、[最新料金](https://openai.com/api/pricing/)で確認してください。入力のトークン数は文字数だけで確定しないため、最大24000 bytesを保守的な入力トークン上限として見積もれます。

OpenAIの利用ダッシュボード／プロジェクト別Usageと、GCP BillingのCloud Run・Functions・Firestore・Secret Manager・Artifact Registry・reCAPTCHA Enterpriseの各費用を確認してください。全体回数の予約・失敗分も課金計画に含めます。上限到達後も不正なHTTPアクセス等のGoogle側の費用を完全にゼロにはできません。異常時はサーバーを無効化して再配備し、必要ならOpenAIキーを無効化・関数を停止してください。Google側の費用まで自動で確実に停止する仕組みは今回追加していません。

## 個人情報とログ

アプリの氏名・メール・UID・プロフィール・学習履歴をOpenAIへ送るフィールドはありません。サーバーでAuthのUID・メール・表示名が英文に含まれていないか確認し、メール・URL・電話らしい数字列も拒否します。拒否時はAIへ送らずローカル判定です。

自由入力された未知の人物名など、すべての個人情報を機械的に検出する保証はありません。生徒には英作文以外の氏名・連絡先・機密情報を書かない運用が必要です。特に教材以外の個人情報を入力する用途には使用しないでください。`store:false` はResponsesの保存を無効にしますが、OpenAIの不正利用監視等の保持条件までゼロにする指定ではありません。[APIデータ管理](https://platform.openai.com/docs/guides/your-data)を学校の運用に照らして確認してください。

コードは英文・添削・トークン・UID・外部エラー本文をログ出力しません。FirestoreにはUID／requestIdのハッシュ、日別回数、処理状態、期限だけを保存し、英文・AI結果は永続保存しません。画面内の結果とダウンロードJSONにはAI添削を追加するため、ダウンロードファイルの取り扱いには注意してください。プラットフォーム側の標準アクセスログ・保持期間も管理者が確認してください。

## 管理者が行うFirebase設定（今回は未実施）

まず検証用Firebaseプロジェクトで確認してください。本番課金プランやAPIを勝手に変更しないでください。

1. Firebase CLIで管理者ログインし、`.firebaserc`の対象が `yoshi-lab-db3eb` であることを確認します。必要なCloud Functions第2世代・Cloud Run・Cloud Build・Artifact Registry・Secret Manager・FirestoreのAPI／Blazeプランの状態を管理者が確認します。
2. **名前付きFirestore DB `writing-ai`** を作成します。既存のRTDBや `(default)` DBを置き換えません。例：
   ```sh
   gcloud firestore databases create --database=writing-ai --location=asia-northeast1 --type=firestore-native --project=yoshi-lab-db3eb
   ```
   すでに存在する場合は作成し直さず、用途・Rulesを確認してください。`firebase.json`のFirestore配備対象はこのDBだけです。
3. 専用DBのクライアントアクセス拒否Rulesを配備します：
   ```sh
   firebase deploy --only firestore --project yoshi-lab-db3eb
   ```
   既存の別設定を同じファイルへ統合する場合は、対象DBを再確認してください。`firestore.writing-ai.rules`を既存のdefault DBへ適用してはいけません。
4. `writingAiUsage`コレクショングループの `expiresAt` にFirestore TTLを有効にします（3日後、削除時刻は厳密ではありません）。例：
   ```sh
   gcloud firestore fields ttls update expiresAt --collection-group=writingAiUsage --enable-ttl --database=writing-ai --project=yoshi-lab-db3eb
   ```
5. Functionsの実行サービスアカウントに専用DBへの必要なアクセスとSecret参照権限を確認します。App Checkトークン消費には `roles/firebaseappcheck.tokenVerifier` が必要です。可能なら専用実行サービスアカウントとDB単位の最小権限を管理者が設定してください。アプリコードは既存DBを参照しません。
6. Firebase App Checkで既存Webアプリを登録し、reCAPTCHA EnterpriseプロバイダーにGitHub Pagesのドメインを登録します。公開サイトキーを `writing-ai-config.js` の `appCheckSiteKey`へ設定します。Firebase Authenticationの既存Google認証・承認済みドメインは維持します。他サービスのApp Check強制設定を一括変更しないでください。
7. OpenAI側でこの機能専用のプロジェクト／APIキーを作り、Secret Managerへ登録します：
   ```sh
   firebase functions:secrets:set OPENAI_API_KEY --project yoshi-lab-db3eb
   ```
   対話プロンプトへ入力します。コマンド引数、.env、GitHub、ブラウザー、チャットにキーを貼らないでください。
8. `functions/.env.example` をローカルの `functions/.env.yoshi-lab-db3eb` へコピーし、最初は `WRITING_AI_ENABLED=false`。検証後にtrueへ変更します。初期は生徒10回・全体200回より小さい全体上限で段階的に確認しても構いません。

## デプロイ手順（今回は実施しません）

```sh
npm ci --prefix functions --ignore-scripts
node --test --test-isolation=none tests/*.test.cjs
node functions/scripts/snapshot.cjs
firebase deploy --only functions:writing-ai:reviewWriting --project yoshi-lab-db3eb
```

codebaseを指定し、既存の別Functionsを削除・再配備しないよう、CLIが表示する対象を確認してください。関数は無効のまま認証・App Check・Rulesを確認します。Quotaの実動作は、検証用プロジェクトで小さい上限を設定して有効化した関数で確認してください。検証後に本番サーバーのenabledをtrueにして同じ関数だけ再配備します。最後に `writing-ai-config.js` のenabled=trueをレビューし、通常のGitHub Pagesの公開手順を行います。フロント公開はその後の別承認作業です。

教材をSheetsから同期した後も同じ関数を再配備してください。関数を停止するときはサーバーenabled=falseを再配備します。即時停止が必要ならOpenAIキーの無効化／関数の停止を管理者が行ってください。

## ローカルテストと限界

Node.js 24：`node --test --test-isolation=none tests/*.test.cjs`

Node.js 22：`node --test tests/writing-ai-server.test.cjs tests/writing-ai-client.test.cjs tests/writing-ai-ui.test.cjs`

OpenAI・Firestore・認証はモックで、キー・課金設定なしで実行できます。別解・文法修正・意味違い・不確実判定、失敗フォールバック、未ログイン、認証不正、App Check、日別／全体／同時上限、二重送信、結果混入防止、PII検査、出力制限、拒否・タイムアウト・再試行なしを検証します。UIテストは既存「解答する」を実行します。

ブラウザーでは外部通信を遮断し、320・390・1280pxで自動添削・修正・従来判定・二重送信防止・離脱後の破棄・未ログインを検証しています。実モデルの日本語理解・意味判定の精度は、モックテストでは保証できません。有効化前に教師が正解別解・時制・否定・意味違い・文法・指定表現の評価セットを実モデルで確認してください。AI判定は成績確定用には使いません。

実Firebaseの認証・App Checkトークン消費・IAM・名前付きDB・同時トランザクション、実OpenAIとの疎通・料金は未確認です。ステージングで検証してから本番へ進めてください。

## 依存関係の監査

Firebase公式SDKを固定：firebase-functions 7.4.0、firebase-admin 14.5.0。ロックファイルを追加しています。開発環境はNode24、本番FunctionsはNode22です。

`npm audit --omit=dev` は**中程度6件、high/critical 0**を報告しました。実体はglob／minimatchの2つのDoSアドバイザリーと、それを取り込むrimraf、google-gax、gaxios、gcp-metadataの依存チェーンです。`npm audit fix`では互換範囲内の解決に至りませんでした。破壊的なメジャー上書きを無理に追加していません。

生徒の英文や問題IDをファイルパターン・削除パスに使用するコードはありませんが、この監査指摘を解消したとは扱いません。**本番有効化前の確認事項**として、上流SDKの修正版／互換性を検証した更新、または依存箇所の到達可能性を含むセキュリティレビューを行ってください。この理由も含めドラフトPRで提出します。

参考：[Callable](https://firebase.google.com/docs/functions/callable)、[App Checkリプレイ保護](https://firebase.google.com/docs/app-check/cloud-functions)、[Secrets](https://firebase.google.com/docs/functions/config-env)、[Responses API](https://platform.openai.com/docs/api-reference/responses/create)、[Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)。
