# PR #96を既存 studioApi に反映する手順

対象は `yoshi-lab-db3eb` の `asia-northeast1`、Cloud Functions Gen 2の `studioApi` と対応するCloud Runサービス `studioapi` です。旧リビジョンは `studioapi-00002-caz`。PR #96は `90bcd4e3`、確認したmainは `cd48dd6a` です。リポジトリのFirebase構成は `studio-functions`、codebaseは `ai-studio`、Node.js 22です。PR #96が変える実行ファイルは `index.js` のみです。

## 今行う読み取り確認

[Cloud Shell](https://shell.cloud.google.com/?project=yoshi-lab-db3eb) に学校の承認済み管理アカウントでログインし、次を1ブロックで貼ります。Python 3とGit・gcloudだけを使います。

```sh
(
  set -eu
  work=$(mktemp -d)
  git clone --quiet --single-branch --branch ops/studio-pr96-deploy-preflight https://github.com/f9-fish/Yoshi.Lab.git "$work/Yoshi.Lab"
  cd "$work/Yoshi.Lab"
  python3 scripts/studio-pr96-deployment.py
)
```

関数、Cloud Runサービス、稼働リビジョン、両IAM、元のビルドZIPを既存の権限で読み取ります。実行モードの既定値は読み取り専用です。環境変数は名前、モデル、Pagesオリジン適合、対象Secret参照の有無だけを出します。IAMは公開Invokerの有無、IAM無効化・IAPフラグだけを出します。Secret Managerから値を取得する処理はありません。元ZIP、IAMメンバー、環境変数の値、OAuthトークンはファイルや出力へ書き出しません。

`currentSourceMatchesPrBase: true` は、取得した元ソースの固定世代にある `index.js`、`studio-core.cjs`、依存定義、ロックファイルがPR #96の変更前と一致した場合だけ出力します。元ZIPを読めない場合、別のリビジョンが稼働している場合、CORS・モデル・参照・トラフィックが想定と異なる場合は停止します。権限を増やしたり、環境変数を短絡的に補ったりしません。Firebase教員認証は元のソースと比較します。実教員アカウントでの動作試験には別の承認が必要です。

## 承認後にだけ変更するコマンド

上の同じブロックの最終行を以下に置き換えます。別途、既存Cloud Functions更新・Cloud Build等の利用と費用を承認済みであることを確認します。

```sh
python3 scripts/studio-pr96-deployment.py --apply-approved
```

同じ事前確認をやり直して構成変更がないことを確かめ、取得した元ZIPの `index.js` だけをPR #96へ差し替えます。Cloud Functions v2が発行した署名URLにアップロードし、既存関数の `updateMask=buildConfig.source` のみを指定します。既存の認証・IAM・Secret・モデル・CORS・スケーリングを設定し直すオプションは指定しません。署名URLへOAuthトークンは送りません。この操作はCloud Buildやソースの一時保存を伴います。

完了後に最新版に100%トラフィックが乗ったこと、新しいZIPのファイル内容、実行環境・Secret参照・IAMなどを照合します。`stage: post-deploy` の `configurationDiffSections: []` を確認してください。構成差分や操作状態不明が出た場合は再デプロイ・Gemini再試行をせず、[Cloud Runの対象サービス](https://console.cloud.google.com/run/detail/asia-northeast1/studioapi/revisions?project=yoshi-lab-db3eb) で管理者が確認します。ビルド・新リビジョン自体の実環境検証は、承認後の操作で初めて可能になります。

[Cloud Functions v2 更新API](https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch) · [ソースアップロードAPI](https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl)
