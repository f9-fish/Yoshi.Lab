# Gemini 503追加調査（2026-11-12、基準66484519）

対象：f9-fish/Yoshi.Lab、PR #77、feat/sheet-material-generation-phase3。今回は調査・読み取り補助だけで、生成コード/設定を変更しません。TEST04作成、Gemini API（モデル一覧/モデルGET/countTokensを含む）への新リクエスト、再試行、TEST01〜03の記録/設定変更、本番/教材/main変更は行っていません。

## 結論

1. TEST03の発生箇所は上流HTTP503/UNAVAILABLE（3.054秒）。90秒timeoutや教材検証失敗ではありません。TEST01も上流503（管理者報告で約31秒）ですが、正確な時刻は未共有です。
2. **今回の失敗を特定の公式障害へ結び付ける証拠は得られていません。** Google Cloud公式フィードの取得できた掲載分にはTEST03時刻との重複がなく、Gemini Developer API専用ページの動的な履歴は取得完了できていません。障害がなかった証明にはなりません。
3. APIキーの所属プロジェクト/制限/種別と、Cloud Run/Secretのプロジェクトは別の確認対象です。現行Secret参照だけでは両者の一致・Geminiの課金/利用枠は証明できません。
4. 10問でもHTTPは1回、送信ボディ5,242 bytes。巨大入力の証拠はなく、503を件数に起因すると断定できません。出力上限や生成負荷が容量確保へ影響する可能性は未検証です。
5. 新しい環境を増やす前に、既存のAPIメトリクスとキーのプロジェクトを確認します。同じキー/プロジェクトを使う限り、Cloud Run/SA/バケットを分離してもGeminiの利用枠は分離されません。

## 2026-11-13：管理者の読み取り監査結果

管理者が34b736ccのaudit.pyを実行し、次を共有しました。秘密値取得・Geminiリクエスト・Cloud変更・試行記録変更はいずれもfalseです。

- yoshi-lab-db3ebはbillingEnabled=true。ただしGeminiキーprojectとの対応は未確認。
- generativeLanguageEnabled=false。API Keys metadataには1件だけあり、apiRestricted=true、browserRestricted=true、Generative Languageの明示許可なし、GenerateContent許可なし、auth keyのSAバインドなし。
- この一覧のキーはサーバー用Geminiキーの条件に適合していません。ただし**Secret内のキーと同一かどうかは未確認**で、これを今回使用したキーだとは断定しません。既存Web/Firebase用途の可能性があるため制限解除/変更はしません。
- request-count/latency/output/quotaはすべてseriesCount=0で、5xx率や使用量はnull。実キーの別projectを見ている可能性や未収集があるため「リクエスト0」「エラー0」「無課金」とは判断しません。
- TEST01 attemptedAt=2026-11-12T03:48:30.538Z＝**11月12日12:48:30.538 JST**。TEST03 attemptedAt=14:18:04.643Z＝**23:18:04.643 JST**。両方attempted=trueで対象ジョブ一致。
- これでTEST01の時刻は判明。取得済みCloud公式フィードの掲載分には両時刻を覆う事象はありませんが、Developer API専用の動的履歴は取得未完なので公式障害との因果関係は依然未確定です。
- 管理者はSecretへ登録したキーの所属projectを「不明」と回答。秘密値を読まない条件では、この紐付けを確定できません。作成記録やAI Studioの非秘密project情報が得られるまで、新規API有効化/キー変更/再生成は行いません。

今回、監査ツールに `--api-project` の明示指定を追加しました。所属が判明した場合だけ、そのprojectのbilling/API/キーmetadata/metricsを読み、TEST01/03の時刻は常に元のyoshi-lab-db3ebのバケットから読む構成です。gcloudの既定projectを変更せず、秘密値や生成APIを使いません。**不明な現在は同じ監査を再実行する必要はありません。** project名の仮値をそのまま入力しないでください。

また、欠測時のgenerateContentRequestCountを0からnullへ変更しました。0件と未取得を区別する表示修正で、既存の監査結果や試行記録は書き換えません。

## 1. Google公式の稼働状況・障害履歴

確認した一次情報：

- [Gemini API / Google AI Studio公式ステータス](https://aistudio.google.com/status)
- [Google Cloud公式の障害履歴](https://status.cloud.google.com/summary)
- [Google Cloud公式incidents.json](https://status.cloud.google.com/incidents.json)
- [generateContentの公式エラー定義](https://ai.google.dev/gemini-api/docs/generate-content/api-errors)

Gemini専用ページはcurlとWeb取得でJavaScriptの初期HTMLしか得られませんでした。匿名Chromiumでも取得を試しましたが、環境のTLS検証でERR_CERT_AUTHORITY_INVALIDとなり履歴確認が完了していません。TLS検証を無効化したり、Geminiへの代替リクエストで稼働確認したりはしていません。ブラウザーでは生成APIのホスト/パスもブロックしました。

Cloud incidents.jsonの取得時点の掲載8件には、TEST03の2026-11-12 14:18 UTCと重なるものは0件。Gemini関連では2026-02-27 12:37〜14:35 UTC（同日21:37〜23:35 JST）のVertex AIグローバルendpoint障害が掲載されていますが、日付も対象サービスも今回とは異なります。

今回のコードはgenerativelanguage.googleapis.comのGemini Developer APIを呼びます。Cloud Runが東京でも、Geminiの推論先をasia-northeast1に指定するAPIではありません。Vertex AI/Agent PlatformやWorkspaceのGemini履歴を、そのまま今回の障害証拠として使いません。第三者監視サイト/匿名投稿も公式障害の代用にしません。

公式エラー表は503を一時的な過負荷/容量不足等、利用枠超過は通常429、権限・プロジェクト制限は通常403等として説明します。**一般的な説明であり、今回の個別バックエンド原因の証明ではありません。** 公式が推奨する再試行より、今回の「再リクエスト禁止」を優先します。

## 2. 発生時刻との照合

| 試行 | 実測/報告 | 公式履歴との照合 |
|---|---|---|
| TEST01 / JOB-b888236ffcfcd39446e41e5e09e4fd70 | HTTP503、生成0、約31秒。試行開始2026-11-12 12:48:30.538 JST = 03:48:30.538 UTC（11/13共有） | 取得できたCloud公開フィードに時間重複なし。Developer API専用の動的履歴は未取得 |
| TEST03 / JOB-dcb7e4afbc33a3565fb44a022b5cdcb2 | 2026-11-12 23:18:08.213665 JST = 14:18:08.213665 UTC。503/UNAVAILABLE、3.054秒 | 取得できたCloud公開フィードに時間重複なし。Developer API専用の動的履歴は未取得なので一致/不一致を確定しない |

TEST03は23:18:04.643 JSTにattemptedを保存、Cloud Runのstepは約4.57秒でHTTP200。APIエラーを含むジョブを正常に返した経路です。候補0、rawWritingPresent=falseなので、品質確認できる回答JSONもありません。課金の有無はusage応答がなく、このログだけでは分かりません。

## 3. プロジェクト側メトリクス・エラー率・利用制限

一次情報：[API利用状況の監視](https://docs.cloud.google.com/apis/docs/monitoring)、[serviceruntimeメトリクス](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#serviceruntime)、[Gemini APIメトリクス](https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h#generativelanguage)、[利用制限](https://ai.google.dev/gemini-api/docs/rate-limits)。

| 場所/指標 | 確認すること | 制約 |
|---|---|---|
| [AI Studio Usage](https://aistudio.google.com/usage) / 対象プロジェクト | model別のリクエスト数・エラー・入力/出力使用量 | 表示項目/粒度は画面/キー種別等に依存。本文ログは開かない/有効にしない |
| [AI Studio Rate Limit](https://aistudio.google.com/rate-limit) | 対象modelのRPM/入力TPM/RPD、tier、spend-based limit | プロジェクト単位、キー別ではない。上限値はアカウント/モデル依存なので推測しない |
| APIs & Services → Generative Language API → Metrics | 応答コード別の件数、エラー率、レイテンシ | Cloud Runの200とGeminiの503を混同しない |
| serviceruntime.googleapis.com/api/request_count | consumed_api、service=generativelanguage.googleapis.com、method末尾GenerateContent、response_code別 | 5xx率=同じ期間/母集団の5xx件数÷全GenerateContent件数。GetModel等を除外 |
| serviceruntime.googleapis.com/api/request_latencies | レイテンシ分布、必要ならConsoleでp50/p95 | 平均だけからp95を推定しない |
| generativelanguage.googleapis.com/generate_content_usage_output_token_count | model=gemini-3.8-flashの出力使用量 | 失敗時の0/欠測を無課金の証拠にしない |
| serviceruntime.googleapis.com/quota/exceeded / Geminiのquota/*/{usage,limit,exceeded} | 上限・使用量・超過シグナルを同時刻/モデルで確認 | サンプリング/表示遅延/欠測あり。データなしは「制限なし」ではない |

serviceruntimeはすべてのAPI/キー種別で必ず収集されるとは限りません。認証キーのリクエストはSA使用量メトリクスに記録されない旨も公式に明記されています。集計が空でもAPIが呼ばれていないと断定しません。メトリクスは数分遅れて表示される場合があります。

同じプロジェクトの本番等を含む集計になるため、単純なプロジェクト全体の5xx率をTEST03固有の失敗率とは呼びません。今回2件の503だけからサービス全体の障害率も計算しません。

## 4. 秘密値を読まないキー・モデル・プロジェクト確認

一次情報：[Gemini APIキー](https://ai.google.dev/gemini-api/docs/api-key)、[API Keys list](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys/list)、[API Keys get](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys/get)、[Keyリソース](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys)。

- Cloud Runの実行SAはSecretを読む主体。APIキーが結び付くプロジェクト/（auth keyの場合）SAとは別です。新しい実行SAで同じキーを使っても、同じキーの課金/制限/呼出主体の設定は変わりません。
- 現行コードのTEST01〜03は同じSecret名yoshilab-material-test01-geminiを参照する設計。Secretは単なる保管先なので、名前や保存先プロジェクトから、キーの所属プロジェクトは確定できません。
- API Keys list/getは秘密のkey stringを含まないmetadata取得です。resource名、所属project number、API/method制限、ブラウザー/IP/モバイル制限、auth keyのSAバインド有無を確認できます。getKeyString/lookupKey/Secret versions accessは今回使いません。
- 実行元はサーバーなので、ブラウザーreferrer制限付きキーは適合しません。IP制限付きは実際の固定egressとの照合が必要です。対象APIがGenerative Languageを許可し、method制限がGenerateContentを許可するか確認します。制限は自動変更しません。
- 公式はauth keyへの移行、無制限standard keyの拒否等を説明しています。実際のキー種別・API許可・課金/verification状態は未確認で、記載された期日/状態を推測して更新しません。
- **Secret payloadに対応するAPI key resourceの非秘密の作成記録がない場合、metadataだけでは使用キーを一意に照合できません。** 一覧が1件でも断定しません。作成記録/AI Studioで対象キーのプロジェクトをキー表示なしで確認できる場合だけ確定します。秘密値のハッシュ取得・照合も今回はしません。

[公式モデル仕様](https://aistudio.google.com/docs/models/gemini-3.8-flash)ではIDはStable、text/structured output/LOW対応、入力1,048,576・出力65,536 tokens。APIドキュメントが推奨するInteractionsへの移行は改善候補ですが、legacy generateContentの503を「そのAPIは非対応」と断定する根拠にはしません。APIの自動切替/新APIでのテストも行いません。

## 5. 10問一括の規模評価

基準66484519のgemini.cjs/gemini-profile.cjsを読み、TEST03の診断requestBytes=5242、sourceRows=6、maxOutputTokens=12000と照合しました。

- 10問をJSONのitemsに入れる**HTTP POST 1回**であり、10 RPMではありません。1回の要求内に前後関係を持つ10文を生成する仕様です。
- 5,242 bytesは約5.12KiB。本文・指示・スキーマを含む送信ボディ全体です。APIキーはヘッダーにあり、この値に含まれません。
- bytesとtokensは別です。countTokens禁止のため実入力tokensは未計測。巨大な入力/コンテキスト超過を示す証拠はありません。
- 12,000は出力上限で、実際に消費したtokensや入力TPMではありません。モデル上限65,536より小さい一方、長めの出力枠が容量確保や待ち時間に影響する可能性はあります。
- TEST03は約3秒で503を返し、回答JSON/usageはなし。容量受入れ段階での拒否と整合的ですが、その内部経路や「10問が重すぎる」という因果関係を証明しません。
- キー/モデル/プロジェクトの同じ条件で小さな対照要求と比較するまで、件数起因の503とは断定できません。時間帯で容量も変動するため、対照1回成功しても件数が唯一の原因とは証明できません。

## 6. 次の実生成の方法比較（今回は作成・実行しない）

現時点の推奨順は **無料のmetadata/metrics確認 → 提供元の状況確認 → 必要なら別途承認された最小対照1回 → 10問1回**。すべての生成は新しい独立した永続試行記録・送信前attempted・自動再送なしを前提とし、既存試行をリセットしません。

[公式料金](https://aistudio.google.com/docs/pricing#gemini-3.8-flash)は調査時点で2026年末までStandard input $0.75/1M、output（思考含む）$3.75/1M。2027年からの料金も記載があり、実行日に再確認します。以下は有料Standardでの出力上限部分の換算のみで、入力・Cloud等は別です。無料tier適用や503無課金は保証しません。

| 方法 | 費用/手間 | 分かること・注意 |
|---|---|---|
| metadata/既存metricsのみ | Gemini生成0、追加インフラなし | 今回の方法。キーproject/制限/エラー集計を先に確認 |
| 同じmodel/API/キーで短文1つのCloud Shell単発対照 | 出力上限1,024なら出力分約$0.00384＋入力等。新Run/Build/Apps Script不要 | 将来承認時だけ。新しい私有の永続記録で1送信を保証する別実装/レビューが必要。10問教材の品質検証にはならない。小上限では打切りもあり得る |
| 元の6文を使い10問のCloud Shell単発生成 | 12,000出力分は約$0.045＋入力等。新Run/Apps Script不要 | 将来は既存GCS入力を私有メモリーに読んで既存engineを再利用でき、再度のシート権限UIを避けられる。独立記録/費用/承認の設計は別途必要 |
| 新Cloud Run＋新Apps Scriptで10問 | 生成費用にBuild/コンテナ/Run等とGUI操作が追加 | 本番相当の接続確認には有用だが、今の503切り分けには費用/手間が大きい。同じキーの容量問題は分離されない |
| 5問×2回など分割 | 生成HTTP回数増、入力重複、ストーリー連続性の調整 | 現行1ジョブ/1送信の仕様変更になるので推奨しない。今回は実装しない |
| Batch API | 一般に標準比50%割引、完了待ち/取得/エラー処理が増える | 時間制約を緩められるが、今回のリアルタイム503の直接対照ではなく、新しいジョブ/状態管理のレビューが必要 |
| 別モデル/APIへの明示変更 | 金額・実装・意味が変わる | 有効なID/対応/費用の確認後に別途承認が必要。自動fallbackなし。今回変更しない |

上限を縮めた短文対照は安いものの、その後10問にも1送信が必要なら合計2試行です。最初から教材完成だけが目的なら、metrics確認後に10問1回を選ぶ方が操作回数は少なくなります。いずれも今回は未承認・未実施です。

## 7. 最小限の追加操作（必要な場合だけ）

このCodex環境にはGCP認証/gcloudがなく、非公開データの直接取得はできません。以下の既知projectの監査は11/13に管理者が実行済みです。再実行は不要で、参考手順として残します。

```bash
git pull --ff-only && python3 -B material-generation/ops/research-503-20261112/audit.py
```

読み取り対象：既知プロジェクトのbilling有効性、API有効性、API Keys metadata、TEST01/03のcreatedAt/attemptedAt、11/12 JSTのMonitoring集計。秘密値/本文/キーの表示名/SAの個人情報/IP等を除外してJSONを表示します。通常のCloud Shell認証でMonitoringのGETを行う際のトークンはメモリー内だけで、引数/ファイル/画面へ出しません。

Secret値/getKeyString/lookupKey、Geminiホスト、model GET/countTokens/generateContentにはアクセスしません。API有効化、権限追加、課金変更、試行/教材の書込、サービス更新も行いません。権限不足/未収集/欠測はREAD_FAILEDやnullとして表示し、0エラーと解釈しません。集計は既知プロジェクト全体で、実キーの別プロジェクトのデータは取得しません。

Secretと実キーresourceの対応が不明なら、追加で必要なのは**対象キーの所属プロジェクトID（非秘密）とキー種別/制限のmetadata確認だけ**です。AI Studioのキー一覧で値を表示せず確認してください。APIキー/トークン/本文/生ログの貼付けは不要です。稼働ページも参照する場合は、公開履歴に11/12の該当時刻を覆う事象があるかだけを確認し、一覧にないことを無障害の証明とはしません。

## 調査上の限界と変更範囲

Codexによる実Cloud直接取得は未実施ですが、11/13に管理者から共有された監査結果とTEST01の正確な試行時刻は上に記録しました。実Secretとキーprojectの照合は未確認、Developer API公式の動的履歴は未取得です。これらを完了済みとは報告しません。

追加物はこの調査文書・read-only audit.py・そのテストだけです。生成engine/モデル/プロファイル/timeout/IAM/既存Apps Script/TEST01〜03の記録を変更しません。研究結果のPR記録は行いますが、mainへマージせず、外部への問い合わせ送信も行いません。
