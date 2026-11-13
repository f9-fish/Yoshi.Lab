'use strict';
// Builds an unscored teacher review form. Never approves a candidate automatically.
const CRITERIA=Object.freeze(['和英の意味対応','文法・語法','指定表現の自然さ','難易度','単独設問としての明確さ','別解・ヒント・解説','起承転結と意外性','原文や既存例文からの独立性']);
function writingReview(report){
 if(!report||!Array.isArray(report.candidates)||report.errors?.length)throw Error('検証済みでエラーのない候補が必要です');
 const items=report.candidates.filter(c=>c.type==='writing').sort((a,b)=>a.payload.sequence-b.payload.sequence);
 if(!items.length)throw Error('英作文候補がありません');
 return {batchId:report.batchId,sourceHash:report.sourceHash,actualModelId:null,reviewedAt:null,reviewer:null,state:'未評価',publishEnabled:false,criteria:CRITERIA.map(name=>({name,score:null,comment:''})),criticalIssues:[],teacherDecision:'未確認',story:items[0].story,questions:items.map(c=>({id:c.id,sequence:c.payload.sequence,act:c.payload.act,japanese:c.payload.japanese,modelAnswer:c.payload.modelAnswer,acceptedAnswers:c.payload.acceptedAnswers,requiredExpressions:c.payload.requiredExpressions,grammarHint:c.payload.hintGrammar,wordsHint:c.payload.hintWords,explanation:c.payload.explanation,evidence:c.payload.evidence,correction:''}))};
}
module.exports={CRITERIA,writingReview};
