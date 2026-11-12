'use strict';
const {fault}=require('../phase3/policy.cjs');
const TEST_ID='1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc';
const SINGLE_KEY='PHASE4-TEST01';
const SETTINGS=Object.freeze({counts:{vocabulary:0,qa:0,writing:10,trueFalse:0,discussion:0},genre:'ミステリー',difficulty:'英検準2級と2級の中間',revision:1});
function checkInput(body,source,config){
 if(body.sourceSpreadsheetId!==TEST_ID||body.targetSpreadsheetId!==TEST_ID||source.subject!=='英C'||source.unitId!=='TEST01'||source.part!=='1'||source.rows.length!==6)throw fault(400,'Phase 4はTEST01・英C・Part1の6文だけです');
 if(Object.entries(SETTINGS.counts).some(([k,v])=>body.settings?.counts?.[k]!==v||config.counts[k]!==v)||config.genre!==SETTINGS.genre||config.difficulty!==SETTINGS.difficulty||config.revision!==1)throw fault(400,'Phase 4は英作文10問・ミステリー・指定難易度・revision 1だけです');
}
function checkOptions({allowedTestIds,allowedSourceIds,testAppendEnabled,preflightOnly}){
 if(preflightOnly||testAppendEnabled||allowedTestIds.length!==1||allowedTestIds[0]!==TEST_ID||allowedSourceIds.length!==1||allowedSourceIds[0]!==TEST_ID)throw Error('Phase 4はTEST01専用・追記無効で実行してください');
}
function keyFor(environment='TEST01'){if(!['TEST01','TEST02','TEST03'].includes(environment))throw Error('未承認のテスト環境です');return 'PHASE4-'+environment;}
module.exports={TEST_ID,SINGLE_KEY,SETTINGS,checkInput,checkOptions,keyFor};
