# 英検・単語帳XP（V3）

新規開始した英検は準2級・2級とも正解1問7 XPです（最大10問＝70 XP）。単語帳は次の通りです。

|Stage|4択|スペリング|並び替え|
|---|---:|---:|---:|
|0|1|3|10|
|1・2|3|6|10|
|3|5|8|10|

## 保存と互換性

- `xpPolicyV3: true` の新規記録だけに適用します。新規英検はV3を保存し、過去V2の準2級5・2級10、より古い英検5または旧vocab1、通常学習の旧倍率・上限、端末内の旧未保存セッションは保持します。
- 単語帳はGoogleログイン済みで開始したセットだけ、完了・途中終了時に解答済み分を保存します。ゲスト・未解答は保存しません。通常学習とは別モードで、単語帳の5回目以降も正解分を加算します。
- 通常学習の1〜4回目／5回目以降の条件、Daily・週間ボーナス、ランク閾値は維持します。
- 累計・週間・シーズン・過去シーズン・教員画面は共通 `practice-xp.js` のV3計算を参照します。MY PAGEでは単語帳の履歴も選択できます。
- `learningRecords/{uid}/wordbook_{sessionId}` へトランザクションで書き込み、同一セットIDの再送・応答消失で二重加算しません。スコア・範囲・形式が違う同一IDは拒否します。通信失敗は同じ結果のまま再試行し、ページ更新後も開始時のアカウントで復元できます。プロフィール未登録は記録済み・XP反映待ちとして表示します。
- 既存のGoogle認証を再利用します。リポジトリにあるユーザー提供RulesのlearningRecords検証は基本項目とスコア範囲を要求し、今回の形もそれを満たします。Rulesの変更は行っていません。現在本番で公開中のRules、実Googleログイン、実保存・同期は検証していません。

## 変更ファイル

- `practice-xp.js`、`account.js`：新倍率・互換性・単語帳の冪等保存。
- `wordbook.html/js/css`：ログイン案内、倍率、獲得XP、保存・再試行・復元。
- `eiken-training.js`、`eiken.js`、`eiken.html`：新規7 XPと旧セッション復元、ポップアップ表示。
- `teacher.html`、`ranking.html`、`mypage.html`、`index.html`：集計・履歴・倍率表示。
- `tests/practice-xp-v3.test.cjs`、`tests/eiken.test.cjs`、`tests/helpers/app-harness.cjs`：各画面の一致・旧率・再送・検証。
- `tests/wordbook-browser.py`、`tests/eiken-xp-browser.py`：本番通信を遮断した画面・保存フロー検証。
- `AGENTS.md`、`docs/wordbook-training.md`、この文書：新旧仕様と手順。

## 検証

```sh
node --test --test-isolation=none tests/*.test.cjs
python tests/wordbook-browser.py
python tests/eiken-xp-browser.py
```

Node：406件中405件成功、1件失敗、スキップ0。失敗は `QA JSON: initial public files and server snapshot agree without inventing sheet data`。main `e658d56d` から対象ファイルだけを一時ディレクトリへ展開して再実行し、同じ失敗を確認しています。公開 `pair_text_qa.json` の質問文ヒントと、Cloud Functions用 `pair-qa-functions/data/questions.json` の従来ヒントが不一致です。このタスクではQ&A教材・スナップショットを変更せず、失敗を残して報告します。

単語帳ブラウザー：320/390/1280pxの全Stage・範囲選択・3形式・倍率・途中終了保存、ゲスト、未解答、応答消失→ページ更新→復元、アカウント変更、同期失敗再試行、プロフィール未登録を確認。外部通信は遮断し、Firebase APIはローカルのモックです。

英検ブラウザー：320/390/1280px、両級の10問正解70 XPと獲得ポップアップをモックで確認済みです。

## 手動確認

変更は専用ブランチで提案し、mainへのマージ・本番デプロイは行いません。反映後は学校Googleアカウントとプロフィール登録済みの利用者で、新規セッションの保存、HOME・MY PAGE・ランキング・教員画面のXP一致を確認してください。既存記録の再計算で過去倍率が変わらないことも確認項目です。
