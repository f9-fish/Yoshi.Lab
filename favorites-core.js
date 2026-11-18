/* References shared by the question screens and the review catalog. */
globalThis.YoshiFavoriteQuestions = (() => {
 const formats = Object.freeze({
  cloze:'本文穴埋め（チェック）', textTyping:'本文タイピング', translation:'本文翻訳',
  vocab:'単語4択', vocabTyping:'単語タイピング', vocabOral:'単語（口頭）',
  eiken:'英検4択', spelling:'スペリング', wordChoice:'単語帳4択', reorder:'並び替え',
  writing:'英作文', trueFalse:'True / False', discussion:'Discussion', qa:'本文Q&A',
  studioVocab:'単語・熟語', studioCloze:'文法・穴埋め'
 });
 const sources = Object.freeze({
  ecText:'lessons.json', rpText:'ronpyo_text.json', ecWords:'vocabulary.json', rpWords:'ronpyo_vocab.json',
  eikenPre:'eiken_pre2.json', eikenTwo:'eiken_2.json', wordbook:'wordbook.json',
  writing:'writing_questions.json', extension:'extension_questions.json', qa:'pair_text_qa.json', studio:'studio-content.json'
 });
 const clean = value => String(value ?? '').normalize('NFC').replace(/\r\n?/g,'\n').trim();
 const validKey = key => typeof key === 'string' && /^[a-zA-Z]+~[a-zA-Z]+~[a-f0-9]{64}$/.test(key);
 const ref = (source,format,...identity) => Object.hasOwn(sources,source) && Object.hasOwn(formats,format) &&
  identity.length && identity.every(value=>clean(value)) ? {source,format,identity:identity.map(clean)} : null;
 const text = (subject,format,en,ja) => ref(subject==='論表'?'rpText':'ecText',format,en,ja);
 const word = (subject,format,en,ja) => ref(subject==='論表'?'rpWords':'ecWords',format,en,ja);
 const eiken = (grade,id) => ref(grade==='2級'?'eikenTwo':'eikenPre','eiken',id);
 const wordbook = (mode,q) => mode==='reorder'?ref('wordbook','reorder',q.word.id,q.prompt,q.answer):
  ref('wordbook',mode==='choice'?'wordChoice':'spelling',q.word.id);
 const extension = q => ref('extension',q.type==='True / False'?'trueFalse':'discussion',q.id);
 const studioFormats = {vocabulary:'studioVocab',cloze:'studioCloze',qa:'qa',trueFalse:'trueFalse',discussion:'discussion'};
 const studio = (group,type,q) => ref('studio',studioFormats[type],group.subject,group.id,group.name,q.question,q.answer);
 async function key(reference){
  const {source,format,identity}=reference;
  const bytes=new TextEncoder().encode(JSON.stringify(identity));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return source+'~'+format+'~'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
 }
 const fetchSource=async source=>{
  if(!Object.hasOwn(sources,source))throw Error('未知の教材です');
  const response=await fetch('./'+sources[source],{cache:'no-cache'});
  if(!response.ok)throw Error('教材を取得できませんでした');
  return response.json();
 };
 return Object.freeze({formats,sources,clean,validKey,ref,text,word,eiken,wordbook,extension,studio,key,fetchSource});
})();
