# 教科書本文マスターの本番切り替え

切り替えは、候補を追加する `stage` と取得先を切り替える `switch` に分けます。各フェーズとも `--apply-approved` を省略すると読み取り専用で実行します。Cloud Functions、Cloud Run、IAM、世代固定のソース ZIP を読み取り、Sheets には接続しません。

## 1. Cloud Shell で事前確認

本番スプレッドシートの URL の `/d/` と `/edit` の間にある ID を入力します。

```bash
work=$(mktemp -d) &&
git clone -q -b ops/studio-master-production-switch https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" &&
cd "$work/repo" &&
read -r -p '本番スプレッドシートID: ' sheet_id &&
python3 scripts/studio-master-production-switch.py stage --sheet-id "$sheet_id"
```

`revision` と `preflightSha256` を確認します。稼働ソースは接続確認済みの実装とバイト単位で照合します。関数と稼働リビジョンで設定が揃わない場合、既存の単一リビジョンへのトラフィックが変わっている場合、または未知のソースの場合は停止します。

## 2. 候補を追加するデプロイの明示承認後

同じ Cloud Shell で、事前確認の照合値を指定します。

```bash
python3 scripts/studio-master-production-switch.py stage --sheet-id "$sheet_id" --apply-approved 'stageの照合値'
```

既存 Gen 2 関数のソースと候補 ID だけを更新します。通常の本文取得先はテストシートのままです。教員画面側の変更も承認済みの通常経路で反映してから、教材スタジオで実在する科目・Lesson・Partを指定し、**切り替え候補の本文形式を確認** を押します。タブ `教科書本文マスター`、先頭10列のヘッダーと順序、対象文の原文ID・文番号・英文・重複・行数上限を既存の取得処理と同じ条件で確認します。確認は指定した組み合わせ単位です。利用開始に必要な科目と単元を確認してください。読み取りには既存の閲覧用サービスアカウントと読み取り専用スコープを使い、結果には本文やトークンを含めません。アクセスに失敗した場合は、対象シートが既存の閲覧用サービスアカウントに閲覧者として共有されているかを確認し、切り替えを保留します。

## 3. 本番切り替えの明示承認後

```bash
python3 scripts/studio-master-production-switch.py switch --sheet-id "$sheet_id"
```

候補の ID と稼働ソースを照合した結果の `preflightSha256` を指定します。教員画面で候補を確認できた場合にだけ `--candidate-verified` を付けます。このフラグは管理者による確認の申告です。

```bash
python3 scripts/studio-master-production-switch.py switch --sheet-id "$sheet_id" --candidate-verified --apply-approved 'switchの照合値'
```

この段階の更新対象は、既存の Gen 2 関数の環境変数です。取得先を本番シートへ変更し、候補 ID を削除します。各更新後に、新リビジョン、`sourceMatches: true`、`unexpectedSettingsDiff: []` を確認します。モデル、CORS、Secret 参照、サービスアカウント、IAM、トラフィック構成などに差分が出たら作業を止めます。適用時は他の管理者による同時更新を避けてください。

最後は教員画面の **本文マスターから取得** でプレビューを確認します。生成・公開の操作はこの手順に含みません。
