/** Standalone TEST03 project ONLY. No TEST01 script imports/changes.
 * OAuth Sheets READONLY, no SpreadsheetApp/Drive/Sheets write service or triggers.
 */
var MG03_SOURCE_='1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc';
var MG03_HEADERS_={master:['原文ID','科目','単元ID','Part','文番号','教科書本文（英語）','日本語訳','重要文法・語句メモ','生成対象','備考'],vocabulary:['科目','単元ID','単元名','英単語','日本語訳','ヒント','公開設定','読み方'],qa:['問題ID','科目','単元ID','Part','問題番号','英語の質問','模範解答','許容解答','本文根拠・解説','公開状態'],writing:['問題ID','科目','単元ID','単元名','問題番号','日本語の問題文','指定語・表現','模範解答','許容解答','ヒント①（文型）','ヒント②（語句）','解説','公開状態'],trueFalse:['候補ID','科目','単元ID','Part','種別','英語の設問','模範解答・回答例','許容解答','ヒント①','ヒント②','解説','公開状態']};
function mg03Json_(url,options){var reply;try{reply=UrlFetchApp.fetch(url,options);}catch(e){throw Error('TEST03の通信に失敗しました。再生成せず状態を確認してください');}if(reply.getContentText().length>768000)throw Error('応答サイズ超過');if(reply.getResponseCode()!==200)throw Error('TEST03接続失敗 HTTP '+reply.getResponseCode());try{return JSON.parse(reply.getContentText());}catch(e){throw Error('応答JSONが不正です');}}
function mg03Read_(){
 var names=['教科書本文マスター','英単語','英C本文QA','英作文問題','AI発展教材下書き'],keys=['master','vocabulary','qa','writing','trueFalse'];
 var ranges=names.map(function(n,i){return "'"+n+"'!"+(i===0?'A:J':i===1?'A1:H1':i===2?'A1:J1':i===3?'A1:M1':'A1:M1');});
 var url='https://sheets.googleapis.com/v4/spreadsheets/'+MG03_SOURCE_+'/values:batchGet?'+ranges.map(function(r){return 'ranges='+encodeURIComponent(r);}).join('&');
 var data=mg03Json_(url,{method:'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false}),tabs={},master;
 if(!data.valueRanges||data.valueRanges.length!==5)throw Error('5タブの読取結果が不足しています');
 data.valueRanges.forEach(function(v,i){var values=v.values||[],headers=values[0]||[],expected=MG03_HEADERS_[keys[i]];if(headers.length!==expected.length||headers.some(function(h,j){return String(h).trim()!==expected[j];}))throw Error('列構成が不一致です');if(i===0){master=[headers].concat(values.slice(1).filter(function(r){return String(r[1]).trim()==='英C'&&String(r[2]).trim()==='TEST01'&&String(r[3]).trim().replace(/^part\s*/i,'')==='1';}));}tabs[names[i]]={headers:headers,rowCount:0};});
 if(master.length!==7)throw Error('英C / TEST01 / Part1は6文である必要があります');tabs[names[0]].rowCount=6;
 return {master:master,tabs:tabs};
}
function mg03Audience_(){var token=ScriptApp.getIdentityToken();if(!token)throw Error('openid承認が必要です');try{var encoded=token.split('.')[1];while(encoded.length%4)encoded+='=';var p=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8'));if(typeof p.aud!=='string'||!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(p.aud))throw Error('invalid');return p.aud;}catch(e){throw Error('audienceを確認できません');}}
function mg03Inspect(){var data=mg03Read_(),result={environment:'TEST03',audience:mg03Audience_(),signatureVerified:false,sourceRows:data.master.length-1,headersMatch:true,sheetsReadOnly:true};console.log(JSON.stringify(result));return result;}
function mg03Config_(){var p=PropertiesService.getScriptProperties(),url=p.getProperty('MG03_SERVER_URL')||'';if(!/^https:\/\/yoshilab-material-test03-[A-Za-z0-9.-]+\.run\.app$/.test(url))throw Error('TEST03専用Cloud Run URLを設定してください');return {url:url};}
function mg03Call_(action,body){var cfg=mg03Config_(),token=ScriptApp.getIdentityToken();if(!token)throw Error('本人トークンがありません');var result=mg03Json_(cfg.url+'/'+action,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(body),muteHttpExceptions:true,followRedirects:false});if(result.environment!=='TEST03')throw Error('サーバーがTEST03ではありません');return result;}
function mg03CheckConnection(){var data=mg03Read_(),r=mg03Call_('preflight',{sourceSpreadsheetId:MG03_SOURCE_,targetSpreadsheetId:MG03_SOURCE_,tabs:data.tabs});if(r.authenticated!==true||r.teacherVerified!==true||r.testAppendAllowed!==false||r.publishEnabled!==false||r.vocabularyAppendAllowed!==false)throw Error('TEST03の認証・保護設定が不一致です');console.log(JSON.stringify({environment:'TEST03',authenticated:true,teacherVerified:true,generationEnabled:r.generationEnabled===true,testAppendAllowed:false,publishEnabled:false}));return r;}
function mg03GenerateOnce(){
 var lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('処理中です');try{
  var user=PropertiesService.getUserProperties();if(user.getProperty('MG03_ATTEMPTED'))return mg03Status();
  var data=mg03Read_(),job=mg03Call_('enqueue',{sourceSpreadsheetId:MG03_SOURCE_,targetSpreadsheetId:MG03_SOURCE_,master:data.master,selection:{subject:'英C',unitId:'TEST01',part:'Part1'},settings:{counts:{vocabulary:0,qa:0,writing:10,trueFalse:0,discussion:0},genre:'ミステリー',difficulty:'英検準2級と2級の中間',revision:1}});
  if(!/^JOB-[a-f0-9]{32}$/.test(job.jobId||''))throw Error('ジョブIDが不正です');user.setProperty('MG03_JOB',job.jobId);
  if(job.state==='生成待ち'&&job.revision===0){user.setProperty('MG03_ATTEMPTED','true');job=mg03Call_('step',{jobId:job.jobId,expectedRevision:0});}
  mg03Log_(job);return job;
 }finally{lock.releaseLock();}
}
function mg03Status(){var id=PropertiesService.getUserProperties().getProperty('MG03_JOB');if(!/^JOB-[a-f0-9]{32}$/.test(id||''))throw Error('登録済みジョブがありません');var job=mg03Call_('get',{jobId:id});mg03Log_(job);return job;}
function mg03Log_(job){console.log(JSON.stringify({environment:'TEST03',jobId:job.jobId,state:job.state,revision:job.revision,generated:job.report&&job.report.results.writing&&job.report.results.writing.generated||0,validationErrors:job.report&&job.report.errors.length||0,testAppendAllowed:false,publishEnabled:false}));}
