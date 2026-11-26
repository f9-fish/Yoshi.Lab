/** Phase 3 TEST client. Add to a NEW test Apps Script project only after admin review.
 * No onOpen/onEdit hook, trigger installation, production writes or publication.
 * Requires explicit TEST properties + separate test workbook + private job folder.
 */
var MG_PRODUCTION_IDS_=['1QK19vwZlG5_7uURKLi33W1zutKtAin5sKo8kbULVTrU','1ON-F_R4CENHAS8fJ-V74ko75qSIJKl_QqRri4MO56lw'];
var MG_HEADERS_={master:['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）','日本語訳','重要文法・語句メモ','生成対象','備考'],qa:['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','本文根拠・解説','公開状態'],writing:['問題ID','科目','単元ID','単元名','問題番号','日本語の問題文','指定語・表現','模範解答','許容解答','ヒント①（文型）','ヒント②（語句）','解説','公開状態'],trueFalse:['候補ID','科目','単元ID','Part','種別','英語の設問','模範解答・回答例','許容解答','ヒント①','ヒント②','解説','公開状態']};
var MG_TABS_={qa:'英C本文QA',writing:'英作文問題',trueFalse:'AI発展教材下書き'};
function installMaterialGenerationMenu(){SpreadsheetApp.getUi().createMenu('AI教材生成（テスト）').addItem('選択した本文の生成ジョブを登録','mgEnqueue').addItem('次の1種類を生成／状態を取得','mgRunWorker').addItem('自分のジョブを選ぶ','mgChooseJob').addItem('追記プレビュー','mgPreviewAppend').addItem('テスト用タブへ要確認で追記','mgAppendTestDrafts').addToUi();}
function mgConfig_(){
 var p=PropertiesService.getScriptProperties(),source=p.getProperty('MG_SOURCE_SPREADSHEET_ID'),target=p.getProperty('MG_TEST_SPREADSHEET_ID'),url=p.getProperty('MG_SERVER_URL')||'';
 if(p.getProperty('MG_ENABLED')!=='true'||p.getProperty('MG_MODE')!=='TEST'||p.getProperty('MG_AUTH_VERIFIED')!=='true'||p.getProperty('MG_JOB_STORAGE_VERIFIED')!=='true')throw Error('シート連携は無効です。管理者確認が必要です');
 if(!source||!target||MG_PRODUCTION_IDS_.indexOf(target)>=0)throw Error('本番ではないテスト用シートが必要です');
 if(!/^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:\/[A-Za-z0-9/_-]*)?$/.test(url)||url.toLowerCase().indexOf('studioapi-bfaa4wjjga-an.a.run.app')>=0)throw Error('確認済みの専用HTTPSサーバーが必要です。既存studioApiには接続しません');
 var folder=p.getProperty('MG_TEST_JOB_FOLDER_ID');if(!folder)throw Error('教員本人だけのテスト用ジョブ保存フォルダが必要です');
 return {source:source,target:target,url:url.replace(/\/$/,''),folder:folder,append:p.getProperty('MG_TEST_APPEND_ENABLED')==='true',settings:JSON.parse(p.getProperty('MG_GENERATION_SETTINGS')||'{}')};
}
function mgLocked_(fn){var lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('別の処理が実行中です');try{return fn();}finally{lock.releaseLock();}}
function mgHeader_(values,expected){var h=(values[0]||[]).map(String);if(h.length!==expected.length||h.some(function(v,i){return v.trim()!==expected[i];}))throw Error('実ヘッダーが確認済みの列と異なります。列を変更せず管理者に確認してください');return h;}
function mgReadMaster_(cfg,selection){
 var sheet=SpreadsheetApp.openById(cfg.source).getSheetByName('教科書本文マスター');if(!sheet)throw Error('本文マスターがありません');var values=sheet.getDataRange().getValues();mgHeader_(values,MG_HEADERS_.master);
 var part=function(v){return String(v).trim().replace(/^part\s*/i,'');};
 return [values[0]].concat(values.slice(1).filter(function(r){return String(r[1]).trim()===selection.subject&&String(r[2]).trim()===selection.unitId&&part(r[3])===part(selection.part);}));
}
function mgCall_(cfg,action,body){
 var token=ScriptApp.getIdentityToken();if(!token)throw Error('本人トークンがありません。openid・メール権限とOAuth設定を確認してください');
 var response=UrlFetchApp.fetch(cfg.url+'/'+action,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(body),muteHttpExceptions:true});
 if(response.getContentText().length>768000)throw Error('応答が大きすぎます');
 var data;try{data=JSON.parse(response.getContentText());}catch(e){throw Error('サーバー応答が不正です');}
 if(response.getResponseCode()!==200)throw Error(data.error||'サーバー処理に失敗しました');return data;
}
function mgJobFile_(cfg,id,create){
 if(!/^JOB-[a-f0-9]{32}$/.test(id))throw Error('ジョブIDが不正です');var folder=DriveApp.getFolderById(cfg.folder),files=folder.getFilesByName('mg-'+id+'.json');
 if(files.hasNext()){var file=files.next();if(files.hasNext())throw Error('ジョブ保存ファイルが重複しています');return file;}
 if(!create)throw Error('ジョブ保存ファイルがありません');return folder.createFile('mg-'+id+'.json','{}','application/json');
}
function mgSave_(cfg,job){mgJobFile_(cfg,job.jobId,true).setContent(JSON.stringify(job));PropertiesService.getUserProperties().setProperty('MG_LAST_JOB',job.jobId);}
function mgLast_(cfg){var id=PropertiesService.getUserProperties().getProperty('MG_LAST_JOB');if(!id)throw Error('自分の生成ジョブを登録してください');var job=JSON.parse(mgJobFile_(cfg,id,false).getBlob().getDataAsString('UTF-8'));if(job.jobId!==id||job.targetSpreadsheetId!==cfg.target||job.sourceSpreadsheetId!==cfg.source)throw Error('ジョブと接続先が不一致です');return job;}
function mgEnqueue(){return mgLocked_(function(){
 var cfg=mgConfig_(),active=SpreadsheetApp.getActiveSpreadsheet();if((active.getId()!==cfg.source&&active.getId()!==cfg.target)||active.getActiveSheet().getName()!=='教科書本文マスター'||active.getActiveRange().getRow()<2)throw Error('読み取り元の本文マスターで対象行を選んでください');
 var row=active.getActiveSheet().getRange(active.getActiveRange().getRow(),1,1,10).getValues()[0],selection={subject:String(row[1]).trim(),unitId:String(row[2]).trim(),part:String(row[3]).trim()};
 var props=PropertiesService.getUserProperties(),queue=JSON.parse(props.getProperty('MG_QUEUE')||'[]');if(queue.length>=50)throw Error('ジョブが50件あります。既存ジョブを選ぶか、管理者と保管・整理してください');
 var reply=mgCall_(cfg,'enqueue',{sourceSpreadsheetId:cfg.source,targetSpreadsheetId:cfg.target,master:mgReadMaster_(cfg,selection),selection:selection,settings:cfg.settings});
 if(reply.targetSpreadsheetId!==cfg.target)throw Error('サーバーの保存先が不一致です');reply.sourceSpreadsheetId=cfg.source;reply.selection=selection;if(queue.indexOf(reply.jobId)<0){queue.push(reply.jobId);props.setProperty('MG_QUEUE',JSON.stringify(queue));}mgSave_(cfg,reply);SpreadsheetApp.getUi().alert('ジョブ登録：'+reply.jobId+'\n状態：'+reply.state+'\n英単語は同期確認まで追記しません');return reply;
});}
function mgRunWorker(){
 var initialCfg=mgConfig_(),initialLocal=mgLast_(initialCfg),initial=mgCall_(initialCfg,'get',{jobId:initialLocal.jobId}),retry=false;
 if(initial.state==='エラー'){var confirmUi=SpreadsheetApp.getUi();if(confirmUi.alert('再試行','前回の成否によってはAI料金が重複します。失敗した種類を再試行しますか？',confirmUi.ButtonSet.YES_NO)!==confirmUi.Button.YES)return;retry=true;}
 var result=mgLocked_(function(){
  var cfg=mgConfig_(),local=mgLast_(cfg);if(local.jobId!==initialLocal.jobId)throw Error('選択ジョブが変わりました');var current=mgCall_(cfg,'get',{jobId:local.jobId});
  if(current.state==='生成中')throw Error('前回処理が未確定です。再生成せず管理者に確認してください');
  var next=current;if(current.revision===initial.revision&&current.state!=='要確認')next=mgCall_(cfg,'step',{jobId:local.jobId,expectedRevision:current.revision,retryAcknowledged:retry});
  next.sourceSpreadsheetId=cfg.source;next.selection=local.selection;mgSave_(cfg,next);return next;
 });SpreadsheetApp.getUi().alert('状態：'+result.state+'\nジョブ：'+result.jobId);return result;
}
function mgTables_(cfg){var book=SpreadsheetApp.openById(cfg.target),tables={};Object.keys(MG_TABS_).forEach(function(type){var name=MG_TABS_[type],sheet=book.getSheetByName(name);if(!sheet)throw Error('テスト先タブがありません：'+name);var values=sheet.getDataRange().getValues();tables[type]={name:name,headers:mgHeader_(values,MG_HEADERS_[type]),rows:values.slice(1)};});return tables;}
function mgMakePlan_(cfg,job){var master=mgReadMaster_(cfg,job.selection),result=mgCall_(cfg,'plan',{jobId:job.jobId,master:master,tables:mgTables_(cfg)});result.clientMasterHash=mgHash_(master);return result;}
function mgPreviewAppend(){return mgLocked_(function(){var cfg=mgConfig_(),job=mgLast_(cfg),result=mgMakePlan_(cfg,job),summary=Object.keys(result.plans).map(function(t){var d=result.plans[t].diff;return MG_TABS_[t]+'：追加'+d.added+'・変更'+d.changed+'・削除'+d.deleted+'・重複'+d.duplicates;}).join('\n');SpreadsheetApp.getUi().alert(summary+'\n英単語：追記保留／全候補は要確認です');return result;});}
function mgCanonical_(value){return JSON.stringify(value,function(k,v){if(v&&typeof v==='object'&&!Array.isArray(v)){var out={};Object.keys(v).sort().forEach(function(name){out[name]=v[name];});return out;}return v;});}
function mgHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,mgCanonical_(value),Utilities.Charset.UTF_8).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');}
function mgAppendTestDrafts(){
 // UI dialogs suspend Apps Script and release LockService locks: confirm BEFORE locking.
 var initialCfg=mgConfig_();if(!initialCfg.append)throw Error('テスト追記は無効です。管理者の確認が必要です');var initialJob=mgLast_(initialCfg),preview=mgMakePlan_(initialCfg,initialJob);
 if(preview.targetSpreadsheetId!==initialCfg.target||preview.testAppendAllowed!==true)throw Error('サーバー側のテスト追記許可がありません');
 var ui=SpreadsheetApp.getUi();if(ui.alert('テスト用シートのみ','本番ではない '+initialCfg.target+' に要確認行を追記します。よろしいですか？',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
 var result=mgLocked_(function(){
  var cfg=mgConfig_();if(!cfg.append||cfg.target!==initialCfg.target)throw Error('テスト追記設定が変わりました');var job=mgLast_(cfg);if(job.jobId!==initialJob.jobId)throw Error('選択ジョブが変わりました');var fresh=mgMakePlan_(cfg,job);
  if(mgHash_(fresh)!==mgHash_(preview))throw Error('確認中にデータが変更されています。再プレビューしてください');
  var completed=[];
  try{Object.keys(fresh.plans).forEach(function(type){
   if(mgHash_(mgReadMaster_(cfg,job.selection))!==fresh.clientMasterHash)throw Error('元本文が変更されています。新しい生成ジョブが必要です');
   if(!MG_TABS_[type]||type==='vocabulary')throw Error('未承認のタブです');var plan=fresh.plans[type],live=mgTables_(cfg)[type];
   if(mgHash_({headers:live.headers,rows:live.rows})!==plan.baseHash)throw Error('シートが変更されています。再プレビューしてください');
   if(plan.diff.changed||plan.diff.deleted||plan.additions.some(function(row){return row[row.length-1]!=='要確認';}))throw Error('未承認追記以外の変更を拒否しました');
   if(plan.additions.length){
    Sheets.Spreadsheets.Values.append({values:plan.additions},cfg.target,"'"+MG_TABS_[type]+"'!A"+(live.rows.length+1)+':'+mgColumn_(live.headers.length)+(live.rows.length+1),{valueInputOption:'RAW',insertDataOption:'INSERT_ROWS'});
    var after=mgTables_(cfg)[type];if(after.rows.length<live.rows.length+plan.additions.length||mgCanonical_(after.rows.slice(0,live.rows.length))!==mgCanonical_(live.rows))throw Error('追記後の既存行が不一致です。自動復旧せず管理者確認が必要です');
    if(plan.additions.some(function(row){return !after.rows.some(function(r){return mgHash_(r)===mgHash_(row);});}))throw Error('追記行の確認ができません。再プレビューで成否を確認してください');
    if(mgHash_(mgReadMaster_(cfg,job.selection))!==fresh.clientMasterHash)throw Error('追記中に元本文が変更されました。管理者確認が必要です');
   }
   completed.push(type);job.testAppendCompleted=completed;mgSave_(cfg,job);
  });}catch(e){job.lastError='追記中断：'+e.message;mgSave_(cfg,job);throw e;}
  return fresh;
 });ui.alert('テスト追記完了。全件要確認です。英単語・教材公開は未実施です');return result;
}
function mgChooseJob(){return mgLocked_(function(){var cfg=mgConfig_(),props=PropertiesService.getUserProperties(),queue=JSON.parse(props.getProperty('MG_QUEUE')||'[]'),ui=SpreadsheetApp.getUi(),reply=ui.prompt('自分のジョブID',queue.join('\n'),ui.ButtonSet.OK_CANCEL);if(reply.getSelectedButton()!==ui.Button.OK)return;var id=reply.getResponseText().trim();if(queue.indexOf(id)<0)throw Error('自分の登録済みジョブを選んでください');mgCall_(cfg,'get',{jobId:id});props.setProperty('MG_LAST_JOB',id);return mgLast_(cfg);});}
// Optional timed worker, NOT installed by this file. One new kind, own queue only, no automatic retries.
function mgTick(){return mgLocked_(function(){var cfg=mgConfig_(),props=PropertiesService.getUserProperties(),queue=JSON.parse(props.getProperty('MG_QUEUE')||'[]');for(var i=0;i<queue.length;i++){var local=JSON.parse(mgJobFile_(cfg,queue[i],false).getBlob().getDataAsString('UTF-8'));if(local.targetSpreadsheetId!==cfg.target||local.sourceSpreadsheetId!==cfg.source)continue;var current=mgCall_(cfg,'get',{jobId:local.jobId});if(current.state!=='生成待ち')continue;var next=mgCall_(cfg,'step',{jobId:local.jobId,expectedRevision:current.revision,retryAcknowledged:false});next.sourceSpreadsheetId=cfg.source;next.selection=local.selection;mgSave_(cfg,next);return next;}return {state:'待機'};});}

function mgColumn_(number){var label='';while(number>0){number--;label=String.fromCharCode(65+number%26)+label;number=Math.floor(number/26);}return label;}
