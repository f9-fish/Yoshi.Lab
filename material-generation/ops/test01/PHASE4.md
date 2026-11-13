# Phase 4：既存TEST01で英作文10問を1ジョブだけ生成

503発生後の確認は [INCIDENT-503.md](INCIDENT-503.md) を参照してください。既存の予約・試行記録を維持し、生成手順を再実行しません。

この文書をPhase 4の実行手順として使用します。以前のREADMEの「接続確認を再デプロイ」「Driveフォルダ作成」「追記許可」は今回は不要です。

対象は既存 `yoshi-lab-db3eb / asia-northeast1 / yoshilab-material-test01`、専用実行ID、既存TEST01シートだけです。studioapi・Functions・本番Apps Script・本番シート・mainは変更しません。GitHubトリガーも作りません。

## 現在の確認範囲

管理者報告ではGoogle IDトークン・Firebase教員権限・5タブ・英C/TEST01/Part1の6文は確認済みです。接続確認目的の再デプロイ・Firebase権限の再追加はしません。

`STUDIO_GEMINI_MODEL=gemini-3.8-flash` は環境変数の確認値です。稼働コードも明示モデルをRESTへ渡すだけで、そのモデルの利用可能性を保証していません。この作業環境にはGCP認証・Gemini Secretがなく、APIの有効性・実料金・実生成は未確認です。

`check` は対象Secretを標準入力パイプで読み、`GET /v1beta/models/gemini-3.8-flash` の正確なnameと `generateContent` 対応を確認します。教材生成はしません。404/403/429/通信失敗なら停止し、別のモデルを自動選択しません。モデルが存在しても課金・利用枠・構造化生成の実動作まで保証する検査ではありません。失敗時は管理者がGemini APIのモデル一覧・対象プロジェクトを確認してください。別IDが正式に確認された場合に限り `MG_MODEL_ID` で明示します。

## 管理者が一度確認する項目

- GCP課金、Cloud Run/Build/Artifact Registry/GCS/Secret Managerの費用。
- 対象Geminiキーのプロジェクト・API制限・利用枠、**対象モデルの現行入力/出力/思考トークン価格**。価格は <https://ai.google.dev/gemini-api/docs/pricing>、モデル仕様は <https://ai.google.dev/gemini-api/docs/models> で確認。
- 生成は1リクエスト、`maxOutputTokens=12000`、入力は6文と指示/JSONスキーマ。正確な料金はモデル・思考トークン・実使用量次第です。Cloud予算アラートは支出停止機能ではありません。費用に同意してから確認フラグを指定します。
- 実行IDに追加するのは、下記バケットの `roles/storage.objectUser` と下記Secretの `roles/secretmanager.secretAccessor` だけ。既存のFirebase読み取り権限は変更しません。プロジェクト全体のStorage/Secret権限は付与しません。
- Cloud Shell操作者にはバケット作成・対象リソースIAM編集・Secret操作・モデル照会・既存のビルド/Run更新権限が必要です。権限不足なら停止してください。スクリプトはOwner/Editor付与や組織ポリシー変更を行いません。

## 1. Cloud Shell：取得と専用Secretの準備

新しいディレクトリでまとめて実行します。既に取得済みなら、既存作業を保護した上でブランチの最新をpullしてください。

```bash
git clone --single-branch --branch feat/sheet-material-generation-phase3 https://github.com/f9-fish/Yoshi.Lab.git Yoshi.Lab-phase4
cd Yoshi.Lab-phase4
set +x
umask 077
gcloud services enable secretmanager.googleapis.com storage.googleapis.com --project=yoshi-lab-db3eb
```

専用Secret名は **`yoshilab-material-test01-gemini`** に固定しています。既にある場合は新しいバージョンを追加せず、その有効な数値バージョンを使ってください。本番Secretから秘密値を表示・コピーしません。

専用Secretがまだない場合だけ、次を実行します。管理者がこのテスト用に用意したGeminiキーを非表示プロンプトへ一度入力します。チャット・コマンド引数・履歴へ貼りません。キーを持っていなければ、この段階で管理者が発行/制限設定を行います。

```bash
set -o pipefail
gcloud secrets create yoshilab-material-test01-gemini --project=yoshi-lab-db3eb --replication-policy=automatic
python3 -c 'import getpass,sys; k=getpass.getpass("TEST01 Gemini API key (hidden): "); assert k.strip(); sys.stdout.write(k.strip())' | gcloud secrets versions add yoshilab-material-test01-gemini --project=yoshi-lab-db3eb --data-file=-
```

新規なら通常バージョン1です。秘密値を読まずにメタデータだけを確認できます。

```bash
gcloud secrets versions list yoshilab-material-test01-gemini --project=yoshi-lab-db3eb --format='table(name,state)'
export MG_SECRET_VERSION=1  # 実際のENABLEDな数値へ変更。latestは禁止
bash material-generation/ops/test01/phase4-cloud-shell.sh check
```

`check` は変更なし・生成なし。成功後に価格/費用・IAM・Secretを確認し、次へ進みます。モデル照会が失敗した場合はここで停止します。

## 2. 一括準備・手動ビルド・既存テストサービス更新

```bash
MG_ADMIN_CONFIRMED=true MG_COST_CONFIRMED=true \
  bash material-generation/ops/test01/phase4-cloud-shell.sh setup-deploy
```

これで次を順番に行います。GitHubからの自動デプロイではありません。

1. 課金・Secret有効性・モデルを再検査（生成なし）。
2. 東京の専用バケット `gs://yoshi-lab-db3eb-material-test01-jobs` を作成。非公開・Public Access Prevention=enforced・Uniform bucket-level access。既存バケットは用途ラベルと保護設定が一致した場合だけ使用。不一致なら自動修正せず停止。
3. 上記2リソースだけに専用実行IDの権限を付与。保持ロックは作らず、ジョブ/ロックを消すライフサイクルルールも作りません。標準soft deleteの保存費用は管理者が確認してください。バケット/オブジェクトを削除・リセットして再生成しないでください。
4. 既存Dockerfile/Cloud Build設定で、コミット済みmaterial-generationだけをビルドし、digest指定で既存TEST01サービスを更新。実行ID、最小0・最大1・同時実行1、120秒、512MiB。既存invoker IAMは変更しません。
5. Secretを数値バージョンで環境変数へ参照し、モデル/費用確認・1ジョブ制限を有効に設定。追記はfalse。テンプレート `generation.env.yaml` は無効のまま維持。
6. 配置設定・最新ready revision・トラフィック・Secret参照・未認証401を確認。実生成はまだ行いません。

ビルド/デプロイだけ失敗した場合、エラーを解決して同じコマンドを再実行できます。GCSの予約・attemptedフラグ・残存ロック・ジョブは削除しません。確認だけは `verify`、ビルド済みイメージの配置再試行は `deploy` です。

## 3. テストApps Scriptを一度更新して実生成

**既存のTEST01テストプロジェクトだけ**で以下を実施します。本番Apps Scriptは触りません。Script APIによる編集認証はこの作業環境にないため、この貼り付けだけは管理者操作が必要です。

- 既存 `material-generation-preflight.gs` を最新に更新。`getUi()` が使えなくても結果を返し、認証成功の `authenticated:true` / `teacherVerified:true` がログに残ります。ダイアログ失敗のエラー全文は記録しません。
- 新規ファイル `material-generation-phase4.gs` を追加。既存 `material-generation-client.gs` はそのまま使います。
- `MG_SERVER_URL` が今回verifyで表示された既存TEST01 URL、`MG_MODE=TEST`、source/test IDが既存TEST01、`MG_TEST_APPEND_ENABLED=false` であることを確認。接続確認時のマニフェストのままで実行できます（Drive、高度なSheets API、追加編集権限、トリガーは不要）。
- **`mgPhase4GenerateOnce` を1回実行**。行選択は不要、固定の英C/TEST01/Part1の6文だけ読みます。旧 `mgEnqueue` / `mgRunWorker` / `mgTick` は使用しません。旧 `MG_ENABLED` 等のプロパティを生成用へ切り替える必要もありません。
- 実行ログにジョブID・状態・生成数・検証エラー件数のみ表示。本文/キー/トークンはログへ出しません。結果取得は `mgPhase4Status`。同じ生成関数を再実行しても、送信済みなら状態取得だけです。

サーバーもGCSの単一予約と送信前のattemptedフラグで全教員・別設定・日付変更・プロセス再起動をまたいで1ジョブ/1試行に限定します。タイムアウト/検証失敗でも再生成しません。予約後に保存障害が起きると、未課金でも安全側で停止する場合があります。ロックの自動期限切れ解除はありません。成否不明は手動調査し、attempted/予約を消して再試行しないでください。

## 4. 保存済み結果を取得し、品質確認

実行ログの `JOB-...` を次へ指定します。追加のGemini呼び出しはありません。

```bash
bash material-generation/ops/test01/phase4-cloud-shell.sh export JOB-実際の32桁ID
```

私有一時ディレクトリに `job.json` と `review.json` を作ります。jobには原文・生成応答・検証結果、reviewには10問の日本語・模範/許容解答・指定表現・ヒント①②・解説・根拠・モデル実ID・トークン使用量・品質評価票が入ります。JSONはローカルで閲覧し、GitHubや共有ログへ貼りません。`export` は毎回別フォルダへ保存し既存資料を上書きしません。品質レビューをCodexへ依頼する場合は、この2ファイルを非公開の添付で渡せます。認証情報は含まれませんが教材原文を含みます。

自動検査：既存の列/本文/出典/順序/起承転結/指定語一致/複製・重複拒否に加え、英作文だけ10問、全問の許容解答・指定表現、模範解答が各1文、実モデルIDの記録を評価票で確認。文分割はIntl.Segmenterの機械的判定です。10問未満・不足・不正なら不合格としてレビューし、自動水増し・再生成しません。構造検証に失敗したJSON応答もGCSに残します。

**文法の正確性・和英対応・自然さ・英検準2級〜2級中間の難易度・全体の一貫性・重要語彙/文法の活用・オリジナル性は未評価の人手確認事項**です。各問題を訂正欄で確認し、起承転結と意外性を全体でも評価します。採用判定・教員評価・日時を記録するまで「品質確認済み」と呼びません。実生成後の結果がまだないため、このPR自体は教材品質を保証しません。

このPhaseには追記・英単語追記・公開の操作がありません。結果が良好でもシートへ追記しません。
