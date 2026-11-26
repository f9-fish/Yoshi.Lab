'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fault}=require('./policy.cjs');
// For ONE server sharing a persistent volume. Not a Cloud Functions / ephemeral disk store.
class FileStore{
 constructor(directory){this.directory=path.resolve(directory);this.persistent=true;}
 file(key){if(!/^[a-zA-Z0-9_-]{1,120}$/.test(key))throw Error('不正な保存キー');return path.join(this.directory,key+'.json');}
 async read(key){try{return JSON.parse(await fs.readFile(this.file(key),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async write(key,value){await fs.mkdir(this.directory,{recursive:true,mode:0o700});const temporary=this.file(key)+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await fs.rename(temporary,this.file(key));}finally{await fs.rm(temporary,{force:true});}}
 async lock(key,fn){await fs.mkdir(this.directory,{recursive:true,mode:0o700});const name=this.file(key)+'.lock';let lock;try{lock=await fs.open(name,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw fault(409,'処理中またはロック残存です。再取得し、必要なら管理者が復旧してください');throw e;}
  try{await lock.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return await fn();}finally{await lock.close();await fs.rm(name,{force:true});}}
}
class MemoryStore{
 constructor(){this.data=new Map();this.locks=new Set();this.persistent=false;}
 async read(key){return structuredClone(this.data.get(key)||null);}
 async write(key,value){this.data.set(key,structuredClone(value));}
 async lock(key,fn){if(this.locks.has(key))throw fault(409,'処理中です');this.locks.add(key);try{return await fn();}finally{this.locks.delete(key);}}
}
module.exports={FileStore,MemoryStore};
