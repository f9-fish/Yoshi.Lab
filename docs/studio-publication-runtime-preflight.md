# PR #108 稼働ソースの照合と英C Lesson 8 Part 1 の公開前確認

## 読み取り専用の事前確認

Cloud Shell に1行で貼り付けます。既存バックアップの元バイト列と Git blob SHA・SHA-256 を照合し、最新 main と稼働APIのソースを比較します。

```bash
work=$(mktemp -d) && git clone -q -b ops/studio-publication-runtime-preflight https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" && cd "$work/repo" && node scripts/studio-publication-audit.cjs --verify '/home/f9_fish/yoshilab-lesson8-before-20261127-004343' && python3 scripts/studio-publication-runtime-preflight.py
```

- `pr108Deployed: true` は稼働している実行ファイルが PR #108 の版と一致した状態です。 `false` は認識できた直前版です。未知のソース、別の実行構成、分割トラフィック、最新 main の追加の実行ソース変更があれば停止します。
- 根拠となるAPIはCloud Functions・Cloud RunおよびそのIAMの参照と、世代固定のソースZIPです。本文マスターと問題マスターの設定が関数と稼働リビジョン間で一致することを確認し、値は出力しません。
- 実際の公開承認直前に、共有履歴の対象バッチで **承認済みの公開内容を確認** を押し、**英C / Lesson 8 / Part 1、承認・採用済み1問、新規公開** と表示されたら **キャンセル** します。想定件数やキーが異なる場合は公開しません。この操作は問題マスターとGitHubを参照し、公開の書き込みは行いません。
- バックアップの検証は保存内容の整合性確認です。現在のファイルが同じ版か未確認の場合は、同じチェックアウトで次を実行して最新ファイルと衝突を再確認します。

```bash
audit_dir=$(mktemp -d) && node scripts/studio-publication-audit.cjs --subject '英C' --lesson '8' --part '1' --output "$audit_dir/before"
```

公開JSONの blob SHA が過去の値と異なる場合は、新しいバックアップを使って衝突・公開対象を再度確認します。

## 未反映時のみ、デプロイの明示承認後

同じチェックアウトで、直近の `preflightSha256` を指定します。

```bash
python3 scripts/studio-publication-runtime-preflight.py --apply-approved '事前確認の照合値'
```

既存 Gen 2 関数を、`buildConfig.source` のみを対象に更新します。世代固定の既存ZIPで変更する実行ファイルは `index.js` だけです。本文マスター、問題マスター、モデル、Secret参照、CORS、IAM、稼働トラフィックの構成は比較対象に含みます。 `sourceMatches: true`、`unexpectedSettingsDiff: []`、新リビジョンを確認します。照合に差分があれば、再実行の前にCloud Consoleで状態を確認します。生成・教員画面の変更・教材の公開をこのコマンドは実行しません。

## API ソースのロールバック

適用前に自動保存される `studio-pr108-before.json` を保管します。元のソースZIPの世代と設定の照合値が入ります。接続先や秘密値は記録しません。

```bash
python3 scripts/studio-publication-runtime-preflight.py rollback
```

読み取り結果を確認し、**復旧の明示承認後**、同じコマンドに `--apply-approved 'rollbackの照合値'` を追加します。既存 Gen 2 関数に元のソース世代の内容を戻します。その後ソースと設定を再照合します。適用後に別のソース・設定変更がある場合や元の世代が参照できない場合は停止します。

教材を公開した後に取り消す場合は、APIのロールバックと独立した作業です。バックアップ・公開コミット・後続差分を比較し、対象グループだけを復旧PRで戻します。シートの公開履歴はその変更に連動しません。詳細は [教材公開の復旧手順](studio-publication-audit.md#失敗時の確認と復旧) を参照してください。
