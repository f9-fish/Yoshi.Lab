# Phase 4：独立TEST02の準備と英作文10問の1試行

TEST01の31秒/Gemini503/Cloud Run200/生成0/attempted=trueは管理者確認済みです。TEST01のサービス設定、バケット、ジョブ、予約、試行マーカーは一切変更しません。

## 分離するもの・再利用するもの

| 項目 | TEST02 |
|---|---|
| Cloud Run | 新規 `yoshilab-material-test02`、東京、最小0/最大1、同時実行1、120秒/512MiB |
| 実行SA | 新規 `yoshilab-material-test02@yoshi-lab-db3eb.iam.gserviceaccount.com`、JSON鍵なし |
| GCS | 新規 `gs://yoshi-lab-db3eb-material-test02-jobs`、PAP enforced、Uniform bucket-level access |
| 保存prefix/予約 | `material-generation-test02` / `PHASE4-TEST02`。ジョブIDにもTEST02を含むhashでTEST01と区別 |
| Apps Script | 新しい**スタンドアロンのテスト専用プロジェクト**。TEST01/本番のスクリプトへは貼らない |
| 教材入力 | 既存シート `1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc` の英C/TEST01/Part1の6文をGETだけで再利用 |
| Secret | 既存 `yoshilab-material-test01-gemini` の確認済み数値バージョンを参照。キー値を表示/コピーせず、新しいSAへの対象Secret単位Accessorだけ追加。既存バージョン・既存メンバーを変更しない |
| 生成処理/診断 | 既存engine/Gemini/GCS/auth/review/503診断を再利用。モデルは `gemini-3.8-flash` 固定、別モデル切替なし |
| Docker/Build | 既存Dockerfile/cloudbuild.yamlを再利用、イメージ保存は新規TEST02用Artifact Registryリポジトリ |

TEST02でも1ジョブ/1試行。失敗時もattemptedは消費済みで、再生成・自動再試行はありません。追記プラン/英単語追記/教材公開は禁止。初回デプロイでは追加のサーバー側生成承認フラグ=falseで、認証確認はできてもenqueue/stepは拒否します。

## 最小IAMと費用の確認

実行SAに付けるのは次だけです。スクリプトはTEST01のIAMロールを丸ごとコピーしません。

- 対象TEST02バケットのみ `roles/storage.objectUser`。
- 上記対象Secretのみ `roles/secretmanager.secretAccessor`。
- 新しい専用カスタムロール `projects/yoshi-lab-db3eb/roles/yoshiLabMaterialTest02Reader`：**`firebaseauth.users.get` と `firebasedatabase.instances.get` の2権限だけ**をプロジェクトに付与。既存同名ロールが余分な権限を持つ場合は停止し、自動更新しない。

Firebase Authは教員ユーザー検索、RTDBは既存 `teacherUids/<uid>` の1フラグGETにだけ使用。**IAMでRTDB読み取りをそのパスだけへ制限する構成ではありません。** この読取範囲を管理者が確認した場合だけ `MG_FIREBASE_READ_CONFIRMED=true` を指定します。RulesやFirebaseデータは変更しません。権限不足・組織ポリシー拒否時は停止し、Editor/Database Adminなどへ広げません。プロジェクトIAMで新SAに想定外のロールがあれば停止しますが、上位組織/フォルダ/グループ等からの継承は管理者が別途確認してください。

操作者には新SA/カスタムロール作成・そのプロジェクトバインド、対象バケット/SecretのIAM管理、Build/Artifact Registry/Run作成・SA actAs権限が必要です。実行SAにこれらの管理権限は付けません。新TEST02だけCloud Runプラットフォームは未認証到達可能にしますが、アプリでGoogle署名/audience/期限/教員権限を必ず検証します。禁止する組織ポリシーなら迂回しません。

Cloud Run/Build/コンテナ/GCS（標準soft delete含む）/Secret/ログ/モデルの実料金・利用枠を確認してください。1リクエストの出力上限12,000トークン、入力6文と指示/スキーマ。思考トークンも課金に影響し、無料は保証しません。予算通知は支出停止ではありません。参考：<https://aistudio.google.com/docs/pricing>。

## 1. Cloud Shellでコード取得・Sheets API準備

新しいディレクトリに取得します。既存checkoutを利用する場合は変更を保護した上で対象ブランチをfast-forwardしてください。

```bash
git clone --single-branch --branch feat/sheet-material-generation-phase3 https://github.com/f9-fish/Yoshi.Lab.git Yoshi.Lab-test02
cd Yoshi.Lab-test02
gcloud services enable sheets.googleapis.com --project=yoshi-lab-db3eb
gcloud projects describe yoshi-lab-db3eb --format='value(projectNumber)'
```

最後の**プロジェクト番号**を次の新Apps ScriptのGCPプロジェクト指定に使います。Sheets APIを有効にするだけで、既存Apps Scriptやシートの値・共有は変更しません。

## 2. 新TEST02 Apps Scriptを一度作成してaudience確認

1. <https://script.google.com/> から**新しいスタンドアロンプロジェクト**を作り、TEST02と命名します。既存TEST01/本番のプロジェクトやシートの拡張機能からは作業しません。
2. プロジェクト設定でマニフェスト表示を有効にし、新規コードに `apps-script/material-generation-test02.gs`、appsscript.jsonに `apps-script/material-generation-test02-appsscript.example.json` を設定。他のクライアントファイルは不要です。
3. この**新規プロジェクトだけ**のGCPプロジェクトを上の `yoshi-lab-db3eb` の番号へ関連付け、Sheets APIが有効なプロジェクトを使用します。既存のOAuth同意設定が組織ポリシーに適合することを確認。TEST01のGCP関連付けやコードは変更しません。audienceが既存と同じになる場合もありますが、実際の取得値を必ず使います。
4. `mg02Inspect` を実行し、本人としてOAuth承認します。スコープはopenid/email、外部接続、**spreadsheets.readonly**。Drive・Sheets編集権限は不要です。APIキー・IDトークン・OAuthアクセストークンは表示しません。
5. ログに `sourceRows:6 / headersMatch:true / sheetsReadOnly:true` とaudienceが表示されます。署名検証はこの時点では行わず、後のCloud Run接続で確認します。元の6文を変更しません。

新プロジェクト設定やAPI有効化が組織ポリシーで拒否される場合は停止します。OAuth承認画面で不要な編集/Drive権限が出る場合はマニフェストと貼付先を見直してください。

## 3. 確認後、一括準備・ビルド・配置（まだ生成しない）

```bash
export MG02_GOOGLE_AUDIENCE='mg02Inspectで表示された値.apps.googleusercontent.com'
export MG_SECRET_VERSION=1  # 実際のENABLEDな数値バージョンへ変更。latestは禁止
export MG_ADMIN_CONFIRMED=true
export MG_COST_CONFIRMED=true
export MG_FIREBASE_READ_CONFIRMED=true
bash material-generation/ops/test02/cloud-shell.sh setup-deploy
```

一括処理はモデルメタデータGET（生成なし）→新SA/厳密な読取ロール/GCS/IAM/Artifact Registry準備→material-generationだけをビルド→digestでTEST02へ手動配置→設定・Secret参照・未認証401検査までを行います。生成API呼出しはしません。Google Cloud認証のないCodex環境では実施せず、管理者のCloud Shellで実行します。

初期の `MG_GENERATION_APPROVED=false` はサーバー側の拒否として働きます。既存リソースは用途/保護設定/権限が一致する場合だけ再利用し、保持ロック/試行記録のリセット/削除はしません。中断後の同コマンド再実行でもTEST01に触れず、TEST02試行を初期化しません。バケットの保持・削除ライフサイクルで予約が消える設定は拒否します。

## 4. 認証確認 → 管理者の明示承認 → 1回生成

1. 新Apps Scriptのスクリプトプロパティ **`MG02_SERVER_URL`** に、verifyで表示されたTEST02 HTTPS URLだけを設定。
2. `mg02CheckConnection` を実行。authenticated/teacherVerified=true、generationEnabled=false、追記/公開falseを確認します。5タブは列ヘッダーを検査し、本文は選択6文を検査します。他タブの全行は読まないためrowCount=0はヘッダーのみの読取を表し、空シートの保証ではありません。
3. 費用と実生成1試行への承認後にのみ、同じCloud Shellで実行します。これはTEST02の生成承認を有効にするだけで、Gemini生成はまだ行いません。

```bash
MG_ONE_ATTEMPT_APPROVED=true \
  bash material-generation/ops/test02/cloud-shell.sh approve-generation
```

4. 新TEST02 Apps Scriptで **`mg02GenerateOnce` を1回だけ手動実行**。これが実際のGemini呼出し操作です。自動トリガーは作成しません。ジョブID・状態・生成数・検証エラー件数だけをログに出します。
5. 状態確認は `mg02Status`。同じ生成関数を再実行しても送信済みマーカーがあれば状態取得だけです。サーバー側も全教員・再起動・日付変更・明示retryをまたいで1試行に限定します。タイムアウトや503でも記録を消して再試行しません。

承認更新の応答が失われた場合は次で設定を確認します。再配置やマーカー削除で復旧しないでください。

```bash
MG_EXPECT_APPROVED=true bash material-generation/ops/test02/cloud-shell.sh verify
```

## 5. 保存済み結果・安全なログと品質確認

```bash
bash material-generation/ops/test02/cloud-shell.sh logs
bash material-generation/ops/test02/cloud-shell.sh export JOB-実際の32桁ID
```

503診断は既存 `material_gemini` allowlistを使用し、上流ステータス/定型状態/時間/数値Retry-Afterなどだけを記録。本文/キー/トークン/教員情報/任意エラーメッセージ/スタックは出しません。RESTは再試行せず、失敗はGCSのreport.errorsとdiagnosticへ保存します。Cloud RunのHTTP200はジョブ返却成功を示すため、生成成否はstate/reportで確認します。

exportはTEST02バケットの対象ジョブを私有一時ディレクトリへ取得し、既存review.cjsで評価票を作ります。原文/生成文を含むので公開ログやGitHubへ貼らないでください。10問・指定語/許容解答・各1文・根拠・起承転結の構造に加え、文法/和英対応/自然さ/準2級〜2級中間の難易度/ミステリーの一貫性を人手で評価します。不足や重大不備でも自動再生成せず、保存結果をレビューします。

この手順に教材追記・英単語追記・公開・mainマージ・本番更新・TEST01変更はありません。
