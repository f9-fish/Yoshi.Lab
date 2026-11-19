'use strict';
// Canonical codes only. Never log exception text, source IDs, answers or user data.
const MESSAGES=new Map([
 ['物語構成がありません','STORY_MISSING'],['指定ジャンルと一致しません','STORY_GENRE_MISMATCH'],
 ['本文根拠が必要です','EVIDENCE_MISSING'],['存在しない原文IDです','EVIDENCE_SOURCE_UNKNOWN'],['根拠引用が本文と一致しません','EVIDENCE_QUOTE_MISMATCH'],
 ['英作文の物語順序が不正です','SEQUENCE_INVALID'],['起承転結が不正です','ACT_INVALID'],['物語は起承転結を順番に含めてください','ACT_ORDER_INVALID'],
 ['英作文の模範解答が重複しています','ANSWER_DUPLICATE'],['模範解答が指定表現を使用していません','MODEL_REQUIRED_EXPRESSION_MISSING'],['別解が指定表現を使用していません','ACCEPTED_REQUIRED_EXPRESSION_MISSING'],
 ['英作文が本文の複製です。新しいオリジナル文にしてください','SOURCE_COPY'],['学習ターゲットが必要です','TARGETS_MISSING'],['同じ生成結果に重複問題があります','QUESTION_DUPLICATE'],['問題が不正です','ITEM_INVALID']
]);
const FIELDS=['物語 title','物語 genre','物語 opening','物語 development','物語 twist','物語 ending','模範解答','日本語の問題文','文法ヒント','語句ヒント','解説','根拠引用','不足理由','指定表現','許容解答','学習ターゲット'];
function validationCode(message){
 if(MESSAGES.has(message))return MESSAGES.get(message);
 if(['vocabulary','qa','writing','trueFalse','discussion'].some(t=>message===t+'の問題数が指定数を超過・形式不正です'))return 'ITEM_COUNT_OR_FORMAT';
 if(FIELDS.some(f=>message===f+'が未入力・長すぎます'))return 'FIELD_MISSING_OR_TOO_LONG';
 if(['指定表現','許容解答','学習ターゲット'].some(f=>message===f+'は配列で指定してください'))return 'ARRAY_INVALID';
 return 'UNCLASSIFIED';
}
function validationDiagnostic(type,message){return {component:'material_validation',event:'rejected',type:['vocabulary','qa','writing','trueFalse','discussion'].includes(type)?type:'unknown',code:validationCode(message)};}
const CODES=new Set([...MESSAGES.values(),'ITEM_COUNT_OR_FORMAT','FIELD_MISSING_OR_TOO_LONG','ARRAY_INVALID','UNCLASSIFIED']);
const safeValidationCode=code=>CODES.has(code)?code:'UNCLASSIFIED';
module.exports={validationCode,validationDiagnostic,safeValidationCode};
