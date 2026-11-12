# TEST02の55秒タイムアウトと次の試行の対策

## 確認済みの事実

管理者ログ：`JOB-2dec5190f30262f22b7e6032f78c50c6`、TEST02、revision 1、エラー、生成0、検証エラー1。2026-11-12 22:35:13 JSTの診断はevent=timeout、elapsedMs=55002、httpStatus/providerStatus未取得、retryAttempted=false。

上流HTTPステータスを受け取る前にローカルの55,000ms期限でabortした経路です。TEST01のHTTP503とは別です。55秒を超えた理由が思考時間・混雑・通信のどれかは特定できません。中断しても上流が処理/課金していないとは保証しません。

TEST01・TEST02のサービス設定・予約・attempted・ジョブ・バケット・Apps Scriptはそのまま保存します。この変更で実Cloudへのアクセス、Gemini API呼出し、再試行、デプロイは行いません。

## 公式仕様の確認（公開ドキュメントのみ）

- <https://aistudio.google.com/docs/whats-new-gemini-3.8>：3.8 Flashはlow/medium/high対応、既定はmedium。minimalは非対応でエラーになります。lowは回答時間とトークン消費を抑える選択肢です。
- <https://ai.google.dev/api/generate-content#thinkingconfig>：既存のgenerateContent RESTでもgenerationConfig.thinkingConfig.thinkingLevelを使用し、enumは大文字LOW等。Interactions APIへ移行する必要はありません。
- <https://aistudio.google.com/docs/thinking#token-limits>：出力上限を小さくするだけでは思考量の適切な調整にならず、打切り・空回答を招きます。

これらは公開仕様の確認で、対象APIキーによる当該設定の実受理・速度・教材品質の実証ではありません。

## 実装した明示的な試行用プロファイル

`MG_GEMINI_PROFILE=writing-low-latency-v1` を将来の独立試行環境で**明示指定したときだけ**使用します。未設定/legacyは従来の55秒・出力上限12,000・思考設定未指定を維持し、既存Cloud設定を更新しません。プロファイルの誤指定・別モデル・別教材種類/問題数/本文はHTTP送信前に拒否します。

| 項目 | 従来 | 新プロファイル |
|---|---|---|
| モデル | gemini-3.8-flash | 同じ。自動置換なし |
| 思考量 | API既定（公式仕様ではmedium） | thinkingConfig.thinkingLevel=LOW |
| 思考本文 | 解析・ログ出力なし | includeThoughts=false、解析・ログ出力なし |
| クライアント期限 | 55,000ms | 90,000ms、超過時abort |
| maxOutputTokens | 12,000 | **12,000を維持** |
| 教材仕様 | ミステリー10問・全フィールド・難易度・起承転結 | 同じ |
| 文章量の指示 | 通常 | 別解1〜2、指定表現1〜3、短いヒント、日本語解説1〜2文、短い本文引用、物語各幕のメタデータ要約1文。必要項目を省略しない |
| 生成リクエスト数 | 1試行のみ | 同じ。503/timeout/MAX_TOKENSでも再試行なし |

英作文10問の日本語・模範解答・許容解答・指定表現・ヒント①②・解説・学習ターゲット・根拠を維持します。既存の構造化スキーマと検証をそのまま使用します。出力上限は思考と長い日本語JSONに余裕を残す判断で、上限引下げによる品質/打切りリスクを避けます。出力を常に12,000トークン使う指示ではありません。

## 診断の追加

安全なallowlistにprofile/thinkingLevel/headersElapsedMs/finishReasonと、prompt/candidate/thought/totalの数値トークン数を追加。MAX_TOKENS等でも定型finishReasonと数値usageをreport.errors[].diagnosticに保存します。思考本文・教材本文・上流メッセージ・任意の文字列・キー/トークン・教員情報はログに出しません。HTTPヘッダー未受信ならheadersElapsedMsも未取得です。APIがusageを返さなければ推定値を埋めません。

新しい診断を見る場合、将来の新サービス名を指定し、次の許可フィールドだけを投影してください（旧TEST01/02へ再リクエストするコマンドではありません）。

```text
timestamp, resource.labels.revision_name,
jsonPayload.profile, jsonPayload.thinkingLevel, jsonPayload.event,
jsonPayload.httpStatus, jsonPayload.finishReason,
jsonPayload.elapsedMs, jsonPayload.headersElapsedMs, jsonPayload.timeoutMs,
jsonPayload.maxOutputTokens, jsonPayload.promptTokenCount,
jsonPayload.candidatesTokenCount, jsonPayload.thoughtsTokenCount,
jsonPayload.totalTokenCount, jsonPayload.retryAttempted
```

## 次の独立試行の配置条件（今回は作成・実行しない）

TEST01/02を再配置・バケット切替・予約削除して試しません。将来のTEST03等は別サービス/専用SA/私有バケット/予約と、生成承認falseの初期配置を用意する別のレビュー対象にします。現在のdeployment.cjsはTEST01/02だけを許可しているため、TEST03という名前へ置換して既存スクリプトをそのまま実行することはできません。

次の構築変更で明示すべき設定：

```text
MG_GEMINI_MODEL=gemini-3.8-flash
MG_GEMINI_PROFILE=writing-low-latency-v1
MG_PHASE4_SINGLE_JOB=true
MG_GENERATION_APPROVED=false（初期配置）
MG_TEST_APPEND_ENABLED=false
Geminiのクライアント期限=90秒（プロファイル内で固定）
Cloud Run timeoutSeconds=180（将来の新サービスだけ）
```

認証は既存の最大5秒×3段階。Cloud Runは90秒のGemini通信と認証/保存用に余裕を持たせて180秒を推奨し、将来の配置検証で**実際の**spec.template.spec.timeoutSeconds=180を確認する必要があります。Nodeのserver.requestTimeoutは受信完了までの制限であり、ハンドラー全体の処理時間を制限するものではありません。Nodeの値を変更しただけでCloud Runの期限が延びるとは扱いません。Apps Scriptも実行時間上限内であることを確認します。GCS停止などの異常では処理完了を保証せず、成否不明は再生成せず確認します。

料金は <https://aistudio.google.com/docs/pricing> の対象モデルの現行価格と利用枠を再確認します。LOWや短い出力指示による費用/速度低下は期待であり、実測ではありません。出力上限は維持するため、待ち時間が長くなって課金対象の処理が完了する可能性もあります。Cloud Run/Build/GCS/Secret/ログの費用も別途必要です。

次の実生成は、新環境の具体的な構築変更・設定検査・費用確認と管理者の1試行承認後だけ行います。新プロファイルで生成した10問の文法/和英対応/自然さ/難易度/物語品質は改めて評価し、LOWで十分な品質かはその結果で判断します。
