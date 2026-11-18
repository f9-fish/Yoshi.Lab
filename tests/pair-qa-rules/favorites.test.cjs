const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {get,ref,set}=require('firebase/database');

const key='ecText~cloze~'+'a'.repeat(64);
const directory='questionFavorites/student';
const path=directory+'/'+key;
let env;
const google={firebase:{sign_in_provider:'google.com'},email_verified:true};
before(async()=>{
 env=await initializeTestEnvironment({
  projectId:'demo-yoshi-favorites',
  database:{host:'127.0.0.1',port:9009,rules:readFileSync('../../firebase-favorites.rules.proposed.json','utf8')}
 });
});
after(async()=>{await env?.cleanup();});
const client=(uid,token=google)=>env.authenticatedContext(uid,token).database();

test('verified Google account can add, synchronize and remove an ID from its own list',async()=>{
 const first=client('student'),second=client('student');
 await assertSucceeds(set(ref(first,path),true));
 await assertSucceeds(set(ref(first,path),true));
 assert.deepEqual((await assertSucceeds(get(ref(second,directory)))).val(),{[key]:true});
 await assertSucceeds(set(ref(second,path),null));
 assert.equal((await assertSucceeds(get(ref(first,directory)))).exists(),false);
});

test('the owner-only policy checks the UID, provider and verified email',async()=>{
 for(const db of [
  client('different-student'),
  client('student',{...google,email_verified:false}),
  client('student',{...google,firebase:{sign_in_provider:'anonymous'}}),
  env.unauthenticatedContext().database()
 ]){
  await assertFails(get(ref(db,directory)));
  await assertFails(set(ref(db,path),true));
 }
});

test('the parent collection is private and values are ID markers only',async()=>{
 const db=client('student');
 await assertFails(get(ref(db,'questionFavorites')));
 await assertFails(set(ref(db,directory),{[key]:true}));
 await assertFails(set(ref(db,directory+'/unknown'),true));
 await assertFails(set(ref(db,path),{text:'教材'}));
});
