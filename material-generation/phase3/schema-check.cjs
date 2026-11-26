'use strict';
const {MASTER,HEADERS}=require('../core.cjs'),{fault}=require('./policy.cjs');
const SCHEMAS=Object.freeze({'教科書本文マスター':MASTER,'英単語':HEADERS.vocabulary,'英C本文QA':HEADERS.qa,'英作文問題':HEADERS.writing,'AI発展教材下書き':HEADERS.trueFalse});
function checkSchemas(tabs){
 if(!tabs||typeof tabs!=='object')throw fault(400,'5タブの読取結果が必要です');
 return Object.entries(SCHEMAS).map(([name,expected])=>{
  const found=tabs[name];if(!found||!Array.isArray(found.headers)||found.headers.length!==expected.length||found.headers.some((v,i)=>typeof v!=='string'||v.trim()!==expected[i])||!Number.isSafeInteger(found.rowCount)||found.rowCount<0)throw fault(400,'列構成または行数が不一致です：'+name);
  return {name,rowCount:found.rowCount,columns:expected.length,headersMatch:true};
 });
}
module.exports={SCHEMAS,checkSchemas};
