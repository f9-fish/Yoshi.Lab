# AI教材スタジオ：段階的実装と安全条件
## 目的
教員が本文・Lesson・Partを一度入力し、AIが「単語・熟語 / 文法・穴埋め / 本文Q&A / True / False / Discussion」を一括生成する。教員が修正・採否を確認した後に一括公開し、既存Yoshi.Labへ反映する。

## 追加した画面
- `teacher-studio.html` は**実装途中の管理画面**。認証済み教員のみ入力領域を表示し、ブラウザ内の下書き保存・編集・採用を扱う。
- APIが未設定なら生成・公開は失敗を明示する。**現時点でAI自動生成・公開は動かない**。本番への導線は未追加。
- API URLは配信HTMLの `<head>` に `<meta name="yoshilab-studio-api" content="https://...">` を設定する予定。設定値は公開してよいHTTPSのエンドポイントのみ。
- クライアントはFirebaseのIDトークンを `Authorization: Bearer` として送る。教員であるかを**サーバー側でも再検証**する必要がある。

## バックエンド必須要件（未実装）
1. Firebase Admin SDKでIDトークンを検証し、Realtime Databaseの `teacherUids/{uid} === true` を読み取る。ログイン中の教員判定のみでは許可しない。Firebase Rulesの監査も別途必須。
2. `POST /generate` は認証・サイズ制限・レート制限後、サーバー秘密情報のGemini APIキーを用い、下記形式のJSONを返す（APIキーをブラウザやGitHubに置かない）。
3. `POST /publish` は再認証・スキーマ検証・二重登録チェック・対象教科/単元の整合性確認をする。GitHubトークンはサーバーのSecret Managerに保存する。
4. 既存の `lessons.json`, `vocabulary.json`, `ronpyo_text.json`, `ronpyo_vocab.json` の仕様を維持する。既存の英C・論表の単元ID/Partと教材の共存ルールを確認し、上書き対象を事前に教員へ表示する。**5種類すべてが現状の学習画面で利用可能とは未確認**なので、QA/TF/Discussionの格納先と表示画面も実装・テストする。
5. GitHubに対しては最新SHAで楽観ロックを行い、可能なら1回のコミットで対象ファイルを更新する。途中失敗で一部だけ公開しない。公開履歴と復元可能なコミットSHAを残す。
6. 授業本文を外部生成AIに送ることについて学校の運用・ライセンス条件を確認する。生徒氏名等の個人情報は入力不可とし、サーバーにも長期保存しない。
7. 「公開完了」はGithubへの変更が成功した時点と、配信サイトに反映された時点を区別して表示する。キャッシュ更新・CDN反映を確認するまで即時反映と断言しない。
8. Apps Script/スプレッドシート同期が後からJSONを上書きしないよう、教材データの正本を一本化するか衝突検出を設ける。

## API契約（クライアントの暫定インターフェース）
POST /generate:
```json
{"subject":"英C","lesson":"8","part":"1","source":"English text","count":4}
```
Response:
```json
{"questions":{"vocabulary":[{"question":"word","answer":"意味","translation":"補足"}],"cloze":[],"qa":[],"trueFalse":[],"discussion":[]}}
```
他の種別もすべて配列で返すこと。各要素は question / answer / translation の文字列。AIの出力は正答保証ではない。

POST /publish: 上記入力に `questions`（5種別・採用済みのみ）を追加して送る。正常時は `{"url":"https://..."}` を返す。失敗時は非200 + `{"error":"説明"}` とする。

## 次の実装
- Cloud Functionsなどサーバーの配置方法・Secret管理を決め、上記2 APIを実装。
- 5種類の出題形式と既存画面の対応を確定。穴埋めは既存の括弧表現、単語は `word/meaning/hint/reading` へ正規化し、日本語訳等を破壊しない。
- 新規/既存単元のプレビュー、差分確認、重複検査、ロールバックを実装。
- モックFirebase/Gemini/GitHubによる検証・スマホUIを含むテストを追加。セキュリティ設定確認後にのみ管理画面に正式導線を追加。
