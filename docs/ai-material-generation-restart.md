# 教科書本文マスター連動の再開と初回生成

比較対象は main `499cbce9` と [PR #77](https://github.com/f9-fish/Yoshi.Lab/pull/77) の `867fffa8` です。

| 系統 | 実装済み | 接続する前の確認 |
| --- | --- | --- |
| 現行AI教材スタジオ / `studioApi` | 教員Google認証、本文手入力、単語・穴埋め・Q&A・True/False・Discussionの生成、編集、端末内下書き。公開すると専用の `studio-content.json` を更新 | 稼働中の本番リビジョンとGeminiモデル、キー所属・料金、教員認証。本文マスター・シート下書き・英作文生成はこの経路に未接続 |
| PR #77 | 本文マスター候補の読み取り・並べ替え、英作文の物語・指定語・出典検証、候補変換、テスト用Apps Scriptと追記・再開。後半に別Cloud Run・専用プロジェクトの試行計画 | 実AI生成の完了、実シートの列、既存下書き・同期の接続は未確認。専用環境一式を現行サービスに取り込まない |
| 現行Apps Script | Q&A・英作文・AI発展教材等に公開用の検証／同期コードがある | 本番シートの読み取り権限、実ヘッダー、稼働中のスクリプト、公開状態の判定と出力先を読み取りで照合する |

対象の本番シートIDは `1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU` です。最初の試行ではアクセスしません。

## 過去の503とキー所属

PR #77のTEST03は、Gemini上流のHTTP 503／`UNAVAILABLE` が約3秒で返り、回答候補0件でした。タイムアウトや作文の検証失敗には到達していません。TEST01も上流503という報告があります。上流503の原因や、実際に使われたキーの所属プロジェクトと課金は確定していません。TEST系のSecret参照と、現行スタジオの `STUDIO_GEMINI_API_KEY` は別々に確認します。Cloud RunやSecretの所属だけではキーの所属は分かりません。

[TEST03の記録](https://github.com/f9-fish/Yoshi.Lab/blob/867fffa8bc7de204780d7ebea66d9e1597a82ec6/material-generation/ops/test03/INCIDENT.md) · [503とキー所属の追加調査](https://github.com/f9-fish/Yoshi.Lab/blob/867fffa8bc7de204780d7ebea66d9e1597a82ec6/material-generation/ops/research-503-20261112/README.md)

## 最初の1回に向けたCloud Shellでの読み取り確認

学校の承認済みアカウントで参照します。構成照会はSecretの値を読まず、出力もモデルと確認結果に絞ります。既存Cloud RunやAPIの設定は変更しません。

```sh
git clone --branch feat/ai-material-generation-restart https://github.com/f9-fish/Yoshi.Lab.git yoshi-ai-restart
cd yoshi-ai-restart
node scripts/studio-generation-preflight.cjs
```

- `configurationMatches: true` は、コードが想定するURLと単一の稼働リビジョン、明示されたモデル、Secretの参照、Pagesオリジンを確認できたという結果です。キー自体、教員認証、課金、Geminiの成功は個別に確認します。URLが一致しない場合や複数リビジョンに分散している場合は、実行前に管理者が対象を確認してください。
- キーを作成した記録を管理者が確認し、Secretに登録したキーとプロジェクトの対応が取れた場合だけ、秘密値を使わずに `node scripts/studio-generation-preflight.cjs --confirmed-key-project <確認済みID>` を実行します。照会するのは該当プロジェクトのAPI有効状態と請求設定です。請求有効フラグは無料枠の残量や単価を示しません。
- 実モデルの [Gemini API料金](https://ai.google.dev/gemini-api/docs/pricing) と利用枠、試行の許可を事前確認します。本リポジトリの実装では生成が既存 `studioQuota` の回数を消費し、最大出力設定は8192トークンです。稼働リビジョンの設定が一致するかも確認します。

## 承認後の初回実生成

`node scripts/studio-generation-preflight.cjs --fixture` で架空の英文と設定を確認し、[既存の教員スタジオ](https://f9-fish.github.io/Yoshi.Lab/teacher-studio.html) に確認済みGoogle教員アカウントでログインします。科目「英C」、Lesson「AI-SMOKE」、Part「1」、各種類「2」、JSONの `source` を本文に入力し、**生成を1回だけ**実行します。公開ボタンは使いません。

| 観測 | 判定 |
| --- | --- |
| 5種類に各2問、合計10問が画面に表示され、教員が本文根拠・重複・正解を確認 | 初回の実AI生成成功 |
| HTTP成功でも10問未満または内容不適合 | 初回目標は未達。稼働プロンプトは各種類の上限を指定するため、不足を別生成で埋めない |
| 401/403 | Firebase認証・教員権限・許可オリジンまたは上流認証を応答の出所ごとに確認 |
| 上流503、429、タイムアウト | 時刻、モデル、リビジョン、HTTP状態だけを控え、再送やモデル切替の前に確認 |

最初の10問は現行の5種類の接続確認です。英作文の物語生成は別の品質確認が必要です。架空の例文、ローカルの結果、テスト用の応答を実生成済みとして扱いません。

## 実生成成功後

1. 既存のテスト用スプレッドシートで、管理者が本文マスター・候補／下書き・公開判定のヘッダーと挙動を読み取りで照合します。PR #77の本文組み立てと英作文の検証、必要な種類の変換処理だけを再利用します。
2. 同じ教員が下書き確認できる状態で、明示承認後のテスト追記だけを実装します。稼働 `studioApi` の教員認証を利用できる構成を優先し、テストのための公開や新規プロジェクトは不要です。
3. 本文マスターと実同期をつなぐ前に、未承認行が公開されないこと、既存教材の更新と競合しないことをテスト環境で確認します。本番用の列マッピングや公開操作は別承認です。
