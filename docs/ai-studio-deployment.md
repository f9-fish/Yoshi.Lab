# AI教材スタジオ：デプロイ手順（管理者向け）
**このPRをマージしてもAPIは自動デプロイされません。** 本番のSecretsとFunctionsを設定する必要があります。

## 1. 事前確認
- Firebaseプロジェクト `yoshi-lab-db3eb` の管理権限と、Cloud Functions v2/Secret Manager/Cloud Build/Artifact Registryに必要な利用プラン・課金設定を確認する。
- GitHub公開先 `f9-fish/Yoshi.Lab` の教材JSONを更新する権限を持つ**最小権限のトークン**を取得。Fine-grained PATの対象リポジトリ限定、Contents: Read and write。秘密値はチャットやGitHubに貼らない。
- Gemini APIキーを作成し、利用するモデル・利用規約・課金枠を確認。教科書本文の外部AI送信について学校の方針と権利処理を確認する。
- **Googleアカウントの教員UIDがRealtime Databaseの `teacherUids/{uid}=true` に登録されていること**、Firebase Security Rulesが必要な範囲だけを許可していることを確認する。
- 公開サイトの **Origin**（URLの `https://ホスト名` まで）を特定する。GitHub Pagesなら `https://f9-fish.github.io` の可能性があるが、必ず実際のブラウザURLを確認。

## 2. ローカルでテスト
Node.js 22 と Firebase CLI が必要。
```bash
node --test --test-isolation=none tests/*.test.cjs
cd functions
npm install
npm test
cd ..
```
既存のアプリのテストと新APIの純粋処理テストを分けて実行する。

## 3. Functionsの環境変数
```bash
cp functions/.env.example functions/.env
```
`functions/.env` の `STUDIO_ALLOWED_ORIGINS` を実際に確認した公開サイトのOriginに修正する。カスタムドメインを使う場合は対応するOriginをカンマ区切りで列挙する。httpsのみ許可する。
`STUDIO_GITHUB_REPOSITORY`・`STUDIO_GITHUB_BRANCH`を確認する。ブランチは通常 `main` で、公開ボタンが直接mainにコミットする構成である。ブランチ保護が有効な場合は失敗する。

## 4. 秘密情報とデプロイ
```bash
firebase login
firebase use yoshi-lab-db3eb
firebase functions:secrets:set STUDIO_GEMINI_API_KEY
firebase functions:secrets:set STUDIO_GITHUB_TOKEN
firebase deploy --only functions:studioApi --project yoshi-lab-db3eb
```
Secret設定のプロンプトに値を貼る（**リポジトリのファイルには書かない**）。デプロイが表示するURLと、`teacher-studio.html` 内のmeta `yoshilab-studio-api` のURLが一致するかを確認する。

## 5. 安全な初回テスト
1. 未ログイン・生徒アカウントで管理画面が操作できないこと、同じIDトークンでAPIへPOSTしても403で拒否されることを確認。
2. 教員アカウントで**著作権や個人情報に問題のない短いオリジナル英文**から生成して、5種類の正答・日本語訳を確認する。
3. まず `STUDIO_GITHUB_BRANCH` を試験用ブランチに設定し、公開結果を目視確認。テストのため本番JSONや本番Firebaseの学習履歴を書き換えない。
4. `lessons.json`, `vocabulary.json`, `ronpyo_text.json`, `ronpyo_vocab.json`, `studio-materials.json` の整合性とスマホ画面を検証。
5. 本番mainへ変更する前に、Apps Scriptなど他の教材同期が同じJSONを上書きしない運用へ切り替える。**GitHub Pagesの配信更新には時間差があり、GitHubコミット=即時配信ではない。**

## 注意事項
- APIは教員IDトークンとデータベースの教員UIDをサーバー側で検証する。クライアントのみの判定に依存しない。
- 単元・Partが同一のデータは**上書き**される。初回利用時は新規のLesson・Partを使うことを推奨。
- 公開ボタンの成功はGitHubのコミット成功を意味する。配信反映は実サイトで確認する。
- 「AI教材プラス」の3種別は現時点ではXP・学習履歴と連動せず、通常の単語・穴埋めは既存アプリに読み込まれる。
- Firebase Hosting用設定やApps Scriptの本体はリポジトリで確認できないため、配信環境の仕様に合わせて追加確認が必要。
