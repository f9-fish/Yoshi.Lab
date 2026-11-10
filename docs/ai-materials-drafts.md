# 教科書本文マスター → AI教材生成候補（Spark対応・下書き段階）

## 作成済みのシート
既存スプレッドシート `1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU` に既存タブを維持したまま
- 左端「教科書本文マスター」（sheetId=2093116001）：1文1行。原文ID、科目、単元ID、Part、文番号、英語、日本語訳、メモ、生成対象、備考
- 「AI生成候補」（sheetId=2093116002）：5種類の問題を審査するステージング表。「要確認」「採用」「却下」「転記済」
を追加。本文マスターにはユーザー提供の Lesson 7 PUS の12文と和訳を初期登録済み。

## 設計
1. 先生が本文マスターへ原文IDが一意となるよう本文を登録。教材は公開JSONやGitHubにコピーしない。
2. 先生が対象Partの行を選択して `previewAIMaterialsDrafts` を実行し、対象文数を確認。
3. 先生が外部AIへの教科書本文送信について学校の取扱規程・APIのデータ利用条件・著作権・費用を確認し、明示的に承認したときだけAPIキーを登録。
4. `generateAIMaterialsDrafts` を実行。**自動トリガーは作らない**。対象Partの本文だけがGemini APIへ送信され、返答はJSONとして検証し、5種類（単語熟語、文法穴埋め、本文Q&A、T/F、Discussion）の候補を「要確認」で新規行に追加。
5. 「採用」や「却下」は人による確認の印としてのみ扱う。**既存の「問題集」「英単語」「英C本文QA」等への自動転記とGitHub同期・アプリ公開は一切しない**。次フェーズで種類ごとの登録仕様・重複判定・公開前テストを整える。
6. True / False と Discussion はまだアプリ側の学習モードがないため、候補の作成・審査のみ。

## 既存Apps Scriptへの導入（まだ未適用）
`apps-script/ai-materials-drafts.gs` を既存プロジェクトへ追加ファイルとしてコピーし、同名の既存ファイルがないことを確認。Script Properties：
- `AI_MATERIALS_GEMINI_API_KEY`：APIキー。コードやスプレッドシートに書かない
- `AI_MATERIALS_MODEL`：利用契約上有効なGeminiモデルID（モデルの提供状況を確認）
- `AI_MATERIALS_EXTERNAL_SEND_APPROVED=true`：学校で利用可能と判断し、外部送信を承認したときのみ設定

APIキーや承認フラグが未設定ならAPIを呼ばない。API利用料金、データ取り扱い、送信できる本文の範囲を確認すること。

## 防御と限界
- 既存同期のコード・トリガー・公開フラグを変えない。
- 明示的な実行とScript Properties承認が必要。最大40文を1回の送信対象とし、テキストレスポンスはJSONとして検証。
- sourceIds照合、5種存在チェック、回答必須、T/F形式、重複キー確認。生成IDの重複登録を避ける。
- 原文やAPI応答本文をログへ出さない。Script PropertiesへAPIキーを隔離。
- AIが本文を正確に理解した保証はない。先生による英語・事実・学習目標の確認が必須。
- 人手確認後の自動転記、学習アプリ用T/F・Discussionの追加、初回の実サービス試験は未完了。
- Firebase Spark/Blazeとは独立しており、Google Apps Script＋外部APIの利用条件が適用される。
