'use strict';
const {writingReview}=require('../phase3/writing-review.cjs');
function review(job){
 const report=job.report;if(!report)throw Error('生成結果がまだ保存されていません');
 const candidates=report.candidates.filter(c=>c.type==='writing');
 const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
 const checks={validationPassed:report.errors.length===0,tenQuestions:candidates.length===10,writingOnly:candidates.length===report.candidates.length,requiredFields:candidates.length>0&&candidates.every(c=>c.payload.acceptedAnswers.length>0&&c.payload.requiredExpressions.length>0),oneSentenceEach:candidates.length>0&&candidates.every(c=>[...segmenter.segment(c.payload.modelAnswer)].length===1),actualModelRecorded:!!report.generation?.actualModelId};
 let form=null;if(checks.validationPassed&&candidates.length)form=writingReview(report);
 if(form){form.actualModelId=report.generation?.actualModelId||null;form.generation=report.generation;}
 return {jobId:job.id||job.jobId,sourceHash:job.sourceHash,checks,structuralChecksPassed:Object.values(checks).every(Boolean),humanReviewRequired:true,appendEnabled:false,publishEnabled:false,validationErrors:report.errors,review:form};
}
if(require.main===module){try{const fs=require('node:fs'),job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));process.stdout.write(JSON.stringify(review(job),null,2)+'\n');}catch{console.error('保存済みジョブから評価票を作成できません。元データを確認してください。');process.exitCode=1;}}
module.exports={review};
