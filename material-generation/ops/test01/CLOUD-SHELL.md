# TEST01：Cloud Shellで手動ビルド・デプロイ

確定済みの `yoshi-lab-db3eb` / `asia-northeast1` / `yoshilab-material-test01` だけを対象にします。スプレッドシートは作成済みのIDを使い、再作成しません。GitHubトリガー、Firebaseデプロイ、Apps Script編集、Sheets追記は行いません。

## 1. Cloud Shellを開き、コードを取得

Google Cloud Console右上の「Cloud Shellをアクティブにする」を押し、次をまとめて実行します。初回はGoogle Cloudによる承認画面が出ます。認証情報をチャットへ貼る必要はありません。既に同名のフォルダがある場合は、新しい作業ディレクトリで実行してください。

```bash
git clone --single-branch --branch feat/sheet-material-generation-phase3 https://github.com/f9-fish/Yoshi.Lab.git Yoshi.Lab-material-test01
cd Yoshi.Lab-material-test01
bash material-generation/ops/test01/manual-cloud-run.sh audit
```

## 2. 権限を確認

`audit` は設定を変更せず、実行者・専用サービスアカウント・現在のプロジェクト権限・Cloud Buildの既定実行者・有効APIを表示します。表示できない場合は権限管理者へ依頼してください。

| 対象 | 必要な権限・注意 |
|---|---|
| Cloud Shellの実行者 | Cloud Buildジョブ作成、Artifact Registryリポジトリ作成、必要API有効化、対象Cloud Runの作成・更新・IAM変更、専用実行アカウントへの `iam.serviceAccounts.actAs`。Ownerを一括付与しない |
| Cloud Buildの実行アカウント | 対象Artifact Registryへの書き込み、Cloud Loggingへの書き込み、ビルドソース格納先の読み取り。既定アカウントはプロジェクトにより異なるのでauditで確認する |
| 専用Cloud Run実行アカウント | Firebase Authのユーザー参照（`firebaseauth.users.get`。例：Firebase Authentication Viewer）、RTDBの読み取り（例：Firebase Realtime Database Viewer）。実際に使えることはApps Script接続確認で検証する |

実行アカウントへの権限付与はスクリプトでは自動化していません。特にRTDBのIAM閲覧権限は `teacherUids` だけへの制限を保証しません。コードはそのパスだけを読みますが、権限範囲を管理者が確認してください。既存Rulesは変更しません。生成キー・GitHubトークン・GCS書き込み権限は接続確認には不要です。

## 3. 手動ビルド → 手動デプロイ → 検証

権限確認後、次をまとめて実行します（どこかで失敗したら後続は実行しません）。ビルドとデプロイは別コマンドであり、GitHub連携や自動トリガーは作りません。

```bash
set -e
bash material-generation/ops/test01/manual-cloud-run.sh prepare
bash material-generation/ops/test01/manual-cloud-run.sh build
bash material-generation/ops/test01/manual-cloud-run.sh deploy
bash material-generation/ops/test01/manual-cloud-run.sh verify
```

- `prepare`：3 APIの有効化と、テスト専用の私有Artifact Registryの準備。
- `build`：コミット済み `material-generation/` だけをアップロードしDockerイメージを作成。タグはコミットSHA。秘密値は送りません。
- `deploy`：ビルド済みイメージのdigestを固定し、指定のテストサービスだけを更新。生成false、追記false、接続確認true、Secretなし。最小0・最大1・同時実行1・512MiB・120秒。
- `verify`：設定・実行アカウント・稼働リビジョンを確認し、空の未認証POSTが401で拒否されることを検証。認証済みSheets接続成功を意味しません。

Cloud Runのプラットフォーム認証はこの新規テストサービスだけ未認証呼び出し可にします。Apps ScriptのOAuth audienceは通常のCloud Run URLと異なるためです。アプリはGoogle署名・audience・期限・確認済みGoogleアカウント・既存Firebase教員権限を検証します。URL自体は第三者も到達可能です。組織ポリシーで公開エンドポイントが禁止されている場合、拒否を迂回せず停止してください。既存studioapiのIAMは変更しません。

費用はCloud Build、Artifact Registry、Cloud Run、ログで発生し得ます。最小0でも無料を保証しません。Geminiは呼びません。予算アラートは支出停止ではありません。

## 4. Apps Script側（新規テストプロジェクトのみ）

`verify` が出した実URLを、新規テストApps ScriptのScript Propertiesへ設定します。

```text
MG_SERVER_URL = （verifyが表示したHTTPS URL）
MG_PREFLIGHT_ENABLED = true
MG_ENABLED = false
MG_TEST_APPEND_ENABLED = false
MG_AUTH_VERIFIED = false
MG_JOB_STORAGE_VERIFIED = false
```

確認済みaudience `484749540864-95miu3q2sndsm80oi4cron53hm0v16gc.apps.googleusercontent.com` はサーバー設定に反映済みです。別Apps Scriptへコピーした場合はaudienceが変わる可能性があるため、そのまま流用しないでください。

`mgCheckTest01Connection` を実行し、`mode=PREFLIGHT`、`authenticated=true`、`teacherVerified=true`、5タブ列一致、生成・追記・公開falseを確認してください。生徒・未登録教員では失敗することが期待動作です。問題本文はサーバーへ送りません。必要なら[詳しい初期設定](README.md)を参照してください。

403で教員照合失敗、503で教員登録読み取り失敗の場合は、既存の登録状態と実行アカウントの読み取り権限を管理者が確認してください。安易にRulesや権限を緩和しないでください。

この段階で停止します。実Gemini生成、テストシート追記は別段階です。

## 今回の確認結果（2026-11-12 日本時間）

- ローカルDockerイメージ `yoshilab-material-test01:preflight` を作成。
- ネットワーク遮断コンテナ内で起動成功。認証なしの5ルートは401、`/publish` は404。
- 実行ユーザーnodeのファイル読み取りが可能になるようCOPYの所有者を修正。
- Phase 2/3自動テスト93件成功、失敗0・スキップ0。シェル構文・差分チェック成功。
- この環境にはgcloud、Google Cloud認証・ID連携がなく、Google Cloud APIも現在の通信許可先に含まれません。Google Cloudビルド・デプロイ・実IAM照合は未実施。上記Cloud Shell手順で管理者が実行してください。
- 本番studioapi、Sheets、Apps Script、main、Pages、GitHubトリガーは変更なし。

## BuildKitエラー修正後の再実行

Cloud Shellの `export DOCKER_BUILDKIT=1` はCloud Buildには伝わりません。`cloudbuild.yaml` のDockerステップ自身に `env: ['DOCKER_BUILDKIT=1']` を設定しました。Dockerfileのsecret mountは環境内のプロキシCAをローカルビルド時だけ渡すためのもので、Cloud Buildでは指定不要です。

既に取得済みの作業フォルダ内で実行してください。ローカル変更がある場合はpullが停止するため、変更を削除せず確認してください。

```bash
set -e
git switch feat/sheet-material-generation-phase3
git pull --ff-only origin feat/sheet-material-generation-phase3
bash material-generation/ops/test01/manual-cloud-run.sh build
bash material-generation/ops/test01/manual-cloud-run.sh deploy
bash material-generation/ops/test01/manual-cloud-run.sh verify
```

生成・追記無効の設定は変更していません。

修正の検証：Google公式 `gcr.io/cloud-builders/docker` コンテナ内で `DOCKER_BUILDKIT=1` を設定し、このDockerfileのビルドに成功しました。ローカル環境のプロキシCAは検証用コンテナとsecret mountへ一時的に渡しただけで、製品イメージへ保存していません。関連自動テスト93件成功、失敗0・スキップ0。実際のGoogle Cloudビルドは、この環境にGoogle Cloud認証がないため未実施です。
