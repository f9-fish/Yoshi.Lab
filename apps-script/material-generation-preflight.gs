/** TEST01 preparation only. Never creates a spreadsheet, tab, trigger or job. */
var MG_TEST01_ID_='1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc';
var MG_TEST01_DEFAULTS_={MG_ENABLED:'false',MG_PREFLIGHT_ENABLED:'false',MG_MODE:'TEST',MG_AUTH_VERIFIED:'false',MG_JOB_STORAGE_VERIFIED:'false',MG_TEST_APPEND_ENABLED:'false',MG_SOURCE_SPREADSHEET_ID:MG_TEST01_ID_,MG_TEST_SPREADSHEET_ID:MG_TEST01_ID_,MG_SERVER_URL:'',MG_TEST_JOB_FOLDER_ID:'',MG_GENERATION_SETTINGS:'{"counts":{"vocabulary":0,"qa":0,"writing":10,"trueFalse":0,"discussion":0},"genre":"ミステリー","revision":1}'};
function mgInstallTest01Defaults(){
 var book=SpreadsheetApp.getActiveSpreadsheet();if(!book||book.getId()!==MG_TEST01_ID_)throw Error('作成済みTEST01のテスト用ブックから実行してください');
 var props=PropertiesService.getScriptProperties();if(props.getProperty('MG_ENABLED')==='true'||props.getProperty('MG_TEST_APPEND_ENABLED')==='true')throw Error('生成・追記が有効です。既存設定は変更しません');
 ['MG_SOURCE_SPREADSHEET_ID','MG_TEST_SPREADSHEET_ID'].forEach(function(key){var existing=props.getProperty(key);if(existing&&existing!==MG_TEST01_ID_)throw Error('別の接続先が設定済みです。自動変更しません');});
 var missing={};Object.keys(MG_TEST01_DEFAULTS_).forEach(function(key){if(props.getProperty(key)===null)missing[key]=MG_TEST01_DEFAULTS_[key];});props.setProperties(missing,false);return {installedKeys:Object.keys(missing),generationEnabled:false,testAppendAllowed:false};
}
function mgTest01Schema_(){
 var props=PropertiesService.getScriptProperties();['MG_SOURCE_SPREADSHEET_ID','MG_TEST_SPREADSHEET_ID'].forEach(function(key){var id=props.getProperty(key);if(id&&id!==MG_TEST01_ID_)throw Error('TEST01以外の読み取りはこの確認機能では行いません');});
 var book=SpreadsheetApp.openById(MG_TEST01_ID_),schemas={'教科書本文マスター':MG_HEADERS_.master,'英単語':['科目','単元ID','単元名','英単語','日本語訳','ヒント','公開設定','読み方'],'英C本文QA':MG_HEADERS_.qa,'英作文問題':MG_HEADERS_.writing,'AI発展教材下書き':MG_HEADERS_.trueFalse},tabs={},issues=[],groups={};
 Object.keys(schemas).forEach(function(name){var sheet=book.getSheetByName(name);if(!sheet){issues.push(name+'：タブなし');return;}var values=sheet.getDataRange().getValues(),headers=(values[0]||[]).map(function(v){return String(v).trim();}),expected=schemas[name];
  var ok=headers.length===expected.length&&headers.every(function(v,i){return v===expected[i];});if(!ok)issues.push(name+'：列名または列順が不一致');
  var rows=values.slice(1).filter(function(row){return row.some(function(v){return v!==''&&v!==null;});});tabs[name]={headers:headers,rowCount:rows.length,headersMatch:ok};
  if(name==='教科書本文マスター'&&ok)rows.forEach(function(row){var group=JSON.stringify([String(row[1]).trim(),String(row[2]).trim(),String(row[3]).trim().replace(/^part\s*/i,'')]);groups[group]=(groups[group]||0)+1;});
 });
 return {spreadsheetId:MG_TEST01_ID_,schemasOk:issues.length===0,tabs:tabs,groups:groups,issues:issues,writes:0,generationEnabled:false,testAppendAllowed:false};
}
function mgInspectTest01Sheet(){var report=mgTest01Schema_();console.log(JSON.stringify(report));SpreadsheetApp.getUi().alert(report.schemasOk?'5タブの列構成は一致しています。本文内容はログへ出していません。':'列構成を確認してください：'+report.issues.join('／'));return report;}
function mgShowAppsScriptAudience(){
 // Metadata discovery only, NOT an authentication decision. Never print/return the token.
 var token=ScriptApp.getIdentityToken();if(!token)throw Error('openidスコープと本人の承認が必要です');var parts=token.split('.');if(parts.length!==3)throw Error('本人トークンの形式が不正です');
 var encoded=parts[1];while(encoded.length%4)encoded+='=';var data=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8'));
 if(typeof data.aud!=='string'||!data.aud.endsWith('.apps.googleusercontent.com'))throw Error('Apps Scriptのaudienceを確認できません');
 var result={audience:data.aud,issuer:String(data.iss||''),signatureVerified:false,note:'認証判定には使いません。サーバーで署名検証します。'};console.log(JSON.stringify(result));SpreadsheetApp.getUi().alert('サーバーのMG_GOOGLE_AUDIENCEへ設定する値：\n'+result.audience+'\n本人トークン全体は共有しないでください');return result;
}
function mgCheckTest01Connection(){
 var p=PropertiesService.getScriptProperties();if(p.getProperty('MG_PREFLIGHT_ENABLED')!=='true'||p.getProperty('MG_MODE')!=='TEST'||p.getProperty('MG_ENABLED')==='true'||p.getProperty('MG_TEST_APPEND_ENABLED')==='true')throw Error('接続確認だけを有効にし、生成・追記は無効にしてください');
 var report=mgTest01Schema_();if(!report.schemasOk)throw Error('列構成が不一致です。先に読取確認をしてください');
 var url=p.getProperty('MG_SERVER_URL')||'';if(!/^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:\/[A-Za-z0-9/_-]*)?$/.test(url)||url.toLowerCase().indexOf('studioapi-bfaa4wjjga-an.a.run.app')>=0)throw Error('専用の接続確認HTTPSサーバーが必要です');
 var result=mgCall_({url:url.replace(/\/$/,'')},'preflight',{sourceSpreadsheetId:MG_TEST01_ID_,targetSpreadsheetId:MG_TEST01_ID_,tabs:report.tabs});
 if(result.mode!=='PREFLIGHT'||result.generationEnabled!==false||result.testAppendAllowed!==false||result.publishEnabled!==false||result.testSpreadsheetId!==MG_TEST01_ID_)throw Error('サーバーが接続確認専用状態ではありません');
 console.log(JSON.stringify(result));SpreadsheetApp.getUi().alert('署名・教員権限・5タブの読取結果を確認しました。生成・追記・公開は無効です。');return result;
}
function installMaterialPreparationMenu(){
 var book=SpreadsheetApp.getActiveSpreadsheet();if(!book||book.getId()!==MG_TEST01_ID_)throw Error('TEST01ブックだけにメニューを追加できます');
 SpreadsheetApp.getUi().createMenu('AI教材・接続準備').addItem('安全な初期設定を入れる','mgInstallTest01Defaults').addItem('5タブの列を読取確認','mgInspectTest01Sheet').addItem('OAuth audienceだけを確認','mgShowAppsScriptAudience').addItem('認証と接続だけを確認','mgCheckTest01Connection').addToUi();
}
