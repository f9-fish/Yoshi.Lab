// Local-only UI transport fixture. This is NOT a substitute for Rules emulator tests.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
let store={};const read=p=>p.split('/').reduce((o,k)=>o?.[k],store)??null;
function write(p,v){const keys=p.split('/'),last=keys.pop();let parent=store;for(const k of keys)parent=parent[k]??={};if(v===null)delete parent[last];else parent[last]=v;}
http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;try{const {op,p,value,old,uid}=JSON.parse(body||'{}');if(op==='reset'){store={};res.end('{}');return;}
 const room=read('pairQaSpark/rooms/'+p?.split('/')[2]);
 if(op==='get'&&p.startsWith('pairQaSpark/')){
  if(!room||![room.hostUid,room.guestUid].includes(uid))throw Error('permission-denied');
  if(room.endedAt&&(p.startsWith('pairQaSpark/hints/')||p.startsWith('pairQaSpark/questions/')))throw Error('permission-denied');
  if(p.startsWith('pairQaSpark/hints/')&&(Number(p.split('/')[3])!==room.state.index||Number(p.split('/')[4])>room.hintStage))throw Error('permission-denied');
  if(p.startsWith('pairQaSpark/questions/')){const i=room.state.index,n=room.rotation==='one'?1:room.rotation==='two'?2:Math.ceil(room.count/2),asker=Math.floor(i/n)%2===0?room.hostUid:room.guestUid;if(Number(p.split('/')[3])!==i||!room.state.started||uid!==asker&&!room.reveal)throw Error('permission-denied');}
 }
 if(op==='set')write(p,value);if(op==='update')for(const [k,v]of Object.entries(value))write(p+'/'+k,v);
 if(op==='tx'){if(JSON.stringify(read(p))!==JSON.stringify(old)){res.end(JSON.stringify({retry:true}));return;}write(p,value);}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({value:read(p)}));
 }catch(e){res.statusCode=403;res.end(JSON.stringify({error:e.message}));}}).listen(0,'127.0.0.1',function(){fs.writeFileSync('/tmp/yoshi-spark-test-port',String(this.address().port));console.log('Local mock RTDB transport',this.address().port);});
