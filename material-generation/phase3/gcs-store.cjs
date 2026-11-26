'use strict';
const {randomUUID}=require('node:crypto'),{fault}=require('./policy.cjs');
// A dedicated PRIVATE TEST bucket. GCS generation preconditions provide cross-instance locks.
class GcsStore{
 constructor(bucket,{prefix='material-generation-test',maxBytes=8*1024*1024}={}){if(!bucket||!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix))throw Error('テスト専用バケットが必要です');this.bucket=bucket;this.prefix=prefix;this.maxBytes=maxBytes;this.persistent=true;}
 file(key,suffix='.json'){if(!/^[a-zA-Z0-9_-]{1,120}$/.test(key))throw Error('不正な保存キー');return this.bucket.file(this.prefix+'/'+key+suffix);}
 async read(key){const file=this.file(key);try{const [meta]=await file.getMetadata();if(Number(meta.size)>this.maxBytes)throw Error('保存データが大きすぎます');const [bytes]=await this.bucket.file(file.name,{generation:meta.generation}).download();return JSON.parse(bytes.toString('utf8'));}catch(e){if(Number(e.code)===404)return null;throw e;}}
 async write(key,value){const file=this.file(key),body=JSON.stringify(value);if(Buffer.byteLength(body)>this.maxBytes)throw Error('保存データが大きすぎます');let generation=0;try{const [meta]=await file.getMetadata();generation=meta.generation;}catch(e){if(Number(e.code)!==404)throw e;}
  try{await file.save(body,{resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:generation}});}catch(e){if(Number(e.code)===412)throw fault(409,'保存データが変更されました。自動上書きせず再確認してください');throw e;}}
 async lock(key,fn){const file=this.file(key,'.lock'),owner=randomUUID();try{await file.save(owner,{resumable:false,preconditionOpts:{ifGenerationMatch:0}});}catch(e){if(Number(e.code)===412)throw fault(409,'処理中または残存ロックです。管理者確認が必要です');throw e;}
  try{return await fn();}finally{
   // Never delete another worker's lock if an administrator replaced it during recovery.
   const [meta]=await file.getMetadata(),[content]=await this.bucket.file(file.name,{generation:meta.generation}).download();
   if(content.toString()!==owner)throw fault(409,'ロック所有者が変わりました。管理者確認が必要です');
   await file.delete({ifGenerationMatch:meta.generation});
  }
 }
}
module.exports={GcsStore};
