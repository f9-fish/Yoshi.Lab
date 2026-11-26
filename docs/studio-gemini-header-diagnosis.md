# studioApi の応答ヘッダー待ちの調査

11月26日 12:28:25 JSTに始まったHTTP要求は504（約56.38秒）。12:29:22 JSTの生成診断は `stage: headers`、55,004msでした。これは現在の関数が55秒までにGeminiのHTTPヘッダーを受信せず中断したことを示します。Gemini内部の処理開始・完了、HTTP 401/403/429/503、本文読み取り時間、実トークン数はこの診断から分かりません。LOWは導入済みとして記録の `profile` も照合します。原因が分かるまではコード・モデル・時間上限を維持します。

## Cloud Shellで読み取る

```sh
(
  set -eu
  work=$(mktemp -d)
  git clone --quiet --single-branch --branch ops/studio-gemini-header-diagnosis https://github.com/f9-fish/Yoshi.Lab.git "$work/repo"
  cd "$work/repo"
  python3 scripts/studio-gemini-header-diagnosis.py
)
```

Cloud Runの2026年11月26日12:25〜12:33 JSTのログを最大100件読み、生成診断と504要求の時刻、稼働リビジョン、固定ラベルと数値に絞ります。関連リビジョンのモデル一致、Secret参照の有無、VPCとプロキシ設定の有無も表示します。監査用トレースID、ユーザー、URL、本文やキーは出力しません。共通トレースで結べないログは同時刻の候補です。取得エラーとログ0件を区別します。ログ参照・Cloud Run参照の既存権限で実行してください。

## 調べる順番

1. **設定と起点**。対象リビジョンの `profile: low`、`stage: headers`、`outcome: deadline` とHTTP504を照合します。VPC全通信経由・プロキシがある場合は、既に保存されたDNS・NAT・ファイアウォールのログで、同時刻の接続確立・拒否・NAT枯渇を調べます。設定の有無だけでは通信到達を示せません。診断のためのログ有効化や設定変更は行いません。
2. **キー所属・認証**。Cloud Runの対象リビジョン → Variables & Secretsで、参照しているSecretとバージョンの**メタデータ**を確認します。そのバージョンを登録した作業記録、鍵台帳、AI Studioでの作成記録から、APIキーの**リソース名と所属プロジェクト**の対応を探します。Cloud Audit Logsに作成・Secret version追加の記録があれば補助として使います。同時刻・同じ作業者だけでは対応づけられません。対応が取れたら [API Keysのメタデータ](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys/get) でGenerative Language APIと制限を確認します。キーが1件だけ見えることやSecretの所属は証明になりません。キーの値取得、`lookupKey`、コピー、ハッシュ化は行いません。
3. **提供元と利用枠**。確認済みのキー所属プロジェクトを選び、[Usage](https://aistudio.google.com/usage) と [Rate Limit](https://aistudio.google.com/rate-limit) で `gemini-3.8-flash` の要求数・遅延・エラーコード・利用枠を調べます。Gemini Developer APIのAPIメトリクスも同時刻で確認します。プロジェクトが確認できた場合のみ、本ツールに `--key-project <確認済みID>` を渡すとAPIの有効状態も読み取れます。HTTP 401/403は認証・制限を、429は利用枠を、503や上流の長時間応答は提供元側を調べる根拠になります。集計の欠測・遅延があるため、件数0だけで通信未到達・障害なし・利用枠に余裕ありとは判断しません。
4. **公式情報**。[Geminiのステータス](https://aistudio.google.com/status) と [Google Cloudの障害情報](https://status.cloud.google.com/) を12:28〜12:30 JSTの該当製品で確認します。[Gemini 3.8 Flashの仕様](https://aistudio.google.com/docs/models/gemini-3.8-flash) と [思考設定](https://ai.google.dev/gemini-api/docs/thinking) でモデル名とLOW対応、[利用枠仕様](https://ai.google.dev/gemini-api/docs/rate-limits) とログイン後のプロジェクト表示で現行の上限を確認します。PR #77の調査時点ではこのモデルにLOW対応の記載がありました。今回の実行環境では公式ページに直接接続できず、現在の公開障害や対象プロジェクトの実利用枠は確認していません。

### 承認後の一回限りの試験案

既存ログで判断できない場合、キー所有が確認でき、費用・認証・モデルを承認できる場合だけ試します。既存のスタジオ生成ボタンは既存のFirebase利用回数枠を書き込むため使いません。既存の承認済みOAuth経路で同じプロジェクトのDeveloper APIを呼べることを確認し、Cloud Shellから以下を**一回だけ**行います。経路が確認できない場合は実行を保留します。OAuth試行は本番APIキー認証やCloud Runのネットワークを再現しないため、成功しても両者の正常性は証明しません。

```sh
(
  set +x
  set -eu
  key_project='<照合・費用承認済みのプロジェクトID>'
  token=$(gcloud auth application-default print-access-token --quiet)
  printf 'header = "Authorization: Bearer %s"\n' "$token" |
    curl --silent --show-error --config - --retry 0 --max-time 55 \
      --header "x-goog-user-project: $key_project" --header 'Content-Type: application/json' \
      --data '{"contents":[{"parts":[{"text":"Reply only with OK."}]}],"generationConfig":{"thinkingConfig":{"thinkingLevel":"LOW","includeThoughts":false},"maxOutputTokens":128}}' \
      --output /dev/null --write-out 'status=%{http_code} tcp=%{time_connect} tls=%{time_appconnect} first_byte=%{time_starttransfer} total=%{time_total}\n' \
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
)
```

明示したプロジェクトへ課金され得ます。ADCの権限や対応スコープが不明な状態では使いません。1回の結果で大きな生成の性能は分からないため、認証・利用枠・通信・提供側のどの仮説を絞れたかだけを記録します。
