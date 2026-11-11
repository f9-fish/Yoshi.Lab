import {onRequest} from 'firebase-functions/v2/https';
import {defineSecret} from 'firebase-functions/params';
import {initializeApp,getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getDatabase} from 'firebase-admin/database';
import {makeFiles,modelPrompt,validateDraft,validateQuestions} from './studio-core.js';
if(!getApps().length)initializeApp();
const geminiKey=defineSecret('STUDIO_GEMINI_API_KEY');
const githubToken=defineSecret('STUDIO_GITHUB_TOKEN');
const repo=process.env.STUDIO_GITHUB_REPOSITORY||'f9-fish/Yoshi.Lab';
const branch=process.env.STUDIO_GITHUB_BRANCH||'main';
const origins=(process.env.STUDIO_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
const json=(res,status,body)=>res.status(status).json(body);
async function github(method,path,body){
 const result=await fetch('https://api.github.com/repos/'+repo+path,{method,headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+githubToken.value(),'X-GitHub-Api-Version':'2022-11-28','User-Agent':'YoshiLab-Studio'},body:body?JSON.stringify(body):undefined});
 const data=await result.json().catch(()=>({}));
 if(!result.ok){if(result.status===409||result.status===422)throw Object.assign(Error('GitHub更新の競合またはブランチ保護です。再読み込みして再試行してください'),{status:409});throw Object.assign(Error('GitHub操作に失敗しました（'+result.status+'）'),{status:502})}
 return data;
}
async function publish(input){
 const path=x=>'/git/'+x;
 const ref=await github('GET',path('ref/heads/'+encodeURIComponent(branch)));
 const head=ref.object.sha;
 const commit=await github('GET',path('commits/'+head));
 const required=['lessons.json','vocabulary.json','ronpyo_text.json','ronpyo_vocab.json','studio-materials.json'];
 const current={};
 for(const file of required){
  const r=await fetch('https://api.github.com/repos/'+repo+'/contents/'+file+'?ref='+encodeURIComponent(branch),{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+githubToken.value(),'User-Agent':'YoshiLab-Studio'}});
  if(r.status===404&&file==='studio-materials.json'){current[file]=[];continue}
  if(!r.ok)throw Object.assign(Error('教材JSONを取得できません: '+file),{status:502});
  const data=await r.json();
  const raw=await github('GET',path('blobs/'+data.sha));
  if(raw.encoding!=='base64')throw Error('GitHub blobの形式が不正です');
  const binary=Buffer.from(raw.content.replace(/\s/g,''),'base64').toString('utf8');
  try{current[file]=JSON.parse(binary)}catch{throw Error(file+' のJSONが不正です')}
 }
 const {files,counts,replaced}=makeFiles(current,input);
 const entries=[];
 for(const [file,content] of Object.entries(files)){const blob=await github('POST',path('blobs'),{content,encoding:'utf-8'});entries.push({path:file,mode:'100644',type:'blob',sha:blob.sha})}
 const tree=await github('POST',path('trees'),{base_tree:commit.tree.sha,tree:entries});
 const next=await github('POST',path('commits'),{message:'教材スタジオ: '+input.subject+' '+input.lesson+' Part '+input.part,tree:tree.sha,parents:[head]});
 // Non-force fast-forward rejects a branch that changed after the snapshot.
 await github('PATCH',path('refs/heads/'+encodeURIComponent(branch)),{sha:next.sha,force:false});
 return {url:'https://github.com/'+repo+'/commit/'+next.sha,commit:next.sha,counts,replaced,note:'GitHubへの登録が完了。配信サイトへの反映は別途確認してください'};
}
async function enforceRateLimit(uid,action){
 const interval=action==='generate'?30000:10000;
 const target=getDatabase().ref('studioRateLimits/'+uid+'/'+action),now=Date.now();
 const result=await target.transaction(old=>{
  if(typeof old==='number'&&now-old<interval)return;
  return now;
 },undefined,false);
 if(!result.committed)throw Object.assign(Error('連続操作を制限しています。少し時間を空けて再試行してください'),{status:429});
}
async function generate(input){
 const key=geminiKey.value();
 if(!key)throw Object.assign(Error('Gemini APIキーが未設定です'),{status:503});
 const model=process.env.STUDIO_GEMINI_MODEL||'gemini-2.5-flash';
 const endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),85000);
 try{
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:modelPrompt(input)}]}],generationConfig:{responseMimeType:'application/json',temperature:0.25}}),signal:controller.signal});
  if(!r.ok)throw Object.assign(Error('Gemini教材生成に失敗しました（'+r.status+'）'),{status:502});
  const data=await r.json(),raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
  let parsed;try{parsed=JSON.parse(raw)}catch{throw Error('Geminiの回答をJSONとして読み取れません')}
  return {questions:validateQuestions(parsed.questions,{allowEmpty:false})};
 }finally{clearTimeout(timer)}
}
export const studioApi=onRequest({region:'asia-northeast1',timeoutSeconds:120,memory:'512MiB',maxInstances:3,secrets:[geminiKey,githubToken]},async(req,res)=>{
 const origin=req.headers.origin||'';
 if(origin&&!origins.includes(origin))return json(res,403,{error:'このサイトからの操作は許可されていません'});
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
 res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
 res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return json(res,405,{error:'POSTのみ利用できます'});
 if(!/^Bearer\s+\S+$/.test(req.headers.authorization||''))return json(res,401,{error:'ログインが必要です'});
 try{
  const idToken=req.headers.authorization.replace(/^Bearer\s+/,'');
  const decoded=await getAuth().verifyIdToken(idToken,true);
  if(decoded.firebase?.sign_in_provider!=='google.com'||!decoded.email_verified)throw Object.assign(Error('確認済みGoogleアカウントが必要です'),{status:403});
  const teacher=(await getDatabase().ref('teacherUids/'+decoded.uid).get()).val();
  if(teacher!==true)throw Object.assign(Error('教員権限がありません'),{status:403});
  if(JSON.stringify(req.body||{}).length>150000)throw Object.assign(Error('入力データが大きすぎます'),{status:413});
  const input=validateDraft(req.body);
  const action=req.path.replace(/\/$/,'').split('/').pop();
  if(action==='generate'){await enforceRateLimit(decoded.uid,'generate');return json(res,200,await generate(input))}
  if(action==='publish'){validateQuestions(req.body.questions);await enforceRateLimit(decoded.uid,'publish');return json(res,200,await publish(req.body))}
  return json(res,404,{error:'操作が見つかりません'});
 }catch(e){console.error('Studio API failure',e.status||500,e.message);return json(res,e.status||400,{error:e.status>=500?'サーバー処理に失敗しました: '+e.message:e.message})}
});
