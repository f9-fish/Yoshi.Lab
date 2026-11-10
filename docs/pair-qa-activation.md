# 本文Q&A：提供Rulesへの統合と利用開始までの手順

2026年11月10日にユーザーが提供したRulesを確認しました。提供内容には`pairQaSpark`がなく、ルートは読み書き拒否です。このままではSpark版Q&Aの通信は許可されません。Firebase Consoleの現在の公開Rulesと同一かをこちらから取得・確認したものではありません。

## 作成した全体版

`firebase-rtdb.rules.qa-integrated.json` がコピー用の全体版です。既存の `rooms`・`learningRecords`・`studentProfiles`・`teacherUids`・`leaderboard`・`lastAccess`・`studentGrades` およびルートの拒否をそのまま残し、兄弟として `pairQaSpark` だけを追加しました。既存Rulesの弱点を今回まとめて修正したものではありません。

提供された元Rulesは `tests/fixtures/rtdb-rules-user-provided.json` に保存しました。統合前後の全既存ルールが同一であることを自動テストで確認します。生成コマンドは次のとおりです。ネットワーク接続・デプロイはしません。

```sh
node scripts/merge-pair-qa-spark-rules.cjs tests/fixtures/rtdb-rules-user-provided.json firebase-rtdb.rules.qa-integrated.json
```

## 残っている手順

1. 現在公開中のRulesをConsoleからバックアップし、提供した元Rulesと変わっていないか確認します。変わっている場合はこの全体版で置換せず、新しいRulesへ再統合してください。
2. `npm ci --prefix tests/pair-qa-rules --ignore-scripts`、`npm test --prefix tests/pair-qa-rules` で、統合版のRulesテストを実行します。テストは `demo-yoshi-pair-qa` のローカルエミュレーターだけを使用します。本番プロジェクトへ向けないでください。
3. Firebase Console → Realtime Database → ルールに統合版を貼り付け、構文エラーを確認します。公開前に、検証環境でもA/B・第三者・未認証のアクセス制限を確認します。
4. 検証完了後に管理者がRulesを公開します。こちらは本番Rulesを変更しません。Authenticationの匿名認証も確認します。App Check強制がある場合は既存設定に合わせた別途対応が必要です。強制を解除して通す方法は取りません。
5. Rules適用後にアプリの `pair-qa-config.js` の `enabled` を `true` にする変更を反映します。`backend:'spark'`を維持します。コード変更のPRマージ・サイト公開は別の手順です。ブラウザーを再読み込みし、英C → 本文Q&A → Lesson 7でPart 1・2・3・PUSを確認します。
6. 別々の端末で参加・交代・ヒント・○×・再接続を確認します。問題発生時はまず `enabled:false` に戻し、既存の学習データを削除しないでください。

## 今回の検証と制約

既存344件に統合確認3件を追加し、347件成功、失敗0・スキップ0。統合した既存ルールは全項目が元データと一致します。アプリのデザイン・教材・XP・Daily・ランキング・既存ペア実装は変更していません。

Rules実テスト10件は引き続き未実行です。このCodex環境は公式エミュレーターの取得先 `storage.googleapis.com` を拒否しており、403 Domain forbiddenで止まります。通信設定が変わっていないことを確認しました。Rulesの構文や実際の拒否動作を検証済みとは扱いません。Consoleでの構文チェックもこちらから実行していません。

ユーザーからのRules書き換え報告と利用開始指示を受け、作業ブランチでアプリを `enabled:true, backend:'spark'` に変更しました。これは本番サイトへの反映完了や、本番Rulesの公開・動作を確認したことを意味しません。ルールが未公開・未適用の場合、ルーム作成時にpermission-deniedとなります。Rules実テスト未実行の制約は残ります。

有効化変更後の自動テストは348件成功、失敗0・スキップ0。ブラウザーテストは固定の有効化モックではなく、実際の `pair-qa-config.js` を読み込み、外部通信を遮断して検証します。

公開JSONの直接閲覧や改造ホストの教材差し替えなど、Spark方式の制約は `docs/pair-text-qa-spark.md` を参照してください。
