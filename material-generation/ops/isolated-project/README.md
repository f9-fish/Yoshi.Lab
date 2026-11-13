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

将来有効化を確認するサービスはgenerativelanguage.googleapis.com、apikeys.googleapis.com、secretmanager.googleapis.com、storage.googleapis.com。新projectの管理/SA作成にはCloud Resource Manager / IAM等の管理APIも必要になり得るため、必要性を確認し、新project内に限定する。

新規API有効化・課金・SA/キー作成・Secret登録・IAM付与には管理者の別途承認が必要。runnerに作成/有効化/IAM編集の機能はない。管理者が設定を終え、費用と各リクエストを明示承認した時だけ将来の実行コマンドを使う。

### 現行認証と最小権限

[Google公式APIキー説明](https://ai.google.dev/gemini-api/docs/api-key)は、2026-05-28以降AI Studioの新規キーをサービスアカウントに紐付くauth keyとし、Generative Language APIへの制限を説明している。Cloud Run実行SAとAPIキーに紐付くSAは別概念。今回新Runは作らず、旧実行SAの権限を広げない。

将来の作成は新projectを明示してAI Studioへimportし、そのproject内で行う。公式に挙げられる作成権限は resourcemanager.projects.get / apikeys.keys.create / serviceusage.services.enable / iam.serviceAccounts.create / iam.serviceAccountApiKeyBindings.create。既存projectへのOwner/Editor付与で解決しない。課金接続・新project/GCS/Secret作成権限は管理者のプロビジョニング権限として分離する。

実行操作者に必要なのは新project/key metadata閲覧、新Secretのversion metadata閲覧と対象SecretだけのsecretAccessor、新バケットだけのobjectCreator/objectViewerとstorage.buckets.get。Secret containerへのroles/secretmanager.viewerはmetadata閲覧に利用可能だが、project全体のSecretアクセス権は不要。バケットの実metadata取得権限は専用カスタムrole等でstorage.buckets.getのみを与える設計とする。旧TEST03 snapshotには既に管理者が持つread権限だけを使い、新たな旧project IAM付与は行わない。権限不足は停止する。auth keyに紐付くSAへの権限は公式の作成フローを確認し、推測でOwner/Editor等を付与しない。

## 2段階の検証

1. **verify-model**：既存phase4/verify-model.cjsで指定モデル1件のGETだけを送る。本文/生成promptは送らず、モデル名の完全一致、generateContent対応、出力上限12,000以上を検査する。これはモデルmetadata取得の確認であり、生成容量・品質・料金tier・503解消の保証ではない。
2. **generate-ten**：成功receiptと同一config、24時間以内、別の管理者承認がそろった場合のみ既存engine.cjs/gemini.cjsで英作文10問を1回送る。元の6文、LOW、90秒、maxOutputTokens=12000、既存schema/検証を維持。品質確認は生成後の教員レビューが必要で、追記/公開機能はない。

verify-model自体もGeminiへの実リクエストなので今回は実行禁止。GETも含め、各段階の送信前に新GCSのisolated-v1/<stage>-claim.jsonをifGenerationMatch=0で作成する。**各段階1試行のみ**。生成は1ジョブ・1POST、GET照会は別の1試行。並行実行・503・timeout・Secret読取失敗・中断・receipt保存失敗でもclaimを残し、再送しない。SDKのGCS自動再試行も無効。固定名でありconfig変更による再試行も拒否する。失敗後にバケット/claimを消す、名前を変えて繰り返す操作は禁止。次の試行は別途レビュー/承認が必要。

HTTP status/elapsedMs/retryAttemptedと既存の安全な生成診断を保存。エラー本文/headers/キー/トークン/教員情報/教材本文を標準出力へ出さず、例外stackも出さない。失敗結果のstdoutは固定コードと数値のみ。生の生成応答を含むreportは新privateバケットのgeneration-private.jsonだけへ保存する。秘密値はgcloud子プロセスの捕捉stdoutからメモリー内で受け取り、引数/環境変数/ファイルに書かない。gcloudのHTTPログは無効化する。実行時にshellのset -xや外部デバッグ/HTTPキャプチャを有効にしない。

## 秘密値なしの対応記録

config.example.jsonを将来Cloud Shellのprivate作業領域にコピーし、実値を記入する。APIキー値は絶対に記入しない。

- projectId / projectNumber：新projectの非秘密ID。
- keyResource：API Keys metadataの完全リソース名。**APIキー文字列ではない**。
- secretId / secretVersion：新Secret名と実際の有効な数値version。
- bucket / modelId：新bucket名と明示モデル。
- provenanceConfirmed：新規キーを対象Secretの当該versionへ直接登録した記録を確認した時だけtrue。

対応記録は送信前claimのprovenanceに保存し、config全体のhashを照会結果と生成結果に保持する。runnerはproject number、key resource所属、auth keyのSA所属、API制限、Secret version状態、バケット所属/PAP/UBLAを検証する。metadataだけではSecret payloadとkey resourceの同一性は証明できないため、provenanceConfirmedは**作成時の管理者記録**に依存する。getKeyString/lookupKey/既存Secret読取による照合は行わない。空のmethod制限（API内全method許可）を要求し、GetModel/GenerateContentが阻害される不明なmethodパターンは自動変更せず停止する。

## 管理者の最短手順

### 今できる操作（Cloud変更・Gemini送信なし）

既存のPRブランチcheckout内で、以下1行だけ。planは認証・依存インストールすら不要。

```bash
git pull --ff-only && node material-generation/ops/isolated-project/runner.cjs plan
```

### 将来の承認後だけ行う準備

1. 上記新projectの作成/課金・必要API有効化・auth key作成・新Secretへの非表示登録・privateバケット/IAM設定を管理者が承認して実施。新projectの実ID/キーresource/Secret versionを同時に記録。**今回は行わない**。
2. `config.example.json`を`/tmp/material-ai-config.json`へコピーして非秘密値だけ記入、権限0600。provenanceConfirmedを確認する。既存キーをコピーしない。
3. Node24を確認し、`npm ci --prefix material-generation --ignore-scripts --no-audit --no-fund`。依存取得はCloudリソースを作らない。
4. モデルGETの1試行を明示承認した場合だけ、下記の最初のコマンドを実行。成功した後も自動生成しない。

```bash
MG_ISOLATED_APPROVED=verify-model MG_COST_CONFIRMED=true node material-generation/ops/isolated-project/runner.cjs verify-model /tmp/material-ai-config.json
```

成功結果と料金/利用枠を確認し、**10問の有料生成を別途承認した場合だけ**：

```bash
MG_ISOLATED_APPROVED=generate-ten MG_COST_CONFIRMED=true node material-generation/ops/isolated-project/runner.cjs generate-ten /tmp/material-ai-config.json
```

既存TEST03の固定snapshotはprivateなメモリーにだけ読むため、シートや本文の手動コピー不要。旧GCSの権限がない場合は停止し、既存環境の権限を広げない。別途承認済みのprivateなmaster配列JSONがある場合のみ第4引数で指定可能（固定の6文/科目/単元を検査）。生成後の品質確認にはprivate reportをローカルで参照し、本文を公開ログ/PR/チャットへ出さない。10件でも自然さ/和英対応/難易度等は教員が確認する。失敗時の出力を確認したら止め、コマンドを繰り返さない。

## 費用・制限・影響

最初の照会はgenerateContentを使わず出力tokensを生成しない。ただしCloud操作/Secret/GCS等の料金と将来のGemini料金/利用枠は実行時に確認する。10問の12,000tokensは出力上限で実使用量や費用上限ではなく、入力/思考/Cloud費用も確認する。[公式料金](https://ai.google.dev/gemini-api/docs/pricing)、[利用制限](https://ai.google.dev/gemini-api/docs/rate-limits)。通常の予算通知は支出停止機能ではない。新projectでも同じ請求先の総額や利用条件は共有され得る。専用projectで追跡/設定は明確になるが、サービス側の503解消は保証しない。

本番studioapi/Functions/既存Apps Script/シート/mainを変更しない。TEST01〜03は固定の保存済みsource snapshotを読むだけで予約/attempted/job/bucket設定を変更しない。既存Secret/APIキーにアクセスせず、GCPの既定projectも変更しない。CIは既存の検証workflowだけを使い、自動デプロイを追加しない。

## オフライン検証結果

Node24：教材生成関連189件成功、失敗0、スキップ0（新規12件）。studio-functions23件成功、失敗0、スキップ0。既存アプリ414件中408件成功、既存Q&A関連6件失敗、スキップ0。実Cloud/認証キー/Gemini成功は未確認。秘密値なしのモックでモデルGET・503の非再試行・失敗後のclaim保持・成功receipt必須・10問生成と既存validation・privateな結果保存・旧snapshotの固定読取先を確認。
