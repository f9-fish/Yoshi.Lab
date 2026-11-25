# SEASON 2 教員向けプレビュー

教員ダッシュボードの「SEASON 2 開幕イベントをプレビュー」から開きます。プレビュー先は `teacher-season2-preview.html` です。ログイン状態の共有には同じオリジンを使います。直接開いた場合も、確認済みGoogleログインと `teacherUids/{uid} === true` の確認が必要です。

- 最初に2026年11月28日 00:00 JSTの開幕モーダルが表示されます。閉じるボタンかEscで閉じ、画面下の「教員用プレビュー操作」から何度でも再生できます。モーダル内からパネルを開くと、表示中の状態も変更できます。
- 同じパネルのシーズン表示、バッジ、順位、XP、学習日数を変更すると、バナー・モーダル・記録カードに反映されます。順位4〜10を個別に試す場合は「Radiant 4〜10位」を選んで順位を入力します。
- 「記録バッジを見る」はデモの記録カードへ、「シーズン2を始める」は科目選択へ移動します。通常ページへのリンクと「通常画面に戻る」は、それぞれプレビューを終了します。

プレビューは専用の読み取り専用エントリーから動作します。実ホームの静的HTMLからロゴと科目情報を取得し、表示用の要素だけを組み立てます。通常ホームのアプリスクリプト、`account.js`、XP同期やシーズン確定処理を起動しません。RTDBの接続が失われた場合、教員権限が変わった場合、権限の取得に失敗した場合はプレビューを閉じます。ダミー値はタブ内のメモリーにのみ保持します。Firebase Rulesの変更は不要です。

## インストール不要の確認方法

| 方式 | 判定 |
| --- | --- |
| Firebase Hosting プレビューチャネル | 配信URL自体が公開され、HTMLやJSの取得を教員だけに制限できません。 |
| 既存の非公開HTTPSホスト | 利用可能なら追加リソースが最少です。現時点で利用できるホストは確認できていません。 |
| 既存の教材用 Cloud Run | 用途と権限が異なります。既存サービスは維持します。 |
| Cloud Run の専用サービス＋直接 IAP | 推奨。学校PCとスマートフォンはHTTPS URLを開くだけです。IAPのGoogle認証で素材まで保護し、既存FirebaseのGoogle認証と教員UIDも照合します。 |

### 承認後に管理者が一度行うこと

1. 既存Google Cloudプロジェクトで、小規模な専用Cloud Runサービスの作成と直接IAPの利用を承認します。最小インスタンス数は0、上限は1を目安にします。Cloud Run・ビルド・イメージ保管の課金可能性を確認し、ロードバランサや新しいFirebaseプロジェクトは用意しません。
2. PR #90の `Dockerfile.teacher-preview` のイメージを専用サービスに配信し、**直接IAP**を有効にします。IAPのアクセス許可は指定の教員アカウント一人に付与します。全ユーザー公開の権限は使いません。配信サービスアカウントにFirebase管理権限は付与しません。
3. サービスのHTTPSオリジンを `PREVIEW_ORIGIN`、IAPの対象サービスを `IAP_AUDIENCE`（`/projects/<PROJECT_NUMBER>/locations/<REGION>/services/<SERVICE>`）、指定の教員メールを `PREVIEW_TEACHER_EMAIL` に設定します。配信側もIAPの署名・対象・有効期限・メールを検証します。未認証の別ブラウザからページとJSを取得できないことを確認します。
4. Firebase Authenticationの承認済みドメインで、Cloud Runのホスト名を確認します。未登録の場合のみ、別途承認を得てそのホスト名を追加します。教員に `https://<Cloud Runのホスト>/teacher-season2-preview.html` を渡します。最初のIAP画面と、プレビュー画面内のGoogleログインで同じ教員アカウントを選びます。

確認期間が終わったら管理者が専用サービスと不要になった許可ドメインを整理します。本番のPages、Rules、RTDBデータはこの手順の対象外です。

## クラウドを追加せず、教員のPCで操作する

Firebase Consoleの **Authentication → Settings → Authorized domains** で `localhost` を確認します。参照権限があれば設定を変更せず確認できます。手元でIdentity Toolkitに接続できる場合は、PR #90のブランチで次の照会でも確認できます。

```sh
node scripts/check-teacher-preview-domain.mjs https://localhost:8443
```

照会エラーの場合はFirebase Consoleで確認してください。未登録の場合は、追加を承認できる管理者がいる場合に限り、Authenticationの許可ドメインに `localhost` を追加します。既存のGoogleログインと教員UIDを使用します。

1. Node.js 24と `mkcert` が使える教員のPCで、このブランチを取得するかプレビュー配布ZIPを展開します。
2. 取得したディレクトリで、PCが信頼するlocalhost用の証明書を作り、HTTPSサーバーを起動します。証明書の秘密鍵はPCの外へ共有しないでください。

   ```sh
   mkcert -install
   mkcert -cert-file localhost.pem -key-file localhost-key.pem localhost
   node scripts/serve-teacher-preview.mjs --local localhost.pem localhost-key.pem
   ```

3. 同じPCのChromeまたはEdgeで **https://localhost:8443/teacher-season2-preview.html** を開きます。ブラウザのダイアログでユーザー名 `preview` とターミナルに出た今回限りのパスワードを入力し、画面のGoogleログインから教員アカウントを選びます。ログインのポップアップを許可してください。
4. 終了するときはターミナルで Ctrl+C を押します。もう一度起動すると端末認証のパスワードは変わります。

サーバーは `127.0.0.1` のみで待ち受け、HTTPSと端末認証の後にページ・素材を配信します。その後にアプリがFirebaseで教員権限を確認します。ローカル配信時のFirebaseセッションはタブのメモリーだけに保持し、ページを再読み込みするとGoogleログインを求めます。学習用リンクを選ぶと通常の本番サイトへ移動し、プレビューを終了します。

## スマートフォンとPCで同じURLを開く場合

学校の既存の非公開HTTPSホストが利用できる場合は、同じサーバーをそのホストで動かせます。公開URLのホスト名をAuthenticationの許可ドメインで確認します。学校側のアクセス制限に加えて、サーバーの認証を設定します。配信先は `/teacher-season2-preview.html` です。

環境変数は `PREVIEW_ORIGIN`（外部から見えるHTTPSオリジン）、`PREVIEW_TLS_CERT`、`PREVIEW_TLS_KEY`、`PREVIEW_PASSWORD_SHA256` です。パスワードには32バイトのランダム値をbase64urlで表した43文字を使い、そのSHA-256（小文字16進）だけをサーバーに設定します。必要に応じて `PREVIEW_BIND` と `PREVIEW_PORT` を指定します。リバースプロキシを経由する場合は元の `Host` と `Authorization` を保持し、認証ヘッダーをログに残さない設定にします。クラウドやネットワーク構成の変更が必要な場合は管理者の承認を取ります。

Chromiumの自動検証では、Googleアカウントと教員フラグを架空のSDK応答で再現します。本番の認証・RTDBに接続せず、操作を再現して320px・390px・768px・1280pxの画面を保存できます。

```sh
node --test --test-isolation=none tests/teacher-season-preview.test.cjs
CHROME_BIN=chromium PREVIEW_SCREENSHOTS=/tmp/yoshi-season2-preview node tests/browser/teacher-season-preview.cjs
```

Issue #86の紋章とランク表記は `season-achievements-ui.js` から再利用しています。金の翼などの演出は開幕イベントのスタイルです。モーダル・バナー・成績表示の描画は教員認証の処理から独立しています。
