/* Lazy Firebase callable bridge: no additional SDK/network setup while disabled. */
(()=>{
 'use strict';
 let setup,appCheck;
 const sdk='https://www.gstatic.com/firebasejs/13.1.0/';
 async function connect(config){
  const [apps,functions,check]=await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-functions.js'),import(sdk+'firebase-app-check.js')]);
  const app=apps.getApp();
  if(!appCheck)appCheck=check.initializeAppCheck(app,{provider:new check.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
  return functions.httpsCallable(functions.getFunctions(app,config.region),'reviewWriting',{timeout:24000,limitedUseAppCheckTokens:true});
 }
 async function review({question,answer,requestId}){
  const config=window.YoshiWritingAIConfig;
  if(!config?.enabled||!config.appCheckSiteKey)throw Error('AI unavailable');
  const user=window.YoshiAccount?.user;
  if(!user?.emailVerified)throw Error('Verified login required');
  const uid=user.uid,token=await user.getIdTokenResult();
  if(token.claims?.firebase?.sign_in_provider!=='google.com'||window.YoshiAccount?.user?.uid!==uid)throw Error('Google login required');
  const info={id:question.id,subject:question.subject,lesson:question.lesson,japanese:question.japanese,requiredExpressions:question.requiredExpressions,modelAnswer:question.modelAnswer,acceptedAnswers:question.acceptedAnswers,explanation:question.explanation};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(info)));
  const questionVersion=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!setup)setup=connect(config).catch(error=>{setup=null;throw error;});
  const callable=await setup;
  if(window.YoshiAccount?.user?.uid!==uid)throw Error('Login changed');
  // No question text, model answer, email, name or UID in the client payload.
  return (await callable({questionId:question.id,answer,requestId,questionVersion})).data;
 }
 window.YoshiWritingAI={review};
})();
