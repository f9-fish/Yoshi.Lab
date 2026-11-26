# PR #96を既存 studioApi に反映する手順

対象は `yoshi-lab-db3eb` の `asia-northeast1`、Cloud Functions Gen 2の `studioApi` と対応するCloud Runサービス `studioapi` です。旧リビジョンは `studioapi-00002-caz`。PR #96は `90bcd4e3`、確認したmainは `1510bb43` です。リポジトリのFirebase構成は `studio-functions`、codebaseは `ai-studio`、Node.js 22です。PR #96が変える実行ファイルは `index.js` のみです。

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

`stage: preflight` と `preflightSha256` が出た場合に限り、次へ進めます。`currentSourceBaseline: known-legacy-model-fallback` は、本番で確認した旧版との一致です。照合は `index.js` をバイト単位で行い、許可する旧版の差分は次の2点だけです。

1. `STUDIO_GEMINI_MODEL` が未設定の場合に `gemini-2.5-flash` にフォールバックする行。
2. 生成時にモデル未設定なら503を返す行がないこと。

元の `studio-core.cjs`、依存定義、ロックファイルは完全一致が必要です。PR #96の変更前と完全一致する場合は `pr96-base` と表示します。いずれの既知の版にも一致しない場合、現行ZIPや設定を読めない場合、稼働リビジョンが異なる場合は停止します。Firebase教員認証はソース照合の範囲に含まれます。実アカウントでの動作試験には別の承認が必要です。

## 承認後にだけ変更するコマンド

上の同じブロックの最終行を以下に置き換えます。別途、既存Cloud Functions更新・Cloud Build等の利用と費用を承認済みであることを確認します。

```sh
python3 scripts/studio-pr96-deployment.py --apply-approved --expected-preflight-sha256 '<確認済みのpreflightSha256>'
```

事前確認の照合値を必須とし、現在の設定・元ZIP・候補コードが一致することを再確認します。取得した元ZIPの `index.js` だけを最新main上のPR #96版へ差し替えます。更新後はモデル未設定時に生成を503で拒否します。Cloud Functions v2が発行した署名URLにアップロードし、既存関数の `updateMask=buildConfig.source` のみを指定します。既存の認証・IAM・Secret・モデル・CORS・スケーリングを設定し直すオプションは指定しません。署名URLへOAuthトークンは送りません。この操作はCloud Buildやソースの一時保存を伴います。

完了後に最新版に100%トラフィックが乗ったこと、新しいZIPのファイル内容、実行環境・Secret参照・IAMなどを照合します。`stage: post-deploy` の `configurationDiffSections: []` を確認してください。構成差分や操作状態不明が出た場合は再デプロイ・Gemini再試行をせず、[Cloud Runの対象サービス](https://console.cloud.google.com/run/detail/asia-northeast1/studioapi/revisions?project=yoshi-lab-db3eb) で管理者が確認します。ビルド・新リビジョン自体の実環境検証は、承認後の操作で初めて可能になります。

[Cloud Functions v2 更新API](https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch) · [ソースアップロードAPI](https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl)
