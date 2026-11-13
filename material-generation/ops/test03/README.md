# TEST03：LOW思考量・90秒待機での独立1試行の準備

**TEST03は実行済みでエラーとなっています。以下の構築/承認/生成手順は再実行しないでください。[今回の読み取り専用診断](INCIDENT.md) の1ブロックを使用します。**

TEST01（HTTP503）・TEST02（55秒timeout）の記録/サービス/バケット/Apps Scriptは変更しません。管理者によりTEST03の構築・実生成1試行は実施済みです。Codexは今回の診断で実Cloudを変更しません。

## 固定した次回条件

- 新サービス `yoshilab-material-test03` / 新SA `yoshilab-material-test03@yoshi-lab-db3eb.iam.gserviceaccount.com` / 新私有バケット `yoshi-lab-db3eb-material-test03-jobs`。
- 新保存prefix `material-generation-test03` / 予約 `PHASE4-TEST03` / 新しいジョブID。
- 新しいスタンドアロンTEST03 Apps Script。既存6文のSheets GETだけで、scopeはspreadsheets.readonly。
- `gemini-3.8-flash`、`MG_GEMINI_PROFILE=writing-low-latency-v1`を起動時と配置後に検証。思考量LOW、includeThoughts=false、Gemini期限90秒、Cloud Run実設定180秒。型/モデル/件数不一致は送信前に拒否。
- 出力上限12,000を維持し、10問・指定語/別解/ヒント/解説/根拠/起承転結を保った簡潔な出力を指示。
- 初期生成承認false、1ジョブ/1試行、503/timeout/MAX_TOKENSでも再生成なし、追記/公開false。
- 既存Secret `yoshilab-material-test01-gemini` の有効な数値バージョンを参照し、秘密値を表示/コピーしない。

IAMはTEST02と同じ最小構成を**新TEST03 SAだけ**に付与：対象TEST03バケットObject User、対象Secret Accessor、新カスタムロール `yoshiLabMaterialTest03Reader` の `firebaseauth.users.get` と `firebasedatabase.instances.get` だけ。RTDB IAMの読み取りはteacherUidsパス限定ではありません。管理者はその読取範囲・上位継承IAMも確認してください。過剰な既存ロール、非保護/保持・自動削除設定のバケットは拒否し、Rules変更や権限の自動拡大はしません。

## 管理者が承認前に確認すること

LOWで応答が速くなることや教材品質は未実証です。モデルの思考にかかる時間は減る可能性がありますが、90秒での成功は保証できません。クライアントで中断しても上流処理・課金がなかったとは保証しません。

<https://aistudio.google.com/docs/pricing> で対象モデルの現行料金/利用枠、Cloud Run/Build/コンテナ/GCS/Secret/ログ費用を確認します。出力上限を維持しているため、料金上限が自動的に小さくなったとは扱いません。追加するのはTEST03の新しい1試行だけです。自動トリガーや自動再試行はありません。

## 1. コード取得（まだ生成しない）

新Cloud Shellセッションでも動くよう、新しい作業先へ取得します。既存のTEST01/02ディレクトリは変更しません。

```bash
test03_dir=$(mktemp -d "$HOME/yoshilab-test03-XXXXXX")
git clone --single-branch --branch feat/sheet-material-generation-phase3 https://github.com/f9-fish/Yoshi.Lab.git "$test03_dir/repo"
cd "$test03_dir/repo"
gcloud services enable sheets.googleapis.com --project=yoshi-lab-db3eb
gcloud projects describe yoshi-lab-db3eb --format='value(projectNumber)'
```

最後の数字はApps Scriptに指定するGCPプロジェクト番号です。

## 2. 新しいApps Scriptを一度準備

1. <https://script.google.com/home> の「新しいプロジェクト」で **Yoshi.Lab TEST03** を作成。既存TEST01/02は開かない。
2. `apps-script/material-generation-test03.gs` の全文を新プロジェクトのコード.gsへ貼る。他のコードは不要。
3. 設定の「appsscript.jsonを表示」にチェックし、`apps-script/material-generation-test03-appsscript.example.json` の全文をappsscript.jsonへ貼る。
4. この新規プロジェクトだけのGCPプロジェクトを、上で表示された数字のプロジェクト番号へ関連付ける。既存Apps Scriptの設定は変えない。
5. 保存して関数選択欄で **mg03Inspect** を選び「実行」。本人の読み取り専用OAuth承認後、6文・ヘッダー・audienceだけをログで確認。Gemini呼出しなし。

表示されたaudienceを次の環境変数へ設定します。既存TEST02と同じになる場合もありますが、実際の表示値を使い、例の文字列をそのまま実行しないでください。

## 3. 費用・IAM確認後の一括構築（生成は無効）

同じCloud Shellの、上でcdしたrepo内で実行します。数値Secretバージョンは実際に有効なものを指定してください。

```bash
export MG03_GOOGLE_AUDIENCE='mg03Inspectで実際に表示されたaudience'
export MG_SECRET_VERSION=1
export MG_ADMIN_CONFIRMED=true
export MG_COST_CONFIRMED=true
export MG_FIREBASE_READ_CONFIRMED=true
bash material-generation/ops/test03/cloud-shell.sh setup-deploy
```

モデルのメタデータGET（生成なし）、新SA/厳密な読み取りIAM/私有GCS/専用Artifact Registry、既存Docker/Build定義での手動ビルド、TEST03だけの配置、profile・Cloud Run180秒・生成禁止・未認証401まで検証します。初回の generationApproved はfalseです。TEST01/02のCloud Runやバケット・記録にはアクセスしません（共有Secretへの新SAの対象Accessor追加だけは行う）。

生成は禁止したまま新サービスだけプラットフォーム上は到達可能にします。アプリがGoogle署名/audience/教員権限を検証します。組織ポリシーが拒否する場合は迂回しません。中断後の再実行でも予約/attemptedを削除・初期化しません。

## 4. 接続確認と新しい1試行の承認

新TEST03 Apps Scriptの設定→スクリプトプロパティへ、`MG03_SERVER_URL` と、上のverifyで表示されたTEST03 URLを登録。

**mg03CheckConnection** を実行し、authenticated/teacherVerified=true、generationEnabled=false、追記/公開falseを確認。Sheetsの他4タブはヘッダーだけを読むためrowCount=0は空シートの保証ではありません。

費用・新しい1試行への管理者承認後だけ、Cloud Shellで次を実行します。

```bash
MG_ONE_ATTEMPT_APPROVED=true bash material-generation/ops/test03/cloud-shell.sh approve-generation
```

これは承認設定だけで、まだ生成しません。generationApproved=trueを確認後、新TEST03 Apps Scriptで **mg03GenerateOnceを手動で1回だけ実行**します。この操作が実際のGeminiリクエストです。失敗時も再生成しません。状態取得はmg03Statusです。

## 5. 診断・品質確認

```bash
bash material-generation/ops/test03/cloud-shell.sh logs
bash material-generation/ops/test03/cloud-shell.sh export JOB-実際の32桁ID
```

新診断はprofile/thinkingLevel/HTTP/終了理由/ヘッダー受信時間/総時間/トークン数を許可フィールドだけで表示。キー・トークン・教員情報・本文・思考本文・エラー全文は出しません。Cloud Run200はジョブ返却成功であり、生成成功はstate/reportで判断します。MAX_TOKENS等はエラーで保存し、再試行なし。

export先のjob.json/review.jsonは原文/生成文を含む私有ローカル資料です。公開ログ・GitHubへ貼らず、10問の文法・和英対応・指定語・ヒント/解説・難易度・ミステリーの自然さを確認します。構造テスト成功だけで品質合格とは扱いません。教材追記・公開は行いません。
