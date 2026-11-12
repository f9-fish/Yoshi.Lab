'use strict';
// Offline demonstration: hand-written fixture, no API keys and no network.
const fixture=require('./fixture.json');
const {generateBatch}=require('../engine.cjs'),{HEADERS}=require('../core.cjs'),{planAppend}=require('../append-plan.cjs');
(async()=>{
 const report=await generateBatch({master:fixture.master,selection:fixture.selection},{generate:async({type})=>structuredClone(fixture.responses[type])});
 const plans=Object.fromEntries(['vocabulary','qa','writing','trueFalse'].map(type=>[type,planAppend({type,headers:HEADERS[type],rows:[]},report.candidates.filter(c=>c.type===type))]));
 console.log(JSON.stringify({notice:fixture.notice,batchId:report.batchId,state:report.state,publishEnabled:report.publishEnabled,results:report.results,errors:report.errors,examples:Object.fromEntries(Object.entries(plans).map(([type,plan])=>[type,{headers:plan.headers,firstRow:plan.additions[0],diff:plan.diff,writeEnabled:plan.writeEnabled,requiresSyncVerification:plan.requiresSyncVerification}]))},null,2));
 if(report.errors.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
