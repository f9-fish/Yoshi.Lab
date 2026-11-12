# Phase 4：Gemini HTTP 503の調査（2026-11-12）

対象：`yoshilab-material-test01` / `gemini-3.8-flash` / `JOB-b888236ffcfcd39446e41e5e09e4fd70`。

## 判明したことと限界

管理者報告ではGCS保存成功、ジョブ「エラー」、生成0、`AIサービスが応答しませんでした（HTTP 503）`。このメッセージを作るのは `gemini.cjs` の `POST https://generativelanguage.googleapis.com/v1beta/models/<configured-model>:generateContent` の非2xx応答分岐だけです。したがって今回の503は上流HTTP応答として受け取った値であり、ローカル55秒タイムアウトのエラーメッセージではありません。

処理経路は次の通りです。

1. `service.cjs` がGCSのattemptedを先にtrueにし、ジョブを生成中に保存。
2. `gemini.cjs` がRESTを1回送信。HTTP 503なら安全な固定文言でthrow。
3. `engine.cjs` が例外を `report.errors` に変換して「エラー」のreportを返す。
4. `service.cjs` がreportと状態をGCSに保存し、ジョブを返す。
5. `http.cjs` は返却できたジョブにHTTP 200を付ける。**Cloud Runの `/step` が200でもGemini生成成功を意味しません。** serviceの外側catchによる502は、engineの通常の生成エラーとは異なる予期しない処理/保存障害などの経路です。

既存コードは上流のエラー本文・所要時間・定型ステータスを保存していないため、今回の過負荷/障害の内訳は後から復元できません。作業環境にはGCPの認証・実行IDがなく、実Cloudログ・ジョブ・当時のrevisionを直接取得していません。上記は報告とソースに基づく判断です。以下の読み取り専用スクリプトで配置revision・設定・保存済み記録を照合できます。

## 原因候補の検証

| 候補 | 確認結果 |
|---|---|
| Gemini側の一時過負荷/停止 | 503と最も整合的。公式Troubleshootingも503 UNAVAILABLEを一時エラーとして扱う。ただし今回の本文がないため特定の過負荷・障害とは断定不可。発生時刻で公式障害情報とも照合する。 |
| 存在しないモデルID | 公式モデルページに `gemini-3.8-flash` がStableとして存在することを今回確認。推測によるモデル変更なし。ただし当該キー/プロジェクトでの利用可能性は公開資料だけでは確認できない。モデル名誤りでは一般に404が目安。 |
| 出力上限/JSON形式 | 公式3.8 Flashは構造化出力対応、出力上限65,536トークン。現行の12,000はその範囲内。ローカルテストでcontents/JSON MIME/schema/モデルURLを検証。実リクエスト全体のモデル受理までは未検証。入力制限やパラメーター不正は一般に400が目安で、503だけでは証明も排除もできない。 |
| temperature=.35 | 公式Troubleshootingは3.6以降のカスタムtemperature等を現在は無視し、将来400になるとして削除を推奨。**確認済みの3.8 Flashに限って送信を削除**。503の原因と断定した変更ではなく、公式仕様への予防的な適合。ほかのモデルの既存設定は維持。 |
| クライアントタイムアウト | 55,000msのAbortController、独自の中断/タイムアウト文言。今回のHTTP 503文言とは別。Cloud Run上限は設定上120秒。既存request latencyとrevisionの設定で照合可能。上流側が内部タイムアウトを503に変換した可能性までは否定しない。 |
| APIキー/課金/利用枠 | 401/403/429などが通常の手掛かり。今回の503だけを根拠にIAMを追加しない。既存認証成功・GCS保存成功はGeminiの課金/キー制限を保証しない。 |

参照した公開資料（認証なしのドキュメント取得のみ、Gemini API呼出しなし）：

- <https://aistudio.google.com/docs/troubleshooting>
- <https://aistudio.google.com/docs/models/gemini-3.8-flash>
- 障害情報の確認先：<https://aistudio.google.com/status>（当時の障害との照合は未実施）

公式の一般的な再試行推奨より、このテストの**1ジョブ・1試行・再生成禁止**を優先します。SDKへの置換、指数バックオフ、タイムアウト延長、別モデルへの自動切替は追加しません。

## 実Cloudの安全な確認（変更・生成なし）

Cloud Shellの既存リポジトリで、作業中の変更がないことを確認して最新版を取得します。

```bash
git pull --ff-only origin feat/sheet-material-generation-phase3
bash material-generation/ops/test01/diagnose-503.sh
```

スクリプトは既存TEST01だけのRun設定・対象ジョブ・予約の要約、過去7日/最大50件のrequestログと新しいGemini診断ログを読みます。モデルAPI/Secret取得/生成/デプロイ/GCS書込/ロック解除は行いません。GCSから読んだ本文やowner、全環境変数、上流エラー全文を表示しません。スクリプトが表示するmetadata summaryは共有可能です。

主な確認値：モデルID、専用実行IDの一致、Phase4制限true、追記無効、Secret参照の有無（値や参照名は非表示）、Cloud Runタイムアウト、jobMatches=true、state=エラー、candidateCount=0、upstreamHttpStatus=503、claimのjobMatches=true/attempted=true。

ログを個別に確認する場合：

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="yoshilab-material-test01" AND logName="projects/yoshi-lab-db3eb/logs/run.googleapis.com%2Frequests"' \
  --project=yoshi-lab-db3eb --freshness=7d --limit=50 \
  --format='table(timestamp,resource.labels.revision_name,httpRequest.status,httpRequest.latency)'

gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="yoshilab-material-test01" AND jsonPayload.component="material_gemini"' \
  --project=yoshi-lab-db3eb --freshness=7d --limit=50 \
  --format='table(timestamp,resource.labels.revision_name,jsonPayload.event,jsonPayload.httpStatus,jsonPayload.providerStatus,jsonPayload.elapsedMs,jsonPayload.timeoutMs,jsonPayload.retryAfterSeconds,jsonPayload.retryAttempted)'
```

requestログは今回の生成時刻を管理者側で特定し、そのrevisionとlatencyを確認してください。requestには状態取得等も含まれます。診断追加前のrevisionでは後者が空でも正常です。今回の過去の503に新しいログが追加されるわけではありません。7日より前の場合は期間を実際の時刻に合わせて変更します。textPayloadや全JSONログ、ジョブ全文、Secret値の貼り付けは不要です。

## 追加診断の仕様

`material_gemini` の1完了ログをREST1試行につき最大1件出します。上流HTTPステータス、許可した定型providerStatus/数値providerCode、所要時間、モデルID、教材種類、入力のバイト数/文数、出力トークン上限、タイムアウト設定、数値Retry-After（最大86400秒）、retryAttempted=falseだけです。

eventは `http_error / timeout / cancelled / network_error / invalid_response / success` の固定値。successはAPIのJSON回答取得を意味し、問題の品質/構造検証合格を意味しません。失敗時は同じ診断の許可フィールドだけを `report.errors[].diagnostic` に永続保存します。上流エラー本文は16KiB上限でメモリー内解析し、message/detailsは捨てます。数値Retry-Afterを記録しても再試行はしません。loggerの例外は生成結果・エラーを置き換えません。

ログにはキー・トークン・メール・UID・教員情報・本文・生成結果・プロンプト・上流エラーメッセージ・任意ヘッダー・スタックを出しません。HTTPのリダイレクト追従も禁止します。今回の既存ジョブ/予約/attemptedは読み取り対象のままで更新しません。

## 次回の実生成テスト案（今回は実施しない）

TEST01のattempted、ジョブ、予約、ロック、Apps Scriptの試行マーカーを削除/初期化したり、TEST01の保存先だけを空のバケットへ切り替えたりしません。診断コードを配置しても既存ジョブは再生成できません。

次回は、別名サービス（例 `yoshilab-material-test02`）・別の専用SA・別の私有バケット・新しいテストApps Scriptプロジェクトを使う独立TEST02を提案します。新環境も1ジョブ/1試行、追記/公開無効、Secret単位/バケット単位の最小IAM、費用確認を維持。元のTEST01シート6文は読み取りだけで利用できます。現在のスクリプトとクライアントはTEST01固定なので、そのまま名前やバケットを差し替えて実行せず、TEST02の対象URL/audience/運用手順を明示する別のレビュー可能な変更が必要です。

実環境の確認結果と費用を確認した後、管理者が新しい1試行を明示的に承認した場合だけ準備・実行します。今回は新環境の作成も実生成も行いません。
