(()=>{
 'use strict';
 let connect,appCheck;
 const sdk='https://www.gstatic.com/firebasejs/13.1.0/';
 function available(){const c=window.YoshiPairQAConfig;return !!(c?.enabled&&c.appCheckSiteKey);}
 async function call(app,data){
  if(!available())throw Error('本文Q&Aは準備中です。');
  if(!connect)connect=Promise.all([import(sdk+'firebase-functions.js'),import(sdk+'firebase-app-check.js')]).then(([f,a])=>{
   if(!appCheck)appCheck=a.initializeAppCheck(app,{provider:new a.ReCaptchaEnterpriseProvider(window.YoshiPairQAConfig.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
   return f.httpsCallable(f.getFunctions(app,window.YoshiPairQAConfig.region),'pairTextQA',{timeout:15000});
  }).catch(error=>{connect=null;throw error;});
  return (await (await connect)(data)).data;
 }
 function watch(app,code,accept,error){
  let stopped=false,timer=null,failures=0;
  async function poll(){
   try{const value=await call(app,{action:'get',code});if(!stopped){failures=0;accept(value);if(value.state?.started&&value.state.index>=value.count)stopped=true;}}
   catch(e){if(!stopped){failures++;const terminal=['not-found','permission-denied','unauthenticated','failed-precondition'].some(code=>String(e?.code||'').endsWith(code));if(terminal||failures>=8)stopped=true;error(e,{stopped});}}
   finally{if(!stopped)timer=setTimeout(poll,failures?Math.min(30000,1500*2**failures):1500);}
  }
  void poll();return ()=>{stopped=true;clearTimeout(timer);};
 }
 function catalog(data){if(!Array.isArray(data))throw Error('Q&A目録の形式が不正です');return data.filter(q=>q&&q.subject==='英C'&&typeof q.lesson==='string'&&typeof q.part==='string'&&Number.isInteger(q.count)&&q.count>0&&/^[a-f0-9]{64}$/.test(q.version)).map(({subject,lesson,part,count,version})=>({subject,lesson,part,count,version}));}
 window.YoshiPairQA={available,call,watch,catalog};
})();
