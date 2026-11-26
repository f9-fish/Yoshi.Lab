# 問題マスターの読み取り接続確認と復旧

対象は `yoshi-lab-db3eb` の既存 Gen 2 `studioApi` です。書き込み用SAに付与済みのカスタムロールを再付与する操作はありません。以下の通常実行は Cloud API の構成、IAM評価、世代固定ソースを確認するだけです。Sheets、Gemini、教材公開を呼び出しません。

## 1. 今すぐ実行できる事前確認

```bash
work=$(mktemp -d) && git clone -q -b ops/studio-question-master-readonly-rollout https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" && cd "$work/repo" && read -r -p '問題保存先シートID: ' question_sheet && python3 scripts/studio-question-master-deployment.py connect --sheet-id "$question_sheet"
```

- `sourceBaseline`、`revision`、`sourceChanges`、`preflightSha256` を確認します。未知のソース、サービス構成、既存設定と衝突した場合は停止します。
- `directExactCustomRole: true` は、書き込み用SAへの無条件の直接付与、実行SAとの一致、カスタムロールに含まれる権限が `iam.serviceAccounts.getAccessToken` のみであることを参照APIで確認できた状態です。
- `policyState: UNKNOWN_INFO` は実効権限が未確定です。診断で許可された場合は追加オプションは不要です。明示拒否、診断不能、カスタムロールの定義・付与を確認できない場合には、以下の例外は使えません。

## 2. 接続確認用デプロイの明示承認後

同じ Cloud Shell で、事前確認の照合値を指定します。

```bash
python3 scripts/studio-question-master-deployment.py connect --sheet-id "$question_sheet" --apply-approved 'connectの照合値'
```

実効権限が `UNKNOWN_INFO` の場合は、`directExactCustomRole: true` で、かつ不確定な状態で読み取り接続を検証することを承認した場合に限り `--accept-unverified-iam` を追加できます。これはポリシー上の許可を意味するものではありません。

既存の環境変数に指定の2件と一時的な接続確認フラグを追加します。フラグのある間は共有下書きの保存・編集をAPI側で停止し、従来の生成・公開経路を維持します。新リビジョンで `sourceMatches: true`、`unexpectedSettingsDiff: []` を確認します。対象コード以外のアーカイブ内容と、モデル、Secret参照、CORS、IAM、トラフィック、本文マスター設定を比較します。LOW設定は既存生成コードを保持します。

適用前に作られる `studio-question-master-before.json` を同じ Cloud Shell に保管してください。接続前のソースの保存場所と世代、および照合値が記録されます。Secret値やソース本文は書き出しません。操作に失敗した場合も、Cloud Consoleで状態を確認するまでこのファイルを保存してください。

### 読み取り接続の確認

教員画面の変更も承認された通常の手順で反映した後、AI教材スタジオの **問題マスターの接続を確認** を押します。既存の教員認証を通ったリクエストだけが、実行SAから書き込み用SAの読み取り専用短命トークンを取得し、Google SheetsのメタデータをGETします。結果が成功なら、実行環境でのトークン発行と対象シートへの閲覧アクセスを確認できています。編集権限の実地検証は書き込みを承認した後に行います。

## 3. 共有保存の有効化を別途承認した後

まず読み取り専用で確認します。

```bash
python3 scripts/studio-question-master-deployment.py activate --sheet-id "$question_sheet"
```

有効化の承認取得後、教員画面で接続が成功したことを確認して実行します。

```bash
python3 scripts/studio-question-master-deployment.py activate --sheet-id "$question_sheet" --connection-verified --apply-approved 'activateの照合値'
```

`UNKNOWN_INFO` の場合は上と同じ条件で `--accept-unverified-iam` を追加します。この段階は一時フラグを外す環境変数更新です。共有保存の2変数が残ります。終了後に新リビジョンと設定差分を再確認します。Gemini生成、Sheets書き込み試験、教材公開はそれぞれ別途承認後に行います。

## 復旧

接続確認中・有効化後のどちらも同じ手順です。接続前の記録が残っている同じチェックアウトから次を実行します。

```bash
python3 scripts/studio-question-master-deployment.py rollback --sheet-id "$question_sheet"
```

確認された照合値を、復旧が明示承認された後に `--apply-approved 'rollbackの照合値'` として渡します。既存 Gen 2 関数で元の世代のソースを復元し、今回追加した設定を除去します。接続後の予期しないソース変更や既存設定の差分があれば停止します。元の世代を取得できない場合も自動復旧を停止します。Cloud Runへの直接のトラフィック変更や、Sheetsに保存済みのデータの削除は行いません。
