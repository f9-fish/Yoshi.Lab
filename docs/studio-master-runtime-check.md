# 教科書本文マスターの実行環境での接続確認

`studioApi` の既存の Google ログイン・確認済みメール・`teacherUids` を通った教員が、教材スタジオの **テストシートの接続を確認** を押します。関数は実行サービスアカウントの ADC から閲覧用サービスアカウントの 5 分間の読み取り専用トークンを発行し、指定のテストシートの `'教科書本文マスター'!1:1` だけを取得します。10 列の名前と順序を検証し、画面には結果だけを返します。本文の行、トークン、ヘッダーの実値は返しません。Cloud Shell 操作者のサービスアカウント代理権限は不要です。

## 1. Cloud Shell で読み取り専用の事前確認

```bash
work=$(mktemp -d) &&
git clone -q -b ops/studio-master-runtime-check https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" &&
cd "$work/repo" &&
python3 scripts/studio-master-runtime-check.py
```

Cloud Functions と Cloud Run の構成・IAM ポリシーおよび、Cloud Functions が記録した世代固定のソース ZIP の参照権限が必要です。値やソース本文は表示しません。PR #96 の実行ファイルと一致すると `pr96`（PR #99 の読取機能未反映）、PR #99 または #100 と一致すると `pr99` または `pr100`、今回の実行ファイルと一致すると `runtime-check` と表示されます。未知のソース、既存の設定との衝突、実行 ID やトラフィックの不一致があれば停止します。ここまでで Sheets や Gemini は呼び出されません。

## 2. デプロイの明示承認後のみ

同じチェックアウトで、確認済みの `preflightSha256` を指定します。

```bash
python3 scripts/studio-master-runtime-check.py --apply-approved 'ここに事前確認の照合値'
```

既存の Gen 2 `studioApi` に対する更新です。既存の環境変数に `STUDIO_MASTER_READER_SERVICE_ACCOUNT` と `STUDIO_MASTER_SPREADSHEET_ID` を追加し、既存 ZIP 内の必要な関数ソースだけを更新します。本番用シートとは別の指定済みテストシートに接続します。ビルド、ソースアップロード、既存関数更新のための通常のデプロイ権限は必要です。IAM 変更の権限は不要です。ほかの管理者との同時更新を避けてください。Cloud Functions のビルドに失敗した場合や CLI が途中終了した場合は、再試行前に Console で最新のビルドと稼働リビジョンを確認してください。

`post-deploy` で `sourceMatches: true`、`unexpectedSettingsDiff: []`、新リビジョンを確認します。モデル、CORS、環境変数、Secret 参照、実行アカウント、関数と Cloud Run の IAM、トラフィック構成などを比較します。差分が出たら次の操作を保留します。

## 3. 教員アカウントでヘッダーを確認

別途承認された通常のサイト更新で画面側の変更が反映された後、教員ダッシュボードから AI 教材スタジオを開き、**テストシートの接続を確認** を押します。「テストシートの10列のヘッダーを確認しました」と表示されれば、実行サービスアカウントによる短命トークン発行と、テストシートの閲覧権限の両方を確認できています。生成・公開ボタンの操作は不要です。テスト設定中は、通常の「本文マスターから取得」の取得先もテストシートです。
