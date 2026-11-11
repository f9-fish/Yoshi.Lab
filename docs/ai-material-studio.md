# AI教材スタジオ（実装状況：2026-11-11）

## 目的
教員が本文、科目、Lesson、Partを入力し、AIが教材5種別を生成。教員が問題文・正解・日本語訳を編集し採用したものを一括公開して、既存アプリで利用できる状態にする。

## 実装済み（このPRのコード）
- `teacher-studio.html`: Firebaseログイン状態と教員権限確認、本文入力、5種別生成APIとの通信、問題編集/採用、ローカル下書き、公開前確認
- `functions/studio-api.js`: Firebase Admin IDトークン検証、`teacherUids` のサーバー側認可、Origin制限、操作間隔制限、Gemini API生成、GitHubへの複数ファイル一括コミット
- `functions/studio-core.js`: 問題バリデーション、重複検出、既存教材JSONとの互換変換
- `studio-practice.html`: 本文Q&A、True/False、Discussionの単元選択と回答表示
- `studio-materials.json`: 新しい3種別のデータ保存先
- `firebase.json`, `.firebaserc`, `functions/.env.example`: Cloud Functions設定雛形

## 運用上の制約
- **Firebase Functionsは未デプロイ。Gemini APIキー・GitHubトークンは未設定。このPRをマージするだけでは生成・公開は動作しない。**
- 本番FirebaseのSecurity Rulesと学校の教材送信ルールは未確認。APIはサーバー側で教師権限を再検証するが、Rules全体の監査を代替しない。
- 既存の単語・穴埋めは対応する教材JSONへ変換して従来の学習画面で利用する。
- 本文Q&A・True/False・Discussionは `studio-materials.json` に保存し、独立した `studio-practice.html` で利用する。**この3種別ではXP・学習履歴を保存しない**。
- 同じ科目・Lesson・Partの採用済みカテゴリは新しい内容に上書きする。他の単元は維持する。カテゴリが0件なら既存教材を維持する（QA/TF/Discussionは一括の追加教材グループとして上書きされる）。
- GitHubの更新が成功してもホスティング上の配信反映は別途確認が必要。Apps Scriptによる既存JSON同期が公開を上書きしないよう移行が必要。
- `teacher-studio.html` はAPIのURLを `https://asia-northeast1-yoshi-lab-db3eb.cloudfunctions.net/studioApi` に設定済み。Firebase Functionsデプロイ時にURLを照合する。

## データ形式
`POST /generate`:
```json
{"subject":"英C","lesson":"8","part":"1","source":"She went to school.","count":4}
```
返却:
```json
{"questions":{"vocabulary":[{"question":"school","answer":"学校","translation":"スクール"}],"cloze":[{"question":"She ( went ) to school.","answer":"She went to school.","translation":"彼女は学校へ行きました。"}],"qa":[],"trueFalse":[],"discussion":[]}}
```
- vocabulary: question = 英語、answer = 日本語の意味、translation = カタカナ読み。
- cloze: question = 既存Yoshi.Labの `( answer )` 形式、answer = 括弧なし完全英文、translation = 日本語訳。
- qa: 英語の質問・英語の答え・日本語訳。
- trueFalse: 英語の正誤文・`True` または `False`・日本語訳と解説。
- discussion: 英語の自由意見質問・英語の模範解答例・日本語訳。

`POST /publish`: 生成の入力と採用済み `questions` をすべて含めて送信する。Firebase IDトークンで教員認証を行う。成功時はGitHubコミットURL・変更件数を返す。

## デプロイ
`docs/ai-studio-deployment.md` を参照。安全確認と管理者の明示的な判断を終えてから実施する。
