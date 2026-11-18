# 問題のお気に入り

☆を選ぶと、確認済みGoogleアカウントのUID配下に問題の参照を保存します。お気に入りページでは科目と問題形式を絞り込み、1問ずつ、または表示中の問題を連続で復習できます。復習は学習記録・Dailyの挑戦回数・XPを更新しません。

## 問題の参照

- Firebase Realtime Database には `questionFavorites/<UID>/<問題キー>: true` だけを保存します。端末は同じUIDの一覧を購読し、問題文や解答は現在の公開教材から再取得します。
- 英検・単語帳・英作文・Reading Plus・ペア本文Q&Aは、公開教材の既存IDを使います。キーには教材ソースと出題形式を含めます。単語帳の並び替えは、見出し語IDと例文の内容で識別し、例文の順序変更から独立させています。ペア本文Q&Aでは、参加者の画面に表示された質問文と同じ単元の公開教材を照合し、一意に特定できた時点で登録できます。
- 英C・論表の通常教材には行IDがないため、正規化した英文と和文をSHA-256で識別します。同じ科目・形式の同じ文面は通常学習、Daily、ペア間で共通です。出題順や教材の並び替えではIDは変わりません。AI教材は単元・カテゴリ・問題文・解答で識別します。IDのない教材の文面が編集されたり、教材が非公開になったりした場合は、一覧から古い参照を解除できます。
- 選択肢の順序、Dailyの抽選結果、ヒントの表示段階、教材の全文はFirebaseに保存しません。復習の選択肢は公開教材から組み立てます。

## Firebase Rules を反映する手順

1. Firebase Console の **Realtime Database → ルール** で現在の本番ルールを取得し、バックアップを保存します。
2. [firebase-favorites.rules.proposed.json](../firebase-favorites.rules.proposed.json) の `rules.questionFavorites` だけを、取得したルールの `rules` に追加します。このファイル全体は、お気に入り単独のローカル検証用です。
3. ルートや親パスに広い `.read` / `.write` の許可がないか確認します。Realtime Database では親で許可したアクセスを子で取り消せません。既存の学習記録・ペア・教員用ルールの差分も確認します。
4. 統合版を Emulator または検証用プロジェクトで確認します。本人の登録・購読・解除、別ユーザー・未ログイン・匿名ユーザーの拒否、および既存機能を確認した後、管理者がルールを公開します。公開前は新しいお気に入りの読み書きだけが権限エラーになります。

ローカル検証はリポジトリのルートから実行します。

```sh
npm ci --prefix tests/pair-qa-rules
cd tests/pair-qa-rules
./node_modules/.bin/firebase emulators:exec --project demo-yoshi-favorites \
  --config ../../firebase.favorites-emulator.json --only database \
  'node --test favorites.test.cjs'
```

クラウド環境でホームディレクトリが読み取り専用の場合は、`FIREBASE_EMULATORS_PATH` と `XDG_CONFIG_HOME` を書き込み可能な場所に指定します。初回ダウンロードには `storage.googleapis.com` が必要です。

## 本番導入前の確認とロールバック

管理者が読み取り専用で取得した最新版を `/path/to/production-rules.json` に保存し、リポジトリのルートから次を実行します。Rulesのエクスポート、統合版、差分はリポジトリの外で保管します。

```sh
umask 077
rules_dir=$(mktemp -d)
cp /path/to/production-rules.json "$rules_dir/before.json"
node scripts/merge-favorites-rules.cjs "$rules_dir/before.json" "$rules_dir/after.json"
git diff --no-index -- "$rules_dir/before.json" "$rules_dir/after.json"
```

`git diff --no-index` は差分がある場合に終了コード1を返します。整形による差分が見づらい場合は、両方を同じJSONフォーマッターで正規化して比較します。統合スクリプトは現行ファイルを維持し、ルートで広い許可があり得る場合や、同名ブロックがある場合には中止します。

```sh
export FAVORITES_RULES_FILE="$rules_dir/after.json"
(cd tests/pair-qa-rules &&
  ./node_modules/.bin/firebase emulators:exec --project demo-yoshi-favorites \
    --config ../../firebase.favorites-emulator.json --only database \
    'node --test favorites.test.cjs')
```

GitHub ActionsはリポジトリにあるRulesのスナップショットを使って統合テストします。本番エクスポートが別の内容なら、上記のコマンドでその統合版を検証します。ローカルのEmulator取得に失敗した場合は、公式Firebase CLIが取得できる環境で同じコマンドを実行します。

1. 統合版の検証成功後、管理者が公開直前のRulesを再取得し、バックアップ取得後に別の変更がないか確認します。差分があれば統合と検証をやり直します。
2. 承認後にRealtime DatabaseのRules画面で統合版を公開し、PR #80をマージします。GitHub Pagesの公開元が対象ブランチのルートであることと、公開ジョブの成功を確認します。
3. サイトのサブパス配下でホームから `favorites.html` を開き、CSS・JSと教材が取得できることを確認します。本番での書き込み確認が承認されている場合は、テスト専用Googleアカウントでお気に入りだけを登録・解除します。
4. ロールバック時は、Pagesの公開元でお気に入りの変更をrevertします。Rulesを戻す場合は、以後のRules変更がなければバックアップを復元します。変更があれば現在のRulesからお気に入りのブロックだけを外します。Realtime Database内のお気に入り、学習記録、XP、Daily、ランキングのデータは削除しません。
