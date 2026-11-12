# TEST03：2026-11-12 23:17〜23:18 JSTの失敗診断

対象は `JOB-dcb7e4afbc33a3565fb44a022b5cdcb2`、TEST03、gemini-3.8-flash/LOW/90秒、Cloud Run180秒。管理者報告は「エラー・生成0・検証エラー1」です。

**この件の原因はまだ未確定です。** Codexの環境にはgcloud/GCP認証/実行IDがなく、実Cloudのログ・GCSは直接読めません。ジョブのerrorsにはHTTP/timeoutだけでなく、取得済みJSONの教材検証エラーも入ります。生成0でも、10問の生JSONが私有GCSに保存済みの可能性があります。タイムアウトと推測して再試行しません。

## 管理者操作：Cloud Shellで次を1ブロック実行

ホーム/既存repoのどちらにいても実行できます。既存checkoutを変更せず、新しい一時ディレクトリに診断コードを取得し、読み取りだけを行います。audience/Secret番号/フラグの入力やApps Script編集は不要です。

```bash
(
  set -e
  diag_dir=$(mktemp -d /tmp/yoshilab-test03-diagnose.XXXXXX)
  git clone --quiet --depth 1 --single-branch \
    --branch feat/sheet-material-generation-phase3 \
    https://github.com/f9-fish/Yoshi.Lab.git "$diag_dir/repo"
  bash "$diag_dir/repo/material-generation/ops/test03/diagnose.sh"
)
```

標準出力のJSONだけを共有できます。APIキー/トークン/教員情報/教材本文/エラー全文/リクエストURLやIPを出さない投影を使っています。Cloud操作はRun describe・GCS cat・Logging readの6回だけで、Secret/モデルAPIの照会、Gemini生成、Cloud設定更新、ジョブ/予約/ロック/attemptedの更新/削除はしません。TEST01/02も読みません。

内部の一時ファイルはumask077の私有ディレクトリに作り、終了時に削除します。gcloudのstderrにアカウント情報が含まれる可能性があるため全文を表示せず、読めなかった節はREAD_FAILEDとして示し、ほかの節は続けます。部分失敗時には終了コード1です。権限を自動追加しません。

## 何を読み、どう判定するか

1. **run**：現在のTEST03モデル/profile/バケット/SA/単一試行/追記無効/Secret参照/Cloud Run秒数を固定値との一致で確認。現在のサービス設定なので、失敗時revisionとログのrevisionも照合します。
2. **job**：対象ID・状態・revision・候補数・エラーの分類。error.messageの全文は出さず、既知の固定文言を機械的なcodeへ変換します。
3. **savedResponseCheck**：checkpoint.rawResults.writingの有無・問題数。存在すれば、保存済み本文/設定と既存の純粋なvalidateResultをローカルで再実行し、最初の失敗codeだけ返します。Geminiを呼ばず、GCSにも書きません。教材の意味/自然さ/正確性の再評価ではありません。
4. **claim**：対象ジョブ一致・attempted・時刻だけ。
5. **gemini-logs**：UTC 14:10〜14:25（JST 23:10〜23:25）のTEST03診断をallowlistで要約。
6. **validation-logs / request-logs**：新しい検証失敗ログと、同時間帯のHTTP状態/所要時間/revision。修正前にはvalidation-logsが空でも正常です。

表示例の解釈：

| 診断 | 判明する範囲 |
|---|---|
| event=timeout、約90000ms、HTTP未取得 | クライアント期限による中断。遅延の内訳までは不明 |
| event=http_error、httpStatus=503 | 上流HTTP503。過負荷/停止は候補だが、個別原因を断定しない |
| httpStatus=400 | リクエスト/利用条件の拒否等。定型statusだけで不正パラメーターまでは断定しない |
| event=invalid_response、finishReason=MAX_TOKENS | 出力打切り。数値usageが返れば思考/出力使用量も確認 |
| APIログsuccess、savedResponseCheck.validationPassed=false | JSON取得後の教材検証で拒否。例えばSTORY_GENRE_MISMATCH、EVIDENCE_QUOTE_MISMATCH、ACCEPTED_REQUIRED_EXPRESSION_MISSING等 |
| savedResponseCheck.rawQuestionCount=10 | 生の10問は存在。0候補表示だけを根拠に再生成しない |
| code=UNCLASSIFIED / READ_FAILED / ログ欠損 | 情報不足。エラー全文を公開せず、次に必要な限定診断を検討 |

Cloud RunのHTTP200はジョブ返却の成功であり、Gemini/教材検証の成功を保証しません。claim.attempted=trueは引き続き保持します。

## 今回のコード修正

これまでのログはGeminiでSTOPのJSONを取得するとsuccessを記録する一方、その後の教材検証失敗を独立した安全ログへ記録していませんでした。この観測上の不足を修正し、今後配置するコードではmaterial_validation/rejectedと固定codeだけを記録します。report.errors[].validationにも同じ固定分類を追加します。loggerの例外は生成結果を変えず、再試行もしません。

既存の検証条件/難易度/教材仕様は緩和しません。今回の保存済みジョブを更新したり、過去ログを遡及追加する変更でもありません。既存のraw checkpointがある場合は新しい読み取り専用診断で再検証できます。

## 次回の生成テスト

実データの診断結果が来るまでは、TEST04等の作成、別モデル/timeoutへの切替、上限増加は行いません。原因が教材検証なら、既存JSONを非公開ローカルで調べることで新しい有料生成を避けられる可能性があります。

次の実生成が必要な場合は、原因に応じた修正をテストし、独立環境の設定/費用/1試行承認を具体的に確認してから進めます。既存TEST01〜03の再利用や試行記録リセットはしません。今回の診断は新環境・新しい生成の承認とは扱いません。
