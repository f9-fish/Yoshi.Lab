/* Presentation helpers only; data, grading, XP and persistence stay in their existing modules. */
(function(root){
 function ranges(rows,stage){const groups=new Map();for(const row of rows)if(row.stage===stage)groups.set(row.unit,(groups.get(row.unit)||0)+1);return [...groups].sort(([a],[b])=>a.localeCompare(b,'ja',{numeric:true})).map(([id,count])=>({id,count,label:id.replace(/^(Part|Unit)\s*(\d+)/i,'$1 $2')}));}
 function segments(items,size=10){const out=[];for(let i=0;i<items.length;i+=size){const entries=items.slice(i,i+size),first=entries[0].label,last=entries.at(-1).label;out.push({items:entries,label:entries.length===1?first:first+'–'+last.replace(/^(Part|Unit)\s*/i,'')});}return out;}
 function layout(count,width,mobile=false,overview=false){
  const height=mobile?count*120+36:overview?480:600,points=[];
  const ascent=[[4,.86],[30,.84],[55,.66],[28,.64],[74,.46],[50,.44],[26,.42],[26,.24],[50,.22],[74,.20]];
  for(let i=0;i<count;i++){let left,y;if(mobile){left=i%2?14:2;y=62+i*120;}else if(overview){left=[3,26,49,71][i];y=[380,285,190,95][i];}else{[left,y]=ascent[i];y*=height;}points.push({left,y,x:width*left/100+(mobile?38:46),mobile,overview,width});}return {height,points};
 }
 function path(points){
  if(!points.length)return '';const p=points.map(v=>({...v,y:v.y+(v.mobile?26:31)})),width=p[0].width||1000;let d=`M ${p[0].x} ${p[0].y}`;
  for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];let c1,c2;
   if(a.mobile){c1={x:a.x,y:a.y+58};c2={x:b.x,y:b.y-58};}
   else if(!a.overview&&i===2){const bend=Math.min(width*.12,140);c1={x:b.x+bend,y:a.y+15};c2={x:b.x+bend,y:b.y+42};}
   else if(!a.overview&&i===4){const edge=width*.98;c1={x:edge,y:a.y-5};c2={x:edge,y:b.y+66};}
   else if(!a.overview&&i===7){const edge=Math.max(15,a.x-width*.17);c1={x:edge,y:a.y-8};c2={x:edge,y:b.y+22};}
   else{c1={x:a.x+(b.x-a.x)*.35,y:a.y+15};c2={x:a.x+(b.x-a.x)*.7,y:b.y+14};}
   d+=` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  }return d;
 }
 const api={ranges,segments,layout,path};if(typeof module==='object')module.exports=api;else root.YoshiWordbookMap=api;
})(typeof window==='object'?window:globalThis);
