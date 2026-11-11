/* Presentation helpers only; data, grading, XP and persistence stay in their existing modules. */
(function(root){
 function ranges(rows,stage){const groups=new Map();for(const row of rows)if(row.stage===stage)groups.set(row.unit,(groups.get(row.unit)||0)+1);return [...groups].sort(([a],[b])=>a.localeCompare(b,'ja',{numeric:true})).map(([id,count])=>({id,count,label:id.replace(/^(Part|Unit)\s*(\d+)/i,'$1 $2')}));}
 function segments(items,size=10){const out=[];for(let i=0;i<items.length;i+=size){const entries=items.slice(i,i+size),first=entries[0].label,last=entries.at(-1).label;out.push({items:entries,label:entries.length===1?first:first+'–'+last.replace(/^(Part|Unit)\s*/i,'')});}return out;}
 function layout(count,width,mobile=false,overview=false,desktopHeight){
  const height=mobile?count*120+36:desktopHeight||(overview?480:600),points=[];
  // 一つの遠景上で、番号順に必ず手前から奥へ上がる。
  const ascent=[[4,.88],[32,.84],[55,.66],[28,.62],[74,.42],[50,.40],[26,.38],[26,.18],[50,.16],[74,.14]];
  for(let i=0;i<count;i++){let left,y;if(mobile){left=i%2?14:2;y=62+i*120;}else if(overview){left=[3,26,49,71][i];y=height*[.82,.61,.40,.19][i];}else{[left,y]=ascent[i];y*=height;}points.push({left,y,x:width*left/100+(mobile?29:33),mobile,overview,width});}return {height,points};
 }
 function path(points){
  if(!points.length)return '';const p=points.map(v=>({...v,y:v.y+(v.mobile?18:22)}));let d=`M ${p[0].x} ${p[0].y}`;
  for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];let c1,c2;
   if(a.mobile){c1={x:a.x,y:a.y+58};c2={x:b.x,y:b.y-58};}
   else if(!a.overview&&[2,4,7].includes(i)){const edge=i===7?Math.max(12,a.x-90):Math.min(a.width-12,b.x+130);c1={x:edge,y:a.y};c2={x:edge,y:b.y};}
   else{c1={x:a.x+(b.x-a.x)*.35,y:a.y};c2={x:a.x+(b.x-a.x)*.7,y:b.y};}
   d+=` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  }return d;
 }
 const api={ranges,segments,layout,path};if(typeof module==='object')module.exports=api;else root.YoshiWordbookMap=api;
})(typeof window==='object'?window:globalThis);
