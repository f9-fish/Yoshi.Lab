'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {defineSecret,defineBoolean,defineInt}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {createReviewService,ReviewError}=require('./review-core.cjs');
const {createQuota}=require('./quota.cjs');
const {createOpenAI}=require('./openai.cjs');
const app=initializeApp();
const apiKey=defineSecret('OPENAI_API_KEY');
const enabled=defineBoolean('WRITING_AI_ENABLED',{default:false});
const dailyLimit=defineInt('WRITING_AI_DAILY_LIMIT',{default:10});
const globalLimit=defineInt('WRITING_AI_GLOBAL_DAILY_LIMIT',{default:200});
const quota=createQuota(getFirestore(app,'writing-ai'));
const review=createReviewService({questions:require('./data/writing_questions.json'),...quota,callOpenAI:createOpenAI({apiKey:()=>apiKey.value()}),enabled:()=>enabled.value(),dailyLimit:()=>dailyLimit.value(),globalLimit:()=>globalLimit.value()});
exports.reviewWriting=onCall({region:'asia-northeast1',secrets:[apiKey],enforceAppCheck:true,consumeAppCheckToken:true,timeoutSeconds:30,memory:'256MiB',maxInstances:3,concurrency:10,cors:['https://f9-fish.github.io'],invoker:'public'},async request=>{
 try{return await review(request);}catch(error){
  if(error instanceof ReviewError)throw new HttpsError(error.code,error.message);
  // Deliberately no request, identity, answer or provider error logs.
  throw new HttpsError('unavailable','AI添削を利用できませんでした。');
 }
});
