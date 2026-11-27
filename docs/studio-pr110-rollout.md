# PR #110 の反映確認と承認後の適用

既存 `studioApi` の実行ファイルは `studio-functions/index.js`、`studio-functions/question-master.cjs`、`studio-functions/studio-core.cjs` の3件です。Pages側は `index.html`、`studio-practice.js`、`teacher-studio.html`、`writing.html`、`writing.js`、`writing-training.js` の6件です。PR #110 の差分に `studio-content.json` と従来の問題集JSONは含まれません。

## 読み取り専用チェック

Cloud Shell に次の1行を貼り付けます。Sheets、Gemini、教材公開の呼び出しを行いません。

```bash
work=$(mktemp -d) && git clone -q -b ops/studio-pr110-rollout https://github.com/f9-fish/Yoshi.Lab.git "$work/repo" && cd "$work/repo" && python3 scripts/studio-publication-runtime-preflight.py --pr 110
```

`pr110Deployed: true` なら実行ソースは反映済み、`false` ならPR #110直前の実行ファイルと一致しています。未知の版、追加の実行ソース差分、分割トラフィック、関数と稼働リビジョン間の接続設定不一致があれば停止します。リビジョンが `studioapi-00007-nic` か、さらに新しいものかは実行結果で確認します。

Pagesの反映はAPIとは別です。配信側を確認する場合は同じ Cloud Shell から次を実行します。どのファイルが最新mainと一致するかを確認します。Pagesの配信設定やカスタムドメインが異なる場合は、実際の運用URLに合わせてください。

```bash
for file in index.html studio-practice.js teacher-studio.html writing.html writing.js writing-training.js; do if curl -fsSL "https://f9-fish.github.io/Yoshi.Lab/$file" | cmp -s - <(git show "origin/main:$file"); then printf '%s %s\n' "$file" MATCH; else printf '%s %s\n' "$file" DIFFERENT_OR_UNREACHABLE; fi; done
```

## 接続設定を維持した反映

本番反映を明示承認し、かつ `pr110Deployed: false` の場合だけ、同じチェックアウトで直近の照合値を渡します。

```bash
python3 scripts/studio-publication-runtime-preflight.py --pr 110 --apply-approved 'preflightSha256'
```

更新する Gen 2 の項目は `buildConfig.source` のみです。既存アーカイブの変更対象は前記の3件だけです。実行アカウント、モデル、Secret参照、CORS、IAM、本文・問題マスターの設定、トラフィックの構成を前後比較します。 `sourceMatches: true`、`unexpectedSettingsDiff: []`、新リビジョンを確認します。公開JSONのblob SHAも前後に表示します。別作業による公開JSONの差分が表示された場合は、そのコミットを確認します。Pages側の配信や教員による生成・公開をこのコマンドは行いません。

## 実機確認と戻し方

最初は生徒の英C → **公開済みの追加単語・熟語（XPなし）** → Lesson 8 → Part 1で `due to` を確認します。従来の単語Practiceにも同単元の既存セットが残っていることを確認します。原文1行と5分類×2問の生成・保存は、実Geminiと実シート書き込みが別途承認された後、教員の共有下書きで確認します。承認・公開はこの確認に不要です。

API適用前の `studio-pr110-before.json` は同じ Cloud Shell に保存します。復旧が必要な場合は `python3 scripts/studio-publication-runtime-preflight.py --pr 110 rollback` で元ソースと現行設定の整合性を確認し、復旧を明示承認した後に `--apply-approved` を追加します。元の世代を参照できない場合や、適用後に別の変更が入った場合は停止します。旧APIは新しい熟語・原文行を含むバッチに対応しないため、新形式で書き込んだ後は旧APIへの復旧を適用する前に影響を確認し、必要なら互換性を維持した修正を優先します。自動でシートを戻す操作は行いません。

Pages側の復旧は別のPRで行い、最新mainとの差分を確認して上記6件の必要な変更だけを取り消します。Cloud Runのトラフィックを直接変更したり、公開教材JSONや従来の問題集を古いコピーで戻したりする操作はこの手順に含みません。
