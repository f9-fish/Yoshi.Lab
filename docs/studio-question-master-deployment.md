# AI生成問題マスターの接続手順

既存の Cloud Functions Gen 2 `studioApi`（`yoshi-lab-db3eb`、`asia-northeast1`）を対象にします。通常実行は Cloud Functions、Cloud Run、IAM ポリシーと世代固定のソース ZIP の参照だけです。Sheets、Gemini、GitHub の公開 API は呼びません。

## 空のスプレッドシートと最小権限

承認後に試験・本番それぞれについて以下を行います。本番用は **Yoshi.Lab AI生成問題マスター** とし、試験用は名前に「試験用」を含めます。

1. Google Sheets で独立した空のファイルを作成します。一般的なアクセスは「制限付き」にします。既定の空タブは残せます。個別のバッチタブと20列のヘッダーは初回保存時に作られるため、列やタブを手動で追加する必要はありません。
2. Google Cloud Console の **IAM と管理 → サービス アカウント → サービス アカウントを作成** で試験・本番用を別々に用意します。試験用の例は `yoshilab-question-pilot`、本番用は `yoshilab-question-writer` です。プロジェクトのロールは付けず、サービスアカウント鍵も作りません。
3. 各ファイルの **共有** で対応する書き込み用アカウントだけを自動処理の編集者として追加します。本文マスターや既存の下書きファイルには共有しません。Sheets の「編集者」は対象ファイルの閲覧も可能です。アプリは読み戻し、履歴、編集にその権限を使用します。
4. **サービス アカウント → 対象の書き込み用アカウント → 権限** で、既存の `studioApi` 実行アカウント `543561154900-compute@developer.gserviceaccount.com` に、そのアカウントの範囲でのみ短命アクセストークンの発行権限を設定します。最小構成は `iam.serviceAccounts.getAccessToken` だけを含むカスタムロールです。既存のカスタムロール運用がなければ、標準の `roles/iam.serviceAccountTokenCreator` を対象サービスアカウント単位で付与できます。この標準ロールには署名などの追加権限も含まれます。Cloud Shell 操作者への代理権限付与は不要です。
5. **API とサービス → 有効な API とサービス** で `sheets.googleapis.com` と `iamcredentials.googleapis.com` を確認します。既に有効な場合は操作不要です。必要な変更が見つかった場合は個別に承認を得ます。試験用 Firebase UID は、既に `teacherUids` で教員に登録済みのアカウントを Firebase Authentication のユーザー一覧で確認します。

[サービスアカウント画面](https://console.cloud.google.com/iam-admin/serviceaccounts?project=yoshi-lab-db3eb) · [有効なAPI](https://console.cloud.google.com/apis/dashboard?project=yoshi-lab-db3eb) · [Firebase Authentication](https://console.firebase.google.com/project/yoshi-lab-db3eb/authentication/users) · [短命トークンの権限](https://cloud.google.com/iam/docs/service-account-permissions)

## Cloud Shell

まず試験用シートID、専用アカウントのメール、試験教員UIDを控え、事前確認を実行します。シートIDはURLの `/d/` と `/edit` の間です。

```bash
work=$(mktemp -d) &&
git clone -q -b ops/studio-question-master-deployment https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" &&
cd "$work/repo" &&
read -r -p '試験用シートID: ' pilot_sheet &&
read -r -p '試験用専用アカウント: ' pilot_writer &&
read -r -p '試験教員のFirebase UID: ' pilot_uid &&
pilot=(pilot --sheet-id "$pilot_sheet" --writer "$pilot_writer" --pilot-uid "$pilot_uid") &&
python3 scripts/studio-question-master-deployment.py "${pilot[@]}"
```

`sourceBaseline` は既知の実行ソース、PR #103、今回の版のどれと一致したかを示します。未知の稼働ソース、依存ファイルの差分、別の管理者による直前の設定変更、分割トラフィックがあれば停止します。Source archive の参照とポリシー取得には、既存の管理者用参照権限が必要です。ソースや設定値、Secret の中身は出力しません。

**試験接続デプロイの明示承認後**、同じ Cloud Shell で照合値を渡します。

```bash
python3 scripts/studio-question-master-deployment.py "${pilot[@]}" --apply-approved '試験用の照合値'
```

更新先は既存の Gen 2 関数です。ソース変更が必要な場合は現行アーカイブで対象ファイルだけを更新し、環境変数は既存値を保持して追加します。適用後は新しいリビジョン、`sourceMatches: true`、`unexpectedSettingsDiff: []` を確認します。モデル、CORS、Secret 参照、実行アカウント、関数・Cloud Run の IAM、トラフィックなどを比較します。差分がある場合は次の操作を保留してください。

### 試験用シートでの確認

**実 Gemini 実行と試験シート書き込みの明示承認後**、指定教員で教材スタジオを開きます。

1. 架空の英文で各種類2問を指定して生成し、**10問を共有下書きに保存しました（要確認）** を確認します。未保存の場合は同じタブの再試行を使い、同じバッチが1つだけ存在することを確認します。
2. 別ブラウザーで同じ教員としてログインし、科目・Lesson・Part・当日（JST）を指定して検索します。5種類×2問、全件「要確認」を確認します。
3. 1問だけ訳を変更して保存し、別ブラウザーで反映を確認します。編集した項目を承認し、その1問だけが「承認済」になることを確認します。古い画面から同じ問題を変更すると競合で停止します。
4. 試験教員の公開操作はサーバーで無効です。指定外教員は試験用の共有履歴にアクセスできず、従来の教材スタジオ経路を使用します。教材公開での動作確認は不要です。

### 本番の共有保存への切り替え

試験合格後、本番用の別シートと別の専用アカウントを指定します。試験データの移行はありません。

```bash
read -r -p '本番用シートID: ' production_sheet &&
read -r -p '本番用専用アカウント: ' production_writer &&
production=(production --sheet-id "$production_sheet" --writer "$production_writer" --pilot-uid "$pilot_uid" --pilot-sheet-id "$pilot_sheet" --pilot-writer "$pilot_writer") &&
python3 scripts/studio-question-master-deployment.py "${production[@]}"
```

**本番切り替えの明示承認後**、同じコマンドに `--apply-approved '本番用の照合値'` を追加します。この段階は環境変数だけを更新し、ソースの再アップロードを行いません。本番では既存の教員認証を通った教員が共有保存・履歴を利用し、公開には保存済み問題の承認が必要です。

## 1バッチ1タブ方式の上限

| 項目 | 現行実装での影響 |
| --- | --- |
| セル数 | 10問は12行×20列で240セル。1ファイル1,000万セルからの理論値は約41,666バッチです。既定タブや他のグリッドを含むため実際はこれより少なく、運用上の推奨上限ではありません。 |
| 検索 | タブ名の一覧を取得し、8タブずつ本文を読み出して絞り込みます。検索条件が古い1件だけに一致する場合、1,000バッチで最大125ページです。セル上限に達する前に検索負担が問題になります。 |
| API枠 | 標準枠はプロジェクトあたり毎分300件、ユーザー・プロジェクトあたり毎分60件で、読み取りと書き込みにそれぞれ適用されます。専用アカウントの枠を複数教員が共有します。保存には少なくとも書き込み1回と読み戻し1回が必要です。 |
| 編集・運用 | 編集・承認・公開状態の確定ごとに、競合防止用のメタデータを残します。セル数とは別にメタデータの利用枠があり、行やタブの手作業による整理は競合判定と履歴を壊す可能性があります。タブIDとメタデータIDは有限のハッシュ空間を使い、衝突は自動上書きせず失敗します。 |

限定試験には現行方式を使えます。恒常運用では、古い範囲の検索に要するページ数、429、処理時間、メタデータ利用量を確認し、履歴が増える前に索引付きの保存方式を検討します。単純な追記に移行する場合も、一意性と競合制御を失わないことが条件です。固定のタブ数上限はこの評価に使用していません。

[Google スプレッドシートのサイズ上限](https://support.google.com/drive/answer/37603) · [Sheets API の使用量上限](https://developers.google.com/workspace/sheets/api/limits) · [開発者メタデータ](https://developers.google.com/workspace/sheets/api/guides/metadata)
