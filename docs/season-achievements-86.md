# 2026年後期 SEASON 1 の実績確定

期間は `2026-S3` の2026年10月1日 0:00以上、11月28日 0:00未満（JST）。最後のミリ秒を含みます。現行のシーズン切り替えは独立しています。実績未確定でも11月28日の `2026-S4` 開始を待機させる処理はありません。開いたタブの自動追従は既存の `fix/season-2026-s4-rollover` の担当です。

## 集計と公開範囲

- 対象は締切直前に `studentProfiles` に存在した全登録者。0 XP、学習記録のないプロフィール、同期していない生徒も含みます。登録日時がある場合、締切以降の登録は除きます。
- `learningRecords` の全履歴を時系列に並べ、通常のXP同期と同じ記録・再挑戦ルールを使います。Dailyは開始時刻で期間に割り当て、締切までに完了したものを集計します。完了時刻のない旧記録は締切時点のスナップショットの完了状態を使います。週間ボーナスはJSTの達成日に計上します。学習日数は有効な学習または完了DailyのあったJSTの日数で、同日は1日です。
- XP降順、表示名順、UID順で並べます。同点は同順位にせず、現在のランキングと同じ比較関数で順番を決めます。確定処理は学校向けに日本語ロケールで統一します。12,000 XP以上かつ最終全体10位以内がRadiantです。11位以下は現行判定でMasterです。通常Radiantバッジも表示側で扱えます。
- `seasonAchievements/2026-S3/students/{uid}` は本人限定で、最終ランク・順位、XP、学習日数、バッジと確定時刻を保持します。`highestRankTier: "unknown"` は、途中時点の順位とランク到達履歴を証明できない記録です。最終ランクから推測しません。
- `seasonAchievements/2026-S3/ranking` は登録済みの確認済みGoogleユーザーに限定。UID別のバッジと最終TOP10の表示名・順位・バッジのみです。学習日数、個人のXP、クラス、メールアドレスと学習記録は含めません。集計メタデータは管理者のみです。画面からは書き込めません。

## Google Cloud Shellで確定する

### 締切を証明できる手段

| 手段 | 判断 |
| --- | --- |
| RTDBの自動バックアップ／エクスポート | 利用できる場合は取得時刻と復元根拠を確認します。日次バックアップがあるだけでは11月28日 00:00 JSTの復元点にはなりません。[RTDBの自動バックアップ](https://firebase.google.com/docs/database/backups) |
| ポイントインタイム復元 | RTDBに使える復元機能・外部の復元履歴は未確認です。FirestoreのPITRをRTDBに適用できるとは扱いません。 |
| 監査ログ | 対象パスの全書き込み経路を覆う設定、対象期間の保持、ログの欠落や遅延、更新・削除の追跡可能性を確認します。ログが見当たらないだけでは無更新の証明になりません。[RTDB監査ログ](https://firebase.google.com/docs/database/usage/audit-logging) |
| Cloud Run・Cloud Scheduler | リポジトリで確認できるCloud Runは教材スタジオ用です。この用途に流用しません。Schedulerは起動時刻やHTTP読み取り完了時刻を保証せず、再実行もあり得ます。仮に既存ジョブが利用可能でも、取得後に締切時点を検証する条件は同じです。[Schedulerの概要](https://cloud.google.com/scheduler/docs/overview) |

11月27日までに、管理者は [Realtime Database](https://console.firebase.google.com/project/yoshi-lab-db3eb/database) のバックアップ設定・復元点、[ログ エクスプローラ](https://console.cloud.google.com/logs/query?project=yoshi-lab-db3eb) の監査対象と保持期間、必要に応じて [Cloud Run](https://console.cloud.google.com/run?project=yoshi-lab-db3eb) と [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler?project=yoshi-lab-db3eb) の既存構成を参照します。これらの本番設定は今回未確認です。推奨は、証明済みの復元点を優先し、利用できなければ既存の監査で変更の有無を証明できる範囲で、Cloud Shellの1回実行を使う方法です。

### 1. 締切前の準備

Firebase Consoleの **Realtime Database → データ** で、対象のプロジェクトとデータベースURLを確認します。リポジトリ上の接続先は `yoshi-lab-db3eb` の `https://yoshi-lab-db3eb-default-rtdb.firebaseio.com` です。参照するのは `studentProfiles` と `learningRecords`、確定結果の保存先は `seasonAchievements/2026-S3` です。公開表示のRulesが承認済みかはFirebase Consoleで確認します。確定スクリプトはRulesと認証を操作しません。

[Google Cloud Shell](https://shell.cloud.google.com/?project=yoshi-lab-db3eb) で、レビュー対象のPRブランチを取得します。学校がCloud Shellでの学習データ取り扱いを許可していることを確認してください。記録をGitの作業ツリーに置かず、他人と共有しない個人ディレクトリに保存します。

```sh
git clone --branch feat/season-s3-cutoff-capture https://github.com/f9-fish/Yoshi.Lab.git yoshi-s3-tools
cd yoshi-s3-tools
git rev-parse HEAD
node --version
npm ci --prefix studio-functions
umask 077
S3_DIR=$(mktemp -d "$HOME/yoshi-s3.XXXXXX")
printf '%s\n' "$S3_DIR"
export LC_ALL=ja_JP.UTF-8 LANG=ja_JP.UTF-8
node -p 'new Intl.Collator().resolvedOptions().locale'
RTDB_URL=https://yoshi-lab-db3eb-default-rtdb.firebaseio.com
```

Node.js 22または24を使用します。ロケール確認は `ja-JP` です。同じCloud Shellセッションで以降の操作を行います。再接続したら表示された保存先を `S3_DIR` に戻してください。

### 2. 締切を裏づける原本を用意する

締切は **2026-11-28 00:00 JST**（`1795791600000`）です。対象は締切直前までの状態です。RTDBの2パスを別々の時刻に読む方法や、通常の締切後エクスポートから新規記録だけを削る方法では、編集・削除を復元できません。次のどちらかを使います。

**A. 検証された締切復元点がある場合**
管理者が検証した締切時点のバックアップ、または監査記録に基づいて復元した単一のエクスポートを `$S3_DIR/cutoff-export.json` に用意します。両入力パスが同じ復元点に由来することを確認してください。別時刻のバックアップに締切のラベルを付けるだけでは使えません。

**B. 締切から取得完了まで対象への書き込みが無かったことを証明できる場合**
承認済みの運用・監査証跡で、締切より前から読み取り完了まで、対象2パスへの新規作成・変更・削除が無かったと証明できる場合に限ります。予定や画面上の目視、取得時刻だけでは証明になりません。Rulesやアクセス設定を無断で変更して書き込みを止める操作は行いません。

RTDBのADCは `firebase.database` と `userinfo.email` スコープを含む、学校承認済みの認証を使用します。ADCを設定する場合は管理者が承認した方法を使います。例となるユーザーADCのコマンドは以下です。ブラウザの認証画面を使い、鍵やトークンを貼り付けないでください。学校の既定のADCがある場合は再設定不要です。確定時の権限は別途確認します。

```sh
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/firebase.database,https://www.googleapis.com/auth/userinfo.email
```

11月27日 **23:58〜23:59 JST** にCloud Shellを開いたまま次のコマンドを実行します。スクリプトは締切まで待ち、学校が承認したADCで、RTDBのルートを**1回のGET**の成功応答から取得します。メモリー内で2パスを選択し、専用ファイルにだけ書き出します。RESTルートの読み取り権限が無い場合は、別々のAPI呼び出しに切り替えずAを使います。

```sh
node scripts/prepare-season-achievement-source.cjs capture \
  --database-url "$RTDB_URL" --output "$S3_DIR/capture.json"
```

取得コマンドは一時的な通信失敗だけを最大3回まで試み、締切後2分以降の応答を拒否します。HTTPのDateヘッダーと端末時計を照合し、時計が飛んだ場合や、締切後の日付が記録内にある場合は候補を作りません。既存の候補を上書きしません。HTTP日時は書き込み履歴や厳密なスナップショット時刻の証明になりません。エラーで候補がなければ、締切後2分以内だけ同じコマンドを再実行できます。期限を過ぎたらAの検証済み復元点を調べます。

**どちらも証明できなければ公開を保留します。** SEASON 2の開始は独立しています。取得コマンド自体は、対象への書き込みが無かったことを保証しません。

### 3. 原本を検証してドライラン

承認された実際の監査記録番号と対象DBに基づき、Cloud Shellのエディタで `$S3_DIR/evidence.json` を用意します。参照欄には生徒名や秘密情報を含めません。原本のSHA-256は `sha256sum "$S3_DIR/cutoff-export.json"`（Bなら `capture.json`）で求めます。監査済みの原本そのもののハッシュを入力します。

Aの形式

```json
{"method":"verified-cutoff","asOf":1795791600000,"databaseURL":"https://yoshi-lab-db3eb-default-rtdb.firebaseio.com","reference":"承認済み復元点の管理番号","inputSha256":"原本のSHA-256"}
```

Bの形式。両数値の `0` は例のプレースホルダーです。変更がなかったことを証明できる実際の期間をUnixミリ秒で設定します。

```json
{"method":"unchanged-window","unchangedFrom":0,"unchangedThrough":0,"databaseURL":"https://yoshi-lab-db3eb-default-rtdb.firebaseio.com","reference":"承認済み監査記録番号","inputSha256":"原本のSHA-256"}
```

```sh
# Bの場合は cutoff-export.json を capture.json に変更
node scripts/prepare-season-achievement-source.cjs seal \
  --input "$S3_DIR/cutoff-export.json" --evidence "$S3_DIR/evidence.json" \
  --output "$S3_DIR/season-s3.json"
node scripts/finalize-season-achievements.cjs --source "$S3_DIR/season-s3.json"
```

締切後の時刻が含まれるプロフィール・学習記録・Daily完了、取得根拠やハッシュの不一致は拒否します。確定用ファイルは上書きしません。時計ずれで締切以降の時刻がある場合も、原本を編集せず監査担当者に確認してください。取得根拠は管理者が外部記録と照合します。ツールが監査記録そのものの正しさを判定することはできません。

ドライランは書き込みを行いません。対象件数、Radiant件数、対象DBと `sourceHash` を確認し、レビューしたコミットとともに管理記録に残してください。

### 4. 書き込み承認後だけ確定

承認された管理者が、確認した **ドライランの `sourceHash`** を指定して実行します。

```sh
node scripts/finalize-season-achievements.cjs \
  --source "$S3_DIR/season-s3.json" --expected-sha256 '<ドライランのsourceHash>' \
  --project-id yoshi-lab-db3eb --database-url "$RTDB_URL" --publish
```

`seasonAchievements/2026-S3` のみをトランザクションで作成します。接続断の場合は同じファイル・ハッシュ・ロケールで再実行して `published` または `already-published` と件数を確認します。別の入力や既存の不完全なパスは拒否します。値を印刷せず、原本・監査情報・確定用入力は学校の承認済み保管先に移し、Cloud Shell側も学校の保管方針に従って管理します。
