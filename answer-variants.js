/* Spreadsheet cells remain one question. No translation or inferred synonyms. */
globalThis.YoshiAnswers=(()=>{
 function lines(value){
  const text=String(value??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/\\r\\n|\\n|\\r/g,'\n').replace(/[\u200b-\u200d\ufeff]/g,'');
  return [...new Set(text.split(/\r\n?|\n/).map(s=>s.trim()).filter(Boolean))];
 }
 const primary=value=>lines(value)[0]||'';
 const display=value=>lines(value).join('\n');
 const normalize=value=>String(value??'').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
 const wordMatches=(answer,source,compare=(a,b)=>normalize(a)===normalize(b))=>lines(source).some(expected=>compare(answer,expected));
 function clozeRows(source){
  return lines(source).map(text=>({text,answers:[...text.matchAll(/\(([^()]+)\)/g)].map(m=>m[1].trim())})).filter(r=>r.answers.length);
 }
 // Match one complete registered alternative, never a mix of different rows.
 // Joining permits a shorter/longer alternative to be entered together in a field.
 function clozeMatch(values,source,norm=normalize){
  const rows=clozeRows(source),multi=lines(source).length>1;
  if(!rows.length||!Array.isArray(values)||!values.length)return null;
  if(multi){
   const typed=norm(values.join(' '));
   if(typed&&rows.some(r=>norm(r.answers.join(' '))===typed))return true;
   if(values.some(v=>!String(v).trim()))return null;
   return false;
  }
  if(values.some(v=>!String(v).trim()))return null;
  return rows[0].answers.length===values.length&&values.every((v,i)=>norm(v)===norm(rows[0].answers[i]));
 }
 return Object.freeze({lines,primary,display,wordMatches,clozeRows,clozeMatch});
})();
