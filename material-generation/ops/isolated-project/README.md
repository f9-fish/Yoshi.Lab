# 専用プロジェクトによる独立検証の準備（2026-11-13）

対象PR #77。既存のTEST01〜03と本番は変更しない。**今回は準備とオフラインテストだけ。新プロジェクト/キー/Secret作成、課金設定、IAM付与、Geminiリクエストは実行していない。**

## 最小構成と承認の境界

新しい専用project `yoshilab-material-ai-<小文字英数字4〜9文字>` に以下だけを置く。既存project yoshi-lab-db3ebや既存Secretは使用しない。

| 対象 | 構成 |
|---|---|
| Gemini | 明示モデルgemini-3.8-flash。変更/代替モデル/自動fallbackなし |
| 認証 | Google AI Studioの現行auth key。新project内の専用SAにバインドし、Generative Language APIだけ許可。クライアントのx-goog-api-keyヘッダーは既存コードを再利用 |
| Secret | 新projectのmaterial-ai-gemini、新キーを非表示で直接登録。latestでなく数値versionを固定 |
| GCS | `<projectId>-validation`。非公開、Public Access Prevention=enforced、Uniform bucket-level access=true。旧バケットを流用しない |
| 実行 | Cloud Shell、Node24、既存package-lockの依存。Cloud Run/Build/Artifact Registry/Apps Script/Firebaseの新規構築は不要 |
| 本文 | 生成段階だけ、既存TEST03保存ジョブの6文snapshotを読み取り専用で再利用。シート/API/Apps Scriptへの接続なし |

一括構築は新project内だけでService Usage / Cloud Resource Manager / IAM / API Keys / Secret Manager / Cloud Storage / Generative Languageの7 APIを有効化する。Cloud Run/Build/Firebase APIの有効化は行わない。

新規API有効化・課金・SA/キー作成・Secret登録・IAM付与には管理者の別途承認が必要。runnerに作成/有効化/IAM編集の機能はなく、構築は別の承認制provision.pyに分離する。管理者が設定を終え、費用と各リクエストを明示承認した時だけ将来の実行コマンドを使う。

### 現行認証と最小権限

[Google公式APIキー説明](https://ai.google.dev/gemini-api/docs/api-key)は、2026-05-28以降AI Studioの新規キーをサービスアカウントに紐付くauth keyとし、Generative Language APIへの制限を説明している。Cloud Run実行SAとAPIキーに紐付くSAは別概念。今回新Runは作らず、旧実行SAの権限を広げない。

将来の作成は新projectを明示し、provision.pyからGoogle公式CLIの`gcloud services api-keys create --service-account=... --api-target=service=generativelanguage.googleapis.com`で行う。AI Studioでの手動キー発行/コピーは不要。公式に挙げられる作成権限は resourcemanager.projects.get / apikeys.keys.create / serviceusage.services.enable / iam.serviceAccounts.create / iam.serviceAccountApiKeyBindings.create。既存projectへのOwner/Editor付与で解決しない。課金接続・新project/GCS/Secret作成権限は管理者のプロビジョニング権限として分離する。

実行操作者に必要なのは新project/key metadata閲覧、新Secretのversion metadata閲覧と対象SecretだけのsecretAccessor、新バケットだけのobjectCreator/objectViewerとstorage.buckets.get。Secret containerへのroles/secretmanager.viewerはmetadata閲覧に利用可能だが、project全体のSecretアクセス権は不要。バケットの実metadata取得権限は専用カスタムrole等でstorage.buckets.getのみを与える設計とする。旧TEST03 snapshotには既に管理者が持つread権限だけを使い、新たな旧project IAM付与は行わない。権限不足は停止する。auth keyに紐付くSAへの権限は公式の作成フローを確認し、推測でOwner/Editor等を付与しない。

## 2段階の検証

1. **verify-model**：既存phase4/verify-model.cjsで指定モデル1件のGETだけを送る。本文/生成promptは送らず、モデル名の完全一致、generateContent対応、出力上限12,000以上を検査する。これはモデルmetadata取得の確認であり、生成容量・品質・料金tier・503解消の保証ではない。
2. **generate-ten**：成功receiptと同一config、24時間以内、別の管理者承認がそろった場合のみ既存engine.cjs/gemini.cjsで英作文10問を1回送る。元の6文、LOW、90秒、maxOutputTokens=12000、既存schema/検証を維持。品質確認は生成後の教員レビューが必要で、追記/公開機能はない。

verify-model自体もGeminiへの実リクエストなので今回は実行禁止。GETも含め、各段階の送信前に新GCSのisolated-v1/<stage>-claim.jsonをifGenerationMatch=0で作成する。**各段階1試行のみ**。生成は1ジョブ・1POST、GET照会は別の1試行。並行実行・503・timeout・Secret読取失敗・中断・receipt保存失敗でもclaimを残し、再送しない。SDKのGCS自動再試行も無効。固定名でありconfig変更による再試行も拒否する。失敗後にバケット/claimを消す、名前を変えて繰り返す操作は禁止。次の試行は別途レビュー/承認が必要。

HTTP status/elapsedMs/retryAttemptedと既存の安全な生成診断を保存。エラー本文/headers/キー/トークン/教員情報/教材本文を標準出力へ出さず、例外stackも出さない。失敗結果のstdoutは固定コードと数値のみ。生の生成応答を含むreportは新privateバケットのgeneration-private.jsonだけへ保存する。秘密値はgcloud子プロセスの捕捉stdoutからメモリー内で受け取り、引数/環境変数/ファイルに書かない。gcloudのHTTPログは無効化する。実行時にshellのset -xや外部デバッグ/HTTPキャプチャを有効にしない。

## 秘密値なしの対応記録

通常はprovision.pyがCloud Shellのprivate作業領域へconfig.jsonを自動生成する。config.example.jsonは形式の参照用で、手動編集は不要。APIキー値は絶対に記入しない。

- projectId / projectNumber：新projectの非秘密ID。
- keyResource：API Keys metadataの完全リソース名。**APIキー文字列ではない**。
- secretId / secretVersion：新Secret名と実際の有効な数値version。
- bucket / modelId：新bucket名と明示モデル。
- provenanceConfirmed：新規キーを対象Secretの当該versionへ直接登録した記録を確認した時だけtrue。

対応記録は送信前claimのprovenanceに保存し、config全体のhashを照会結果と生成結果に保持する。runnerはproject number、key resource所属、auth keyのSA所属、API制限、Secret version状態、バケット所属/PAP/UBLAを検証する。metadataだけではSecret payloadとkey resourceの同一性は証明できないため、provenanceConfirmedは**作成時の管理者記録**に依存する。構築スクリプトがその実行中に新規作成に成功したキーだけget-key-stringでメモリー内に取得し、新規Secret versionへ直接渡す。既存キーのgetKeyString、lookupKey、既存Secret読取による照合は行わない。空のmethod制限（API内全method許可）を要求し、GetModel/GenerateContentが阻害される不明なmethodパターンは自動変更せず停止する。

## 一括構築スクリプト

`cloud-shell.sh setup <projectId>` → `provision.py`。Python3標準ライブラリとCloud Shellのgcloudを利用し、構築だけならnpm不要。プロジェクト作成/課金接続はスクリプトに含めない。Google公式の[auth key作成フラグ](https://docs.cloud.google.com/sdk/gcloud/reference/services/api-keys/create)を使用し、組織ポリシーの緩和・standard keyへのfallbackをしない。

### 誤変更を防ぐ条件

- projectIdは`yoshilab-material-ai-<小文字英数字4〜9文字>`だけを許可し、旧project numberも拒否する。作成後7日以内・ACTIVE・課金設定済みであることを読み取って検査する。project番号は自動取得。
- `MG_SETUP_APPROVED`がそのprojectIdと一致し、費用確認もtrueの時だけ構築する。既定projectを変更せず、すべてのgcloud操作でprojectを明示。
- 新projectのAPI有効化後、キー・Secret・バケット・custom role・ユーザー作成SAがないことを一覧で検査する。Google管理のサービスエージェントのみ許可。権限不足/一覧失敗を「存在しない」と扱わない。APIが無効だと一覧取得できないため、**既存リソース検査より前に承認済み新projectのAPI有効化は行われる**。
- GCSのcreate成功をCloud Shell間の競合防止点とし、既存バケットへIAM/設定を適用しない。キー/SA/Secret/custom roleもcreateのみ。既存キーの更新、Secretへの追加version、リソース削除/rollbackなし。
- 固定名資源またはローカルsetup-journalが既にある場合は再実行を拒否。途中失敗時も同じコマンドを繰り返さず、記録と資源を保持して原因を確認する。API/鍵の作成等が途中まで完了している可能性がある。別名での自動やり直しや自動待機/再試行はしない。

### 作成物とIAM

- SA `material-ai-auth`、キーID `material-ai-gemini`。新キーだけにGenerative Language API制限を付け、指定SAへbindする。SAにproject/Secret/GCSのroleを付与しない。Gemini側の追加権限が必要な場合も自動で広げず、後の照会で停止して調査する。
- Secret `material-ai-gemini`、version1。新キー値は捕捉した子プロセスstdoutから次の子プロセスstdinへ渡し、引数/環境変数/ファイル/公開ログへ出さない。
- 新private GCS、東京region、PAP/UBLAを作成時に有効化。setup-v1/provenance.jsonへ非秘密configをgeneration=0で保存する。
- 実行主体は現在のCloud Shellのactive accountを自動取得。新projectのcustom role `materialAiMetadata`（apikeys.keys.get / resourcemanager.projects.get）をその操作者へ付与。
- custom role `materialAiBucket`（storage.buckets.get / storage.objects.create / storage.objects.get）を**新バケットだけ**に付与。削除/上書き用権限なし。新SecretだけにsecretAccessorとviewerを付与。auth keyのSAと操作者は別主体。
- 新projectを作った管理者が既に持つOwner等の権限は削除しない。追加bindingは狭いが、操作者の既存/継承権限まで最小化した証明にはならない。旧projectのIAMを追加/変更しない。
- 操作者には新projectでAPI有効化、SA/key/Secret/bucket/custom role作成、対象IAM変更、API key取得等の構築権限が必要。権限不足/組織ポリシー拒否時は停止する。スクリプトは自分自身へのOwner/Editor付与や組織ポリシー変更を行わない。

構築後にproject/課金/API有効性、SA、key所属/bind/API制限、Secretと唯一の有効version、GCS所属/東京/PAP/UBLA、roleのpermission完全一致、必要なIAM binding、公開principalの不在をmetadataで自動確認する。Geminiへの通信は行わない。`check`は同じ確認を読み取り専用で実行し、キー文字列やSecret payloadにはアクセスしない。**これは設定検証であり、Gemini疎通・有効な利用枠・課金tier・組織からの継承権限の検証ではない。**

ローカル記録は`~/.config/yoshilab-material/<projectId>/`（directory0700/files0600）。config.jsonとsetup-journal.jsonを自動生成し、手動JSON編集・project番号の転記・キー値コピーは不要。configは構築後検査に成功した時だけ出力。途中失敗ではsetup-journalの固定step名を確認し、秘密値を含まないそのstepとエラーcodeだけを共有する。キーや生のgcloudログは貼らない。

## 管理者の最短手順

**申請承認待ちの今は実行不要。** 調査/準備内容だけを表示するなら、既存checkout内で以下。Cloud認証・Cloud変更・Gemini送信はない。

```bash
git pull --ff-only && bash material-generation/ops/isolated-project/cloud-shell.sh plan
```

### 1. プロジェクト作成と課金設定（管理者が別途実施）

作成上限の申請が承認されたら、上記命名規則の新projectを作り、課金設定を完了する。スクリプトはこの2操作を行わない。既存projectを流用しない。以下の入力プロンプトでは**新project IDだけ**を入力する（秘密値は入力しない）。

### 2. 一括構築（新project/IAM/料金を承認後だけ）

既存PRブランチcheckout内で、更新後に以下を実行する。Node24は後の照会/生成に必要。

```bash
git pull --ff-only
read -r -p '新しい専用プロジェクトID: ' MG_AI_PROJECT
MG_SETUP_APPROVED="$MG_AI_PROJECT" MG_COST_CONFIRMED=true bash material-generation/ops/isolated-project/cloud-shell.sh setup "$MG_AI_PROJECT"
```

成功時は自動検査済み。追加確認が必要な場合だけ、読み取り専用で以下を実行する。

```bash
bash material-generation/ops/isolated-project/cloud-shell.sh check "$MG_AI_PROJECT"
```

途中失敗した場合、setupを繰り返したり、資源/記録を削除したりしない。APIが有効になった後の反映遅延等でも自動再試行しない。`setup-journal.json`のstepと安全なエラーcodeを基に別途確認する。

### 3. モデルGETの1試行（別途承認後だけ）

```bash
MG_ISOLATED_APPROVED=verify-model MG_COST_CONFIRMED=true bash material-generation/ops/isolated-project/cloud-shell.sh verify-model "$MG_AI_PROJECT"
```

必要なNode依存は初回に既存lockfileから自動導入（npm lifecycle script無効）。キー入力やJSON編集は不要。成功後も自動生成しない。

### 4. 英作文10問の1試行（成功結果・費用確認後、さらに別途承認）

```bash
MG_ISOLATED_APPROVED=generate-ten MG_COST_CONFIRMED=true bash material-generation/ops/isolated-project/cloud-shell.sh generate-ten "$MG_AI_PROJECT"
```

既存TEST03の固定snapshotはprivateなメモリーにだけ読むため、シートや本文の手動コピー不要。旧GCSの権限がない場合は停止し、既存環境の権限を広げない。別途承認済みのprivateなmaster配列JSONがある場合のみrunner.cjsの第4引数で指定可能（6文/科目/単元を検査）。生成後の品質確認にはprivate reportをローカルで参照し、本文を公開ログ/PR/チャットへ出さない。自然さ/和英対応/難易度等は教員確認が必要。失敗したら止め、照会/生成コマンドを繰り返さない。

## 費用・制限・影響

最初の照会はgenerateContentを使わず出力tokensを生成しない。ただしCloud操作/Secret/GCS等の料金と将来のGemini料金/利用枠は実行時に確認する。10問の12,000tokensは出力上限で実使用量や費用上限ではなく、入力/思考/Cloud費用も確認する。[公式料金](https://ai.google.dev/gemini-api/docs/pricing)、[利用制限](https://ai.google.dev/gemini-api/docs/rate-limits)。通常の予算通知は支出停止機能ではない。新projectでも同じ請求先の総額や利用条件は共有され得る。専用projectで追跡/設定は明確になるが、サービス側の503解消は保証しない。

本番studioapi/Functions/既存Apps Script/シート/mainを変更しない。TEST01〜03は固定の保存済みsource snapshotを読むだけで予約/attempted/job/bucket設定を変更しない。既存Secret/APIキーにアクセスせず、GCPの既定projectも変更しない。CIは既存の検証workflowだけを使い、自動デプロイを追加しない。

## オフライン検証結果

前回307fd248の検証：Node24で教材生成関連189件成功、失敗0、スキップ0（新規12件）。studio-functions23件成功、失敗0、スキップ0。既存アプリ414件中408件成功、既存Q&A関連6件失敗、スキップ0。実Cloud/認証キー/Gemini成功は未確認。秘密値なしのモックでモデルGET・503の非再試行・失敗後のclaim保持・成功receipt必須・10問生成と既存validation・privateな結果保存・旧snapshotの固定読取先を確認。

### 今回の一括構築準備の検証

Pythonの新規18件成功、失敗0、スキップ0。既存Node教材生成189件成功、studio-functions23件成功。既存アプリ414件中408成功・6失敗・スキップ0で、前回と同じQ&A関連6件。bash構文・Python構文・diffチェック成功。構築の成功/拒否、既存資源検出、権限/一覧失敗、競合バケット、Secret登録失敗、作成失敗後の非再試行、キー非出力、metadataだけのcheck、承認なしCLIの停止をモックで確認した。新規Cloudリソース作成・API有効化・課金設定・IAM付与・キー/Secret値取得・Gemini送信はこの開発作業では未実施。実CloudでのAPI仕様/IAM伝播/組織ポリシー/課金tier/利用枠は管理者承認後に確認する。
