# 英C本文Q&A（ドラフト・未公開）

Spark対応版は [pair-text-qa-spark.md](pair-text-qa-spark.md) を参照してください。以下のサーバー構成・回数制限・設定手順は `backend: 'functions'` のCloud Functions版の説明です。

## 追加機能

既存 `pair.html` の「英C → 学習内容 → 本文Q&A → Lesson → Part → 時間設定 → 6桁コード → 役割確認 → 開始」を追加しました。論表には表示しません。未登録Partは無効です。既存の配色・パネル・ボタン・A/B確認・交代オーバーレイ・効果音・タイマーを再利用し、タイピング・AIは使いません。

出題者は英語の質問を読み上げ、「解答を見る」で模範解答・許容解答を確認し、○×を判定します。回答者は質問を聞いて口頭回答し、「ヒントをお願いする」を使用できます。出題者が段階的にヒントを出すと両端末に反映します。判定後は質問・模範解答・許容解答・本文根拠を両端末で確認します。

## 実データと外部設定の状態

対象：スプレッドシート `1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU`、タブ `英C本文QA`。

リポジトリには英C Lesson 7のPart 1・2・3各5問、PUS6問（合計21問）と4セクションの目録が同期されています。サーバースナップショットとの整合性もテストします。スプレッドシートと稼働中Apps Scriptを直接確認したものではありません。テスト用15問の架空データは実教材とは別です。

実際に稼働中のApps Script・Realtime Database Rulesはリポジトリにありません。リポジトリの英作文用追加コードと既存ペア実装を調査しましたが、外部の既存同期・Rulesを確認したとは扱いません。Sheets・Apps Script・本番Firebase・Rules・課金・デプロイの変更は行っていません。

初期は `pair-qa-config.js` とサーバーパラメーターの両方を無効にしています。実データ同期と専用サーバーの準備が済むまで、本文Q&Aボタンは問題未登録／準備中として開始できません。既存モードは引き続き利用できます。

## 権限と同期の設計

既存モードは従来の匿名認証・Realtime Databaseの `rooms` を維持します。既存Rulesが未確認のため、そのパスに新しい権限を仮定してQ&Aデータを書き込む実装にはしていません。

Q&Aは第2世代callable `pairTextQA` と専用の名前付きFirestore DB **pair-qa** を使います。既存のRTDB・Firestore既定DBにはアクセスしません。専用のサーバーがFirebase匿名認証・App Check・部屋の参加UID・現在の出題者を確認して、解答表示・ヒント・判定・次へ進む操作を検証します。画面のボタン非表示は権限の根拠にしません。

- Q&Aの6桁コードは `0xxxxx`。既存モードが生成する100000〜999999と分離し、同じ参加コード欄から自動で振り分けます。
- ゲスト枠はトランザクションで1人だけ確保。3人目・他の匿名UIDはルームを読めません。
- 部屋作成時に信頼できるサーバー教材から問題をコピーし、番号順に固定します。途中の再同期・関数更新でも既存ルームの問題・順序を変えません。問題数はPartごとに変動します（1部屋200問・500KB上限、超過はエラーで開始しません）。
- 目録のハッシュとサーバー配備版を照合します。教材同期後、サーバーを再配備していなければ新規作成を拒否し、古い問題を黙って出題しません。
- 回答者向け応答には、判定前の質問・模範解答・別解・将来の問題セットを入れません。出題者にも「解答を見る」まで解答を返しません。選択画面が取得するJSONはLesson・Part・件数・ハッシュだけの目録です。
- **教材自体は公開GitHub JSONです。** 悪意ある利用者が公開JSONを別途取得することまで防げません。今回保証するのはアプリの進行中ルームからの事前送信防止とサーバー操作権限です。試験のような教材自体の完全な秘匿には非公開の教材保存先が別途必要です。
- 同期は最大約1.5秒間隔のcallable再取得と、操作直後の応答で行います。重複した次へ操作は問題番号をサーバーで検証して拒否し、古いrevisionの応答は画面へ反映しません。通信エラーは段階的に最大30秒まで間隔を延ばして再接続し、8回連続失敗または権限・失効エラーで停止します。その場合は同じタブを再読み込みしてください。全問終了後は定期取得を停止します。
- 時間切れはサーバー時刻で自動的に×として確定します。出題者以外が任意の○×や次の問題を強制することはできません。交代は半分（切上げ）・1問・2問で既存実装と同じです。
- Q&Aのみ、独立した `yoshi-pair-session` アプリの匿名認証をタブ内セッションへ保持します。6桁コードもsessionStorageへ保存し、同じタブの再読み込み／一時切断後に同じUIDで復帰します。既定アプリのGoogleログインは変更しません。別の端末・匿名UIDへのなりすまし復帰は拒否します。
- 待機だけの招待は5分、参加済みルームは作成から3時間で失効します。新しいペアワーク／待機終了の操作で復帰先コードを消します。
- 参加試行はUIDごと10回／分・全体120回／分、全通信はUIDごと90回／分・全体3000回／分、作成は全体200部屋／時にサーバー側で制限します。匿名UIDを作り直しても全体上限は共有です。
- Firestoreにはルーム内の問題スナップショット・匿名UID・進捗・判定を一時保存します。学習履歴やXPの保存ではありません。TTL設定によって期限後に削除します。XP・Daily・ランキング・英検・教員画面は変更していません。

## Sheets → GitHub同期

`apps-script/pair-text-qa-sync.gs` を既存Apps Scriptプロジェクトへ**新しいファイルとして追加**してください。既存の同期関数・トリガー・英作文コードを削除・置換しません。このコードは未適用です。

1行目の列名（列順を入れ替えても列名で取得します）：

`問題ID / 科目 / 単元ID / Part / 問題番号 / 英語の質問 / 模範解答 / 許容解答 / ヒント① / ヒント② / 本文根拠・解説 / 公開状態`

公開行だけ出力し、空白行・非公開行は除外します。科目は英Cのみ、IDは一意、問題番号は正の整数。必須項目不足・不正データがあれば行番号付きでエラーを報告し、既存JSONを更新しません。許容解答はセル内改行または `||` で複数登録します。ヒント空欄も保持し、②だけの場合は段階2として扱います。Lesson／Partの番号や名称はハードコードしません。

Script Properties：

| 名前 | 値 |
| --- | --- |
| PAIR_QA_SPREADSHEET_ID | 任意。省略時は上記ID |
| PAIR_QA_GITHUB_REPO | `f9-fish/Yoshi.Lab`。初回は検証用リポジトリを推奨 |
| PAIR_QA_GITHUB_TOKEN | 対象リポジトリのContents書込権限に限定したトークン |
| PAIR_QA_GITHUB_BRANCH | 最初は既存の検証用ブランチ。省略時はmain |
| PAIR_QA_ALLOW_EMPTY | 通常は未設定。意図的に全件非公開にする場合だけtrue |

1. `previewEnglishTextQA` を実行し、公開件数が15問、Part1〜3の件数・エラーを確認します。プレビューはSheetsを読むだけでGitHubへ書きません。
2. `syncEnglishTextQA` を手動実行します。UTF-8の `pair_text_qa.json` と `pair_text_qa_catalog.json` を**1つのGitコミットで同時更新**します。片方だけの更新を避け、ブランチが進んでいたらforceせず中止します。同じ内容なら変更なしです。
3. 差分と科目・Lesson・Part・順序を確認後、通常のレビュー手順で教材を公開します。mainを指定するとmainへ書く処理なので、管理者が運用を確認してから設定してください。今回実行はしていません。
4. 自動化する場合は、検証後にこの関数用の時間トリガーを管理者が追加してください。既存の英検・英C・論表・英作文のトリガーを置換しません。
5. 教材を同期したら、下記のQ&A関数も再配備します。開始済みの部屋は元の問題を継続し、新しい部屋から更新版を使います。

JSON形式の例（実シートから取得した内容ではありません）：

```json
{
  "id": "QA-TEST-001", "subject": "英C", "lesson": "7", "part": "1", "number": 1,
  "question": "What did the student read?", "modelAnswer": "The student read a book.",
  "acceptedAnswers": ["A book was read by the student."],
  "hints": ["Think about the subject.", "Use read a book."],
  "explanation": "本文の該当文を確認します。", "status": "公開"
}
```

## サーバー準備案（管理者レビュー後。今回は実施しない）

既存Rulesを取得・変更したとは扱いません。新規 `pair-qa` DBでクライアント読み書きが拒否されることを検証してから有効化してください。次は**提案コード**で、Rulesファイルや本番設定を変更していません。

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

- 検証用プロジェクトを先に使用してください。Cloud Functions第2世代・Firestore・App Check・課金プランの状態を管理者が確認します。
- 専用の名前付きFirestore DB `pair-qa` を作成します。既存 `(default)` やRealtime Databaseを置換しません。上記のdeny-all案をこのDBにだけ適用する承認・検証が必要です。既存DBに誤適用しないでください。
- Admin SDKの実行サービスアカウントに専用DBへの必要なアクセスを設定します。クライアントから `pairQaRooms` / `pairQaLimits` を読んだり書いたりできないことを、未認証／匿名認証の両方で検証してください。
- `pairQaRooms`の `expiresAtTTL`、`pairQaLimits`の `expiresAt` にFirestore TTLを設定します。TTL削除は遅延するため、アクセス失効はサーバーで別に検証します。
- Firebase App Checkの既存WebアプリにreCAPTCHA EnterpriseとGitHub Pagesドメインを設定し、公開サイトキーを `pair-qa-config.js`へ設定します。他サービスのApp Check強制を一括変更しません。匿名ログインは既存の設定を維持します。
- `pair-qa-functions/.env.example` をローカルの `.env.yoshi-lab-db3eb`へコピーします。最初は `PAIR_QA_ENABLED=false`。本番キー等は不要です。OpenAIは使いません。

検証後の限定デプロイ例（今回は実施しない）：

```sh
npm ci --prefix pair-qa-functions --ignore-scripts
node --test --test-isolation=none tests/*.test.cjs
node pair-qa-functions/scripts/snapshot.cjs
firebase deploy --config firebase.pair-qa.json --only functions:pair-qa:pairTextQA --project yoshi-lab-db3eb
```

`firebase.pair-qa.json` はQ&A専用codebaseだけを含み、Rulesや既存Functionsの配備設定を含みません。CLI表示の対象を確認してください。問題と目録が不一致ならpredeployで中止します。検証用プロジェクトで2端末・権限・再接続を確認した後に、サーバー `PAIR_QA_ENABLED=true` を再配備し、フロントの `enabled:true` を別途レビューして有効化します。

callableの1.5秒ポーリングはFunctions／Firestore／App Checkの利用量を増やします。クラス規模で料金・上限を確認してください。予算通知は支出停止ではありません。maxInstances=3と回数上限はありますがGoogle側の費用を完全に停止する保証ではなく、異常時はサーバーを無効化・停止する運用が必要です。

## テスト・未確認事項

- `node --test --test-isolation=none tests/*.test.cjs`（Node24）。Node22では `node --test tests/pair-qa*.test.cjs`。
- 検証用15問とFirestore代替実装で、公開／非公開、科目・Lesson・Part、番号順、質問・解答のサーバー非送信、操作権限、ヒント、重複・並行操作、交代、時間切れ、再接続、固定スナップショットをテストします。
- 独立したA/Bブラウザーを320・390・1280pxで使用し、半分・1問・2問の交代、ヒント2段階、○×、スコア、再読込復帰、途中の再同期を確認します。Firebase・App Checkは代替実装で、本番通信は遮断しています。
- 既存の本文穴埋め・単語別解・XP・Daily・ランキング等のテストも実行します。既存RTDBの実Rulesの安全性、実匿名Auth・App Check・IAM・Firestoreとの疎通は未確認です。ステージングの実サービス確認が必要です。
- Firebase公式依存を固定しました。`npm audit --omit=dev`は間接依存にmoderate 6、high/critical 0を報告します（glob／minimatchと依存チェーン）。学生入力をファイルパターンへ使う処理はありませんが、解消したとは扱わず、本番有効化前の上流修正版・到達可能性レビューが必要です。

未完了：稼働中同期コードの直接確認、実サーバー／App Check／専用DBとRulesの管理者設定、実サービスでの2端末確認、本番公開。mainマージ・本番デプロイ・Rules変更はしていません。
