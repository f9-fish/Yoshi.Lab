'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
const prefix="import runpy,json,io,contextlib,urllib.parse\nm=runpy.run_path('material-generation/ops/research-503-20261112/audit.py')\n";
function py(code){const r=spawnSync('python3',['-B','-c',prefix+code],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
test('API key metadata excludes key strings, display names, bound identities, IPs and referrers',()=>{const out=py(`k={'name':'projects/123/locations/global/keys/key-1','keyString':'PRIVATE-SECRET','displayName':'PRIVATE-TEACHER','serviceAccountEmail':'PRIVATE-IDENTITY','restrictions':{'serverKeyRestrictions':{'allowedIps':['PRIVATE-IP']},'apiTargets':[{'service':'generativelanguage.googleapis.com','methods':['*GenerateContent']}]}}
v=m['key_summary']([k]);assert v['keys'][0]['authKeyServiceAccountBound'];assert v['keys'][0]['generateContentAllowedByListedMethods'];assert v['secretPayloadToKeyAssociation']=='UNVERIFIED_NO_SECRET_READ';print(json.dumps(v))`);assert.ok(!out.includes('PRIVATE'));});
test('request counts calculate a project generation-only error rate, without counting GetModel as generation',()=>{py(`def s(code,n,method):return {'metric':{'labels':{'response_code':code}},'resource':{'labels':{'method':method}},'points':[{'value':{'int64Value':str(n)}}]}
v=m['metric_summary']('request-count',{'timeSeries':[s('200',3,'google.ai.GenerativeService.GenerateContent'),s('503',2,'google.ai.GenerativeService.GenerateContent'),s('200',9,'GetModel')]});assert v['generateContentRequestCount']==5;assert v['generateContent5xxRate']==0.4;assert v['allApiMethodCountsByCode']['200']==12;assert v['scope']=='PROJECT_AGGREGATE_NOT_TEST_ONLY'`);});
test('missing metrics, pagination and unknown codes never become a healthy zero error rate',()=>{py(`assert m['metric_summary']('request-count',{})['generateContent5xxRate'] is None
s={'resource':{'labels':{'method':'x.GenerateContent'}},'metric':{'labels':{'response_code':'PRIVATE'}},'points':[{'value':{'int64Value':'1'}}]}
assert m['metric_summary']('request-count',{'timeSeries':[s]})['generateContent5xxRate'] is None
s['metric']['labels']['response_code']='503'
assert m['metric_summary']('request-count',{'timeSeries':[s],'nextPageToken':'PRIVATE'})['generateContent5xxRate'] is None
assert m['metric_summary']('quota-exceeded',{})['quotaExceededObserved'] is None`);});
test('Monitoring read uses only its own GET endpoint and keeps credential out of URL/output',()=>{const out=py(`def fetch(req,timeout):
 assert urllib.parse.urlsplit(req.full_url).hostname=='monitoring.googleapis.com';assert req.get_method()=='GET';assert 'PRIVATE-TOKEN' not in req.full_url;assert req.get_header('Authorization')=='Bearer PRIVATE-TOKEN';return io.BytesIO(b'{"timeSeries":[]}')
v=m['monitoring_get']('serviceruntime.googleapis.com/api/request_count','resource.type="consumed_api"','PRIVATE-TOKEN',fetch);assert v=={'timeSeries':[]};print('safe')`);assert.ok(!out.includes('PRIVATE'));});
test('full audit uses metadata reads only, does not access secrets or model API, and outputs no token/body',()=>{const out=py(`calls=[]
def cloud(args):
 calls.append(args)
 if args[:3]==['billing','projects','describe']:return {'billingEnabled':True,'billingAccountName':'PRIVATE-BILLING'}
 if args[:2]==['services','list']:return [{'config':{'name':'generativelanguage.googleapis.com'}}]
 if args[:3]==['services','api-keys','list']:return []
 if args[:2]==['storage','cat']:return {'id':'JOB-dcb7e4afbc33a3565fb44a022b5cdcb2','jobId':'JOB-dcb7e4afbc33a3565fb44a022b5cdcb2','attempted':True,'owner':'PRIVATE-TEACHER','input':'PRIVATE-TEXT'}
 raise AssertionError(args)
class R:returncode=0;stdout=b'PRIVATE-TOKEN';stderr=b''
def run(args,**kw):assert args==['gcloud','auth','print-access-token'];return R()
g=m['main'].__globals__;g['gcloud']=cloud;g['subprocess'].run=run;g['monitoring_get']=lambda *a:{'timeSeries':[]}
g['main']()
assert len(calls)==7;assert all(a[0] in ['billing','services','storage'] for a in calls);assert not any('access' in a or 'get-key-string' in a for a in calls)`);assert.ok(!out.includes('PRIVATE'));assert.ok(out.includes('"geminiRequestSent":false'));});
test('failed read does not echo Cloud CLI errors or silently enable APIs or broaden IAM',()=>{const out=py(`def fail():raise RuntimeError('PRIVATE-ACCOUNT-KEY-TEXT')
m['read']('metadata',fail)`);assert.ok(out.includes('READ_FAILED'));assert.ok(!out.includes('PRIVATE'));});
