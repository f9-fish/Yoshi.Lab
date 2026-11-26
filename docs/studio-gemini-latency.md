# AI教材スタジオの55秒タイムアウト

2026年11月26日09:42:49 JSTの計測では `studioapi-00002-caz` が HTTP 504 を約56.42秒で返しました。対象は架空本文から各2問、合計10問です。

## コードで確認できたこと

現行の `studioApi` は、認証・利用回数確認後、Gemini Developer APIの `v1beta/models/<設定済みモデル>:generateContent` へ非ストリーミングで1回送信します。1つの本文とプロンプトから、単語・穴埋め・Q&A・True/False・Discussionの5配列を要求します。件数は各種類の上限です。温度は0.35、JSON指定、`maxOutputTokens: 8192` で、思考設定は明示していません。

`AbortController` はGemini呼び出しの55秒後に中断し、`AbortError` を504に変換します。中断対象にはHTTPヘッダーの待機と本文の読取りが含まれます。デプロイ定義のCloud Run側の期限は90秒、GeminiがHTTPエラーを返す場合のこのハンドラーの応答は502です。観測504と時間はローカル中断に整合します。応答本文や追加診断が無いため、当該リクエストの待機段階や、Gemini側の待ち行列・推論・出力・通信のどこが原因だったかは特定できません。PR #77で記録した上流503とは診断を分けます。

## 対応する設定

[Gemini thinkingの仕様](https://ai.google.dev/gemini-api/docs/thinking) · [Gemini 3.8 Flashのモデル仕様](https://aistudio.google.com/docs/models/gemini-3.8-flash) · [Google公式SDKの型定義](https://github.com/googleapis/js-genai/blob/main/src/types.ts)

公式SDKで `ThinkingLevel.LOW`、`thinkingConfig.thinkingLevel`、`includeThoughts`、`maxOutputTokens` を確認しました。モデル固有の対応レベルと上限は別です。今回の環境はモデルページに直接接続できなかったため、PR #77の確認記録にある、3.8 FlashのLOW対応とモデル上限の入力1,048,576／出力65,536トークンを根拠にしました。Geminiへの実リクエストによる再確認は行っていません。[PR #77での仕様確認](https://github.com/f9-fish/Yoshi.Lab/blob/867fffa8bc7de204780d7ebea66d9e1597a82ec6/material-generation/ops/research-503-20261112/README.md)

`maxOutputTokens` は上限です。実際の応答が8192トークンだったことや、当該504の原因だったことは示しません。

## このブランチの変更と承認後の確認

- 正確なモデルIDが `gemini-3.8-flash` で各種類2問以下の場合だけ、`thinkingLevel: "LOW"` と `includeThoughts: false` を送ります。モデル、プロンプト、出力上限8192、55秒の期限、5形式の妥当性検証は維持します。大きいバッチや他モデルのリクエスト設定も維持します。
- Cloud Loggingにはヘッダー到達・本文取得・完了までの時間、終了段階、HTTP状態、終了理由、応答に含まれるトークン数と検証済み問題数だけを記録します。本文・回答・エラーの生応答・キー・認証トークン・UID・メールは記録しません。
- 承認後に対象リビジョンを配信し、同じ架空本文から各2問を1回試します。5種類・合計10問と、本文根拠・訳・正答・重複を教員が確認します。速度改善と品質は実生成で評価します。10問未満、 `MAX_TOKENS` 、品質不足、504のいずれかが出たら今回は止め、ログを確認します。自動再試行やモデル切替はありません。
