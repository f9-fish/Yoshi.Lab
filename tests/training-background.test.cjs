const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../training-background.js'),'utf8');
function start(hour){const listeners={},classes=new Set();let localHour=hour,tick;
 const apply=(name,enabled)=>enabled?classes.add(name):classes.delete(name);
 vm.runInNewContext(source,{Date:class{getHours(){return localHour;}},document:{body:{classList:{toggle:apply}},addEventListener:(event,fn)=>listeners[event]=fn},window:{addEventListener:(event,fn)=>listeners[event]=fn},setInterval:(fn,ms)=>{assert.equal(ms,30000);tick=fn;}});
 return {classes,listeners,tick,changeHour(h){localHour=h;}};
}
test('training background: HOME daytime boundaries (device-local 06:00 to before 17:00)',()=>{for(const hour of [0,5,6,12,16,17,23])assert.equal(start(hour).classes.has('yoshi-daytime'),hour>=6&&hour<17);});
test('training background: changes to night at the refresh tick',()=>{const s=start(16);s.changeHour(17);s.tick();assert.equal(s.classes.has('yoshi-daytime'),false);});
test('training background: visibility and focus refresh after sleeping',()=>{const s=start(5);s.changeHour(6);s.listeners.visibilitychange();assert.equal(s.classes.has('yoshi-daytime'),true);s.changeHour(23);s.listeners.focus();assert.equal(s.classes.has('yoshi-daytime'),false);});
