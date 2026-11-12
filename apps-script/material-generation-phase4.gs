/** Add ONLY to the existing TEST01 test project, alongside client + preflight helpers.
 * Sheets reads only; server-side GCS is the sole job store. No Drive scope needed.
 * No triggers, retry, append, publish, or token logging.
 */
function mgPhase4Config_(){
 var p=PropertiesService.getScriptProperties(),url=p.getProperty('MG_SERVER_URL')||'';
 if(p.getProperty('MG_MODE')!=='TEST'||p.getProperty('MG_TEST_SPREADSHEET_ID')!==MG_TEST01_ID_||p.getProperty('MG_SOURCE_SPREADSHEET_ID')!==MG_TEST01_ID_||p.getProperty('MG_TEST_APPEND_ENABLED')!=='false')throw Error('TEST01専用・追記無効の設定が必要です');
 if(!/^https:\/\/yoshilab-material-test01-[A-Za-z0-9.-]+\.run\.app$/.test(url))throw Error('既存TEST01 Cloud RunのHTTPS URLだけを設定してください');
 return {url:url,source:MG_TEST01_ID_,target:MG_TEST01_ID_};
}
function mgPhase4GenerateOnce(){return mgLocked_(function(){
 var cfg=mgPhase4Config_(),p=PropertiesService.getUserProperties();
 // Mark BEFORE sending any paid request. If a reply is lost, use status; never clear this marker.
 if(p.getProperty('MG_PHASE4_ATTEMPTED'))return mgPhase4Status();
 var selection={subject:'英C',unitId:'TEST01',part:'Part1'},master=mgReadMaster_(cfg,selection);
 if(master.length!==7)throw Error('英C / TEST01 / Part1は6文である必要があります');
 var job=mgCall_(cfg,'enqueue',{sourceSpreadsheetId:cfg.source,targetSpreadsheetId:cfg.target,master:master,selection:selection,settings:{counts:{vocabulary:0,qa:0,writing:10,trueFalse:0,discussion:0},genre:'ミステリー',difficulty:'英検準2級と2級の中間',revision:1}});
 p.setProperty('MG_PHASE4_JOB',job.jobId);
 if(job.state==='生成待ち'&&job.revision===0){p.setProperty('MG_PHASE4_ATTEMPTED','true');job=mgCall_(cfg,'step',{jobId:job.jobId,expectedRevision:0});}
 mgPhase4Log_(job);return job;
});}
function mgPhase4Status(){var cfg=mgPhase4Config_(),id=PropertiesService.getUserProperties().getProperty('MG_PHASE4_JOB');if(!id)throw Error('登録済みPhase 4ジョブがありません');var job=mgCall_(cfg,'get',{jobId:id});mgPhase4Log_(job);return job;}
function mgPhase4Log_(job){console.log(JSON.stringify({jobId:job.jobId,state:job.state,revision:job.revision,generated:job.report&&job.report.results.writing&&job.report.results.writing.generated||0,validationErrors:job.report&&job.report.errors.length||0,testAppendAllowed:false,publishEnabled:false}));}
