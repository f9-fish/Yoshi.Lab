# 準備済みの AI生成問題マスターに接続

対象は `yoshi-lab-db3eb` の既存 Gen 2 `studioApi` です。確定済みの専用アカウント `yoshilab-question-writer@yoshi-lab-db3eb.iam.gserviceaccount.com` を使用します。シートIDは接続操作時に入力します。既存本文マスターに該当するシートIDおよび本文閲覧用サービスアカウントは使用できません。

## 今すぐ実行できる読み取り専用確認

```bash
work=$(mktemp -d) &&
git clone -q -b ops/studio-question-master-connect https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" &&
cd "$work/repo" &&
read -r -p '準備済みの問題保存先シートID: ' question_sheet &&
python3 scripts/studio-question-master-deployment.py connect --sheet-id "$question_sheet"
```

- `writer-iam` は専用アカウントのポリシーと、Policy Troubleshooter による実行アカウントの `iam.serviceAccounts.getAccessToken` を確認します。読み取り結果の `granted` は権限評価であり、実際の短命トークンの発行やシート共有の確認は行いません。
- `denied` の場合は原因を確認します。組織などで拒否が適用されていれば、直接付与だけでは解決しません。 `unverified` の場合は同ツールを既存の参照権限で利用できる管理者に確認を依頼します。直接付与が表示されても、実効権限が未確認の間は適用を停止します。
- `sourceBaseline` の `known-runtime` は本文マスター接続まで、`pr103` は共有保存の初期版、`target` は今回の接続対象と同じソースが稼働していることを示します。未知のソース、予期しない環境変数や分割トラフィックがあれば停止します。
- 参照専用のIAM評価は HTTP POST を使います。IAMポリシーの変更、APIの有効化、トークン発行およびSheetsへのアクセスは行いません。Policy Troubleshooterを使えない場合は、既存環境の設定・権限を確認してください。

## 発行権限の不足が確定し、IAM変更を承認した場合のみ

最小権限は `iam.serviceAccounts.getAccessToken` のみです。既に同じ権限だけを含むプロジェクトのカスタムロールがある場合はそれを再利用します。ない場合の作成コマンドを示します。作成にも別途承認が必要です。

```bash
gcloud iam roles create yoshilabQuestionAccessToken \
  --project=yoshi-lab-db3eb --title='Yoshi.Lab question writer access token' \
  --permissions=iam.serviceAccounts.getAccessToken --stage=GA
```

カスタムロールを、下記の対象サービスアカウントだけに付与します。Cloud Shell操作者には付与しません。

```bash
gcloud iam service-accounts add-iam-policy-binding \
  yoshilab-question-writer@yoshi-lab-db3eb.iam.gserviceaccount.com \
  --project=yoshi-lab-db3eb \
  --member='serviceAccount:543561154900-compute@developer.gserviceaccount.com' \
  --role='projects/yoshi-lab-db3eb/roles/yoshilabQuestionAccessToken' \
  --condition=None
```

発行権限が確認済みなら追加付与は不要です。付与後は読み取り専用確認を再実行します。Policy Troubleshooterが利用できる場合は、IAM評価の根拠を Console でも確認できます。 [Policy Troubleshooter](https://console.cloud.google.com/iam-admin/troubleshooter?project=yoshi-lab-db3eb)

## 本番への接続を明示承認した後のみ

同じ Cloud Shell で、新しい事前確認の `preflightSha256` を指定します。

```bash
python3 scripts/studio-question-master-deployment.py connect --sheet-id "$question_sheet" \
  --apply-approved '事前確認に表示された照合値'
```

この操作は全教員の共有保存を有効にします。指定教員だけで試す場合は、別シートと別サービスアカウントを使う [試験接続手順](studio-question-master-deployment.md) を利用できます。既に接続設定が存在する場合、この `connect` は上書きせず停止します。

既存の関数を対象に、必要な場合だけ対象ソースを更新し、既存値を保持して問題保存先と書き込み用サービスアカウントの2変数を追加します。新リビジョン、`sourceMatches: true`、`unexpectedSettingsDiff: []` を確認します。モデル、Secret参照、CORS、IAM、トラフィックなどについて予定外の差分があれば、次の作業を保留します。更新中の同時設定変更は避けてください。

生成・公開を実行するのは別途承認後です。検証は架空英文で5種×2問を生成し、自動保存、別端末の履歴検索、編集・承認、承認対象だけの公開を確認します。現在のPRの検証はすべてモックです。
