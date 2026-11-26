# AI教材スタジオと教科書本文マスターの読み取り連携

この段階は、教員がSTEP 1で科目・Lesson（単元ID）・Partを指定し、「本文マスターから取得」→内容を確認→「確認した英文を入力欄に反映」と進むところまでです。問題数の初期値は各2問です。既存の生成ボタンを押すまで生成は実行されません。

## 読み取り契約

対象タブは **教科書本文マスター** です。1行目は次の10列を指定順で照合します。

```text
原文ID／科目／単元ID／Part／文番号／教科書本文（英語）／日本語訳／重要文法・語句メモ／生成対象／備考
```

英C・論表に対応します。Lessonは単元IDとして文字列で照合し、`12` と `12 不定詞(1)` は別です。Partは `1` と `Part 1` を同じ指定として扱います。対象の英文を文番号順で結合し、英語本文と行数だけを返します。原文ID・文番号の重複、不正な文番号、対象0件、列不一致、権限不足は停止します。API応答2 MiB、対象本文150行・2万文字を上限とします。

既存の `studioApi/textbook-master` は既存CORS、Googleログイン済み・メール確認済みのFirebase IDトークンと `teacherUids` を通過した場合だけ処理します。Firebaseの教員フラグは読み取りだけです。サーバーは鍵ファイルを使わず、既存の実行サービスアカウントから閲覧用アカウントの短命な `spreadsheets.readonly` トークンを取得します。シートへの操作は指定タブの `values.get` だけです。ブラウザにシートの共有URL・認証情報を返さず、ログに本文やトークンを追加しません。

## 管理者が承認後に確認する設定

実シートへのアクセスやデプロイは未実施です。接続確認はまず承認済みのテスト用シートを優先します。

1. 管理者がテスト用シートまたは本番の既存シート（ID `1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU`）のタブ名と1行目を読み取りで確認します。この段階で列や教材は変更しません。
2. 承認済みの閲覧専用サービスアカウントを使い、そのアカウントに対象ファイルの **閲覧者** 権限があるか確認します。Sheetsの共有権限はタブでなくファイル単位です。学校の共有ポリシーで認められた場合だけ、対象ファイルの閲覧者として追加します。そのアカウントに不要なファイルを共有しません。
3. 既存 `studioApi` の実行サービスアカウントが、対象の閲覧用アカウントに対して `iam.serviceAccounts.getAccessToken` を持つことを確認します。必要な場合だけ、管理者が対象アカウントに限定して最小権限を設定します。Sheets APIとIAM Service Account Credentials APIの有効状態も確認し、未設定なら別途承認を取ります。サービスアカウント鍵や新しいSecretは不要です。
4. デプロイ承認後、既存サービスの環境設定に `STUDIO_MASTER_SPREADSHEET_ID`（対象IDのみ）と `STUDIO_MASTER_READER_SERVICE_ACCOUNT`（閲覧用アカウントのメール）を設定します。既存モデル、タイムアウト、Secret、CORSと公開設定を引き継ぎます。両方が揃うまでは読み取りを503で止めます。新規Cloud RunやPR #77の実験基盤は使いません。
5. 実教員でプレビューを1回試し、既存の学習・生成・公開の状態が変わらないことを確認します。生成・承認・公開は従来どおり別操作です。

権限確認先は [既存Cloud Runサービス](https://console.cloud.google.com/run/detail/asia-northeast1/studioapi/revisions?project=yoshi-lab-db3eb)、[Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=yoshi-lab-db3eb)、[IAM Credentials API](https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com?project=yoshi-lab-db3eb) です。

## モック確認

```sh
node --test --test-isolation=none studio-functions/tests/*.test.cjs
python3 tests/studio-browser.py
```

ブラウザーテストは外部通信を遮断し、確認前に本文欄を上書きしないこと、選択変更でプレビューを消すこと、反映だけでは生成を呼ばないことと既存のレビュー動作を検証します。

## Cloud Shellの接続前チェック

承認済みの学校アカウントでCloud Shellへログインし、次のブロックを貼ります。Google Cloudの設定を更新するコマンドは含みません。

```sh
(
  set -eu
  work=$(mktemp -d)
  git clone --quiet --single-branch --branch ops/studio-textbook-master-preflight https://github.com/f9-fish/Yoshi.Lab.git "$work/repo"
  cd "$work/repo"
  node scripts/studio-master-preflight.cjs
)
```

1. 現在100%のトラフィックを受ける `studioapi` リビジョンと実行サービスアカウント、閲覧用アカウントと対象シートの設定の有無を表示します。トラフィック分割のときは停止します。
2. 実行プロジェクトのIAM Credentials APIと、設定済みの閲覧用アカウントの所属プロジェクトのSheets APIを参照します。閲覧用アカウントが未設定の場合、Sheets API表示はスタジオのプロジェクトについての結果です。必要項目が不足していれば停止し、APIを有効化しません。
3. 両設定が揃い、操作者に**既存の実行アカウント代理権限**がある場合のみ、実行主体として短命トークンを使います。同じスタジオの読み取りコードで閲覧用トークンの発行と `教科書本文マスター!1:1` の閲覧を確認します。データ行や本文は取得せず、ID・トークン・レスポンスを表示しません。操作者に代理権限がない場合は実効権限を未確認として停止します。自動で権限を付与しません。対象タブ不存在と権限不足はSheetsの状態により区別できないため、管理者が確認してください。

`stage: ready` はヘッダーの読み取りと照合の成功です。実データ行、Web画面からの取得、本番のGemini呼び出しや公開はこのチェックの対象外です。
