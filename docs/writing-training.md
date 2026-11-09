# 英作文対策

HOME → 英作文対策 → 英C／論表 → Lesson → 問題 → 結果・解説 → 次の問題、の順で練習します。背景は既存の山画像、表示部品は英検画面のヘッダー・パネルを再利用しています。

## データ

同じディレクトリの `writing_questions.json`（オブジェクト配列）を読み込みます。初期値は `[]` です。実際のLessonに対応する英作文教材が未提供のため、例題を本番教材として公開していません。既存4教材JSONの科目・`id`からLessonを集め、英作文データにだけあるLessonも追加します。0問のLessonは「問題未登録」で無効です。既存教材情報を取得できない場合は警告し、英作文JSONのLessonを使います。

以下は形式の例です（そのまま公開せず教材を確認してください）。

```json
{
  "id": "W-EC-007-001",
  "subject": "英C",
  "lesson": "7",
  "number": 1,
  "japanese": "私たちはプラスチックごみを減らす必要がある。",
  "requiredExpressions": ["reduce"],
  "modelAnswer": "We need to reduce plastic waste.",
  "acceptedAnswers": ["We have to reduce plastic waste."],
  "hints": ["「〜する必要がある」は need to ～。", "「プラスチックごみ」は plastic waste。"],
  "explanation": "need to + 動詞の原形で必要性を表せます。",
  "status": "公開"
}
```

`subject`は英C／論表、`lesson`は既存教材の`id`と一致させます（論表は「16 動名詞(2)」など番号以外も含む）。`number`は正の数でLesson内の順番、IDは公開問題全体で一意です。`status`が厳密に「公開」のものだけ表示します。必須項目不備・重複のある公開データは読み込みを中止して再読み込みを案内します。許容解答・指定表現・ヒントは配列（改行文字列も読み込み可）です。

指定表現はすべて必須です。指定しない問題は空配列にします。「need to / have to」のような説明用の区切り文字を指定表現に入れず、共通の指定語を使うか指定なしにしてください。原形・活用形は別物として扱います。

## 判定

登録済みの模範解答・許容解答と照合します。大文字小文字、全角英数、余分な空白、文末の . ! ?、曲がったアポストロフィを正規化します。語順、否定、時制、単複、内部の句読点を無条件には変更しません。指定表現は単語境界を含む連続語で確認します。未一致や指定表現の不足は「要確認」とし、不正解と断定しません。AI採点・文法解析はありません。

## ヒント・記録・XP

ヒントは初期非表示で、1段階ずつ表示・開閉できます。使用段階を各解答に記録します。ヒント使用による減点はありません。XPは常に0で、既存のXP保存・集計を呼び出しません。

記録はメモリー内のみです。全問終了時にJSONをダウンロードできます（`schemaVersion`、`mode`、`studentId`、`subject`、`lesson`、`questionId`、`answer`、`status`、`registered`、`expressions`、`hintsUsed`、`answeredAt`、`xp:0`）。未ログインならstudentIdはnullです。英文を含むファイルは個人情報として扱ってください。リロード・画面を離れると記録は消えます。Firebase Rulesが未確認のためFirebaseへの英作文保存、マイページ・教員画面への統合は未実装です。Googleログインは既存account.jsを利用します。

## Sheets → Apps Script → GitHub

実際のスプレッドシート・Apps Scriptにはアクセスしていません。`apps-script/writing-sync.gs`は**未適用の追加コード**です。既存の同期コードやトリガーを置き換えず、別ファイルとして追加してください。

1. シート「英作文問題」を作成。1行目を以下の列名にします。列順は任意です。
   `問題ID / 科目 / Lesson / 問題番号 / 日本語の問題文 / 指定語・指定表現 / 模範解答 / 許容解答 / ヒント① / ヒント② / 解説 / 公開状態`
2. 指定表現・許容解答はセル内改行で複数登録します。公開状態は「公開」の行だけ出力します。
3. Script Propertiesに`WRITING_SPREADSHEET_ID`、`WRITING_GITHUB_REPO`（`f9-fish/Yoshi.Lab`）、`WRITING_GITHUB_TOKEN`を設定。トークンは対象リポジトリのContents権限に限定し、コードに直接記載しません。
4. まず別の検証用リポジトリで、`buildWritingQuestions_`の出力を確認し、`syncWritingQuestions`を手動実行してください。この関数は指定リポジトリの**mainのwriting_questions.jsonだけを書き換えます**。本番への実行は管理者の明示的な確認後に行ってください。保護ブランチで拒否される場合は既存の運用に沿ってPR経由の同期へ変更してください。
5. 既存同期を確認した後、必要ならこの関数専用のトリガーを管理者が作成してください。このPRではトリガー作成・外部設定変更・main書き込みは行いません。

## 確認方法

`node --test --test-isolation=none tests/*.test.cjs`

ローカルのHTTPサーバーでHOMEとwriting.htmlを開き、0問表示・無効Lessonを確認します。検証用JSONに上記の例を投入した環境で、入力→ヒント1→ヒント2→開閉→解答→別解→要確認→次へ→振り返り→JSONダウンロードを確認します。320px・390px・PC幅で横はみ出しを確認してください。本番への記録作成によるテストは行わないでください。
