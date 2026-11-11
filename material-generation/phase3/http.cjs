'use strict';
const {fault}=require('./policy.cjs');
function handler(service,{maxBytes=256000,maxResponseBytes=768000}={}){
 return async(req,res)=>{
  const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}};
  try{
   if(req.method!=='POST'||!/^\/(enqueue|get|step|plan)$/.test(req.url||''))throw fault(404,'未対応の操作です');
   if(req.headers.origin)throw fault(403,'ブラウザから直接接続できません');
   if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fault(415,'JSONが必要です');
   if(Number(req.headers['content-length'])>maxBytes)throw fault(413,'リクエストが大きすぎます');
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw fault(413,'リクエストが大きすぎます');chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fault(400,'JSONが不正です');}
   if(!body||typeof body!=='object'||Array.isArray(body))throw fault(400,'リクエスト形式が不正です');
   const result=await service({action:req.url.slice(1),authorization:req.headers.authorization,body});if(Buffer.byteLength(JSON.stringify(result))>maxResponseBytes)throw fault(413,'結果が大きすぎます。管理者に確認してください');send(200,result);
  }catch(e){const status=Number.isInteger(e.code)&&e.code>=400&&e.code<600?e.code:500;send(status,{error:status===500?'処理に失敗しました。管理者に確認してください':e.message});}
 };
}
module.exports={handler};
