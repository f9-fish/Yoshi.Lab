# Yoshi.Lab AI教材スタジオ

## 目標
先生が英語本文・科目・Lesson・Partを入力すると、Gemini が5種類の練習問題を生成。先生が採否・内容を確認し、公開ボタンを押すと、GitHub上の `studio-content.json` に一括保存。生徒は `studio-study.html` で各教材を学習する。

## 実装済み（PR内・本番未反映）
- `teacher-studio.html`：Firebaseログイン・教員権限確認、教材入力、AI生成、5種類の問題編集、採用チェック、ブラウザへの下書き保存、サーバーでの差分プレビュー、公開確認、API通信。
- `studio-functions/index.js`：Firebase IDトークンと`teacherUids/{uid} === true`の**サーバー側の**検証。Gemini生成、構造化JSONバリデーション、GitHubのSHA競合防止、`studio-content.json`へのコミット。
- `studio-functions/studio-core.cjs`：教材形式検証、必須項目・重複確認、単元キーの突合。
- `studio-study.html`：単語、穴埋め、本文Q&A、True/False、Discussionの演習画面。英C・論表、Lesson・Part選択に対応。
- `studio-content.json`：AI生成教材専用データ。既存の4種類のJSONとは独立し、Apps Script同期が上書きしない。
- `studio-config.js`：公開API URL設定（**まだ空欄**）。
- `studio-functions/tests/studio-core.test.cjs`：形式、重複、入力値等の単体テスト。
- `.github/workflows/studio-check.yml`：上記テスト・サーバー構文検証のGitHub Actions。
- `index.html`：ホームメニューのAI教材リンクのみ追加。

**重要:** 本番公開はまだ実施していない。GitHub PRがマージされてもFirebase Functionsは自動ではデプロイされない。デプロイ・Secret設定・本番権限監査が終わるまで「生成」「公開」は使用できない。

## 一度限りのFirebase側準備（管理者が実施）
1. Firebase/Google Cloudの同一プロジェクト `yoshi-lab-db3eb` を確認。Firebase Functions第2世代とSecret Managerを利用できる課金・権限を用意。
2. このリポジトリをPC上にチェックアウトし、`studio-functions` 内で `npm install` を実行する。既存のアプリには依存を追加しない。
3. Gemini APIキーを入手し、`firebase functions:secrets:set STUDIO_GEMINI_API_KEY --project yoshi-lab-db3eb --config studio.firebase.json`で登録（コマンド実行時の入力欄に設定）。**チャットやGitHubに貼り付けない**。
4. GitHubの`f9-fish/Yoshi.Lab`の`studio-content.json`に書き込み可能な、必要最小限の権限を持つFine-grained tokenを発行する。GitHub側は Contents: Read/Write のみ。これを `firebase functions:secrets:set STUDIO_GITHUB_TOKEN --project yoshi-lab-db3eb --config studio.firebase.json`で登録。
5. `studio-functions/.env` に、実際にアクセスするアプリのHTTPSオリジンだけを `STUDIO_ALLOWED_ORIGINS=https://<本番のオリジン>` の形で指定する。**ファイルをGitHubにコミットしない**。モデルを変更する場合のみ `STUDIO_GEMINI_MODEL=...` も指定する。
6. `firebase deploy --only functions:ai-studio --config studio.firebase.json --project yoshi-lab-db3eb` でFunctionsを公開。出力された `studioApi` のURLを控える。
7. `studio-config.js` の `window.YoshiStudioApiBase` にそのURL（末尾`/studioApi`まで）を設定し、通常のPR・マージと配信を経て反映する。
8. `teacherUids/{uid}` の教員権限とSecurity Rulesを点検。教員以外でGenerate/Preview/Publishが403になることを実機テストする。
9. 学校での外部生成AI利用・教科書本文の送信可否を必ず確認し、許可されてから授業本文を入力する。

**注意:** 上記デプロイ手順はこのリポジトリに対応する設計上の手順。外部プロジェクト環境・課金・権限・実際のHosting URLはこのPRから確認できないため、未検証。Firebase CLIのバージョンに応じて必要な初期設定を行うこと。生成APIの利用には料金が発生する場合がある。

## 処理・公開ルール
- `POST /generate`：教員認証後にGeminiを呼び出し、`questions` を返す。生成結果は公開されない。教員UIDごとに1時間5回までの上限をサーバー側で適用する（Firebase RTDBの`studioQuota/`に計数用の最小データを保存）。
- `POST /preview`：同じLesson・PartのAI教材があるかと、公開対象の問数・ファイルSHAを返す。
- `POST /publish`：確認時のSHAを必須とし、一致しない場合は409。採用済みの問題を単元ごとに置換して1ファイル・1コミットで更新する。過去のコミットから復元可能。教員UIDごとに24時間20回の上限を適用。
- 教科書本文自体や個人情報を `studio-content.json` に保存しない。公開には採用した設問・解答・解説を保存する。
- 既存の`lessons.json` / `vocabulary.json` / `ronpyo_text.json` / `ronpyo_vocab.json` へは書き込まない。XP・Daily・ランキング・既存の通常学習への変更はしない。
- True/False以外の自由記述は自己採点（解答例表示）であり、AIの正誤判定やXPの付与はしない。
- GitHubに保存した時点とPagesに反映された時点は異なる。ブラウザで再読み込みして確認する。

## API構造
入力:
```json
{"subject":"英C","lesson":"8","part":"1","source":"I visited Kyoto.","count":4}
```
生成結果:
```json
{"questions":{"vocabulary":[{"question":"visited","answer":"訪れた","translation":"visitの過去形"}],"cloze":[{"question":"I (visited) Kyoto.","answer":"私は京都を訪れた。","translation":"過去形"}],"qa":[{"question":"Where did I go?","answer":"Kyoto.","translation":"私はどこへ行きましたか？"}],"trueFalse":[{"question":"I visited Kyoto.","answer":"True","translation":"私は京都を訪れた。本文と一致"}],"discussion":[{"question":"Where do you want to go?","answer":"I want to go to Kyoto.","translation":"どこへ行きたいですか？"}]}}
```
Publishでは同一入力に`questions`と`expectedSha`を含める。ログや画面にトークン・Secretを表示しない。

## デプロイ前の重要な注意事項
- 生成5回/時、公開20回/日の利用回数制限はUIDごとの技術的な上限。費用の予算上限ではないため、Google Cloudの課金アラートも設定する。
- `STUDIO_ALLOWED_ORIGINS` を正確なGitHub Pages本番オリジンに設定する。未設定ならブラウザからのクロスオリジン通信は拒否される。APIのURLだけでアクセスを防げる設計ではなく、**毎回Firebase IDトークンと教員UIDを再検証**する。
- GitHub Pagesがデプロイされた先がHTTPSで配信されること、およびFunctionsの呼び出し先URLの末尾・ルートが `/generate`, `/preview`, `/publish` に到達することを実環境で確認する。
- Functionsは第2世代の公開HTTPSエンドポイントなので、アクセス制御はサーバー側で実施する。事前の校内利用許可が必要。

## 本番運用に向けた残課題
- 現在の関数・UIの実環境テストとFirebase Security Rulesの監査。
- Gemini生成の品質・教材日本語訳・曖昧な正答の教員確認。
- APIアクセス量の上限・監査ログ・費用アラートの運用設計。
- 学校からの教科書本文送信許可と著作権・データ取り扱い確認。
- 利用実績を踏まえ、必要なら生徒用AI教材にもXPや学習履歴を接続（今回は対象外）。
