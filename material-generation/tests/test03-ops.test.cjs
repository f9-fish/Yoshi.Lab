'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),{config,SA,BUCKET,SECRET,PERMISSIONS}=require('../ops/test03/config.cjs');
const root=path.resolve(__dirname,'../..');
function run(stage,{confirmed=true,approved=false,pap='enforced',one=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'test03-ops-')),write=(name,body)=>fs.writeFileSync(path.join(dir,name),'#!/usr/bin/env bash\nset -eu\n'+body,{mode:0o700});
 const node=process.execPath,git=spawnSync('which',['git'],{encoding:'utf8'}).stdout.trim();
 write('node',`if [[ "$1" == *verify-model.cjs ]]; then cat >/dev/null; echo 'model metadata verified (mock)'; else exec ${JSON.stringify(node)} "$@"; fi\n`);
 write('git',`if [[ "$1" == diff ]]; then exit 0; fi\nif [[ "$1" == rev-parse ]]; then echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; exit 0; fi\nexec ${JSON.stringify(git)} "$@"\n`);
 write('curl','echo 401\n');
 write('gcloud',`printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
 'billing projects describe '* ) echo True ;;
 'secrets versions describe '* ) echo ENABLED ;;
 'secrets versions access '* ) echo PRIVATE-SECRET-MUST-NOT-APPEAR ;;
 'iam service-accounts list '* ) echo '${SA}' ;;
 'iam service-accounts describe '* ) echo '{"email":"${SA}"}' ;;
 'iam roles list '* ) echo 'projects/yoshi-lab-db3eb/roles/yoshiLabMaterialTest03Reader' ;;
 'iam roles describe '* ) echo '${JSON.stringify({includedPermissions:PERMISSIONS})}' ;;
 'projects get-iam-policy '* ) echo '{"bindings":[]}' ;;
 'storage buckets list '* ) echo '${BUCKET}' ;;
 'storage buckets describe '* ) printf '{"name":"${BUCKET}","labels":{"purpose":"material-test03"},"public_access_prevention":"%s","uniform_bucket_level_access":true}\\n' "$PAP" ;;
 'artifacts repositories list '* ) echo yoshilab-material-test03 ;;
 'artifacts docker images describe '* ) echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;;
 'run deploy '* ) for arg in "$@"; do if [[ "$arg" == --env-vars-file=* ]]; then cp "\${arg#*=}" "$CAPTURE_CONFIG"; fi; done ;;
 'run services describe '* ) cat "$RUN_JSON" ;;
 'run services update '* ) ${JSON.stringify(node)} -e 'const fs=require("node:fs"),p=process.env.RUN_JSON,v=JSON.parse(fs.readFileSync(p));v.spec.template.spec.containers[0].env.find(e=>e.name==="MG_GENERATION_APPROVED").value="true";fs.writeFileSync(p,JSON.stringify(v));' ;;
esac
`);
 const env={...config('test03.apps.googleusercontent.com'),MG_GENERATION_APPROVED:approved?'true':'false'};
 const snapshot={metadata:{name:'yoshilab-material-test03'},spec:{template:{spec:{timeoutSeconds:180,serviceAccountName:SA,containers:[{env:[...Object.entries(env).map(([name,value])=>({name,value})),{name:'MG_GEMINI_API_KEY',valueFrom:{secretKeyRef:{name:SECRET,key:'1'}}}]}]}}},status:{url:'https://yoshilab-material-test03-test-an.a.run.app',latestCreatedRevisionName:'test03-0001',latestReadyRevisionName:'test03-0001',traffic:[{revisionName:'test03-0001',percent:100}]}};
 fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(snapshot));
 try{const result=spawnSync('bash',['material-generation/ops/test03/cloud-shell.sh',stage],{cwd:root,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,CALLS:path.join(dir,'calls'),RUN_JSON:path.join(dir,'run.json'),CAPTURE_CONFIG:path.join(dir,'config.json'),PAP:pap,MG03_GOOGLE_AUDIENCE:'test03.apps.googleusercontent.com',MG_SECRET_VERSION:'1',MG_ADMIN_CONFIRMED:confirmed?'true':'false',MG_COST_CONFIRMED:confirmed?'true':'false',MG_FIREBASE_READ_CONFIRMED:confirmed?'true':'false',MG_ONE_ATTEMPT_APPROVED:one?'true':'false'}});return {...result,calls:fs.existsSync(path.join(dir,'calls'))?fs.readFileSync(path.join(dir,'calls'),'utf8'):'',config:fs.existsSync(path.join(dir,'config.json'))?JSON.parse(fs.readFileSync(path.join(dir,'config.json'))):null};}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('TEST03 setup deploys new resources with generation disabled, pinned Secret, exact read role and no TEST01 writes',()=>{const r=run('setup-deploy');assert.equal(r.status,0,r.stderr);assert.equal(r.config.MG_GENERATION_APPROVED,'false');assert.equal(r.config.MG_PHASE4_ENVIRONMENT,'TEST03');assert.equal(r.config.MG_GEMINI_PROFILE,'writing-low-latency-v1');assert.ok(r.calls.includes('--timeout=180'));assert.ok(!r.calls.includes('run deploy yoshilab-material-test02'));assert.ok(!r.calls.includes('gs://yoshi-lab-db3eb-material-test02'));assert.equal(r.config.MG_TEST_APPEND_ENABLED,'false');assert.equal(r.config.MG_GCS_BUCKET,BUCKET);assert.ok(r.calls.includes('run deploy yoshilab-material-test03 '));assert.ok(r.calls.includes('--role=projects/yoshi-lab-db3eb/roles/yoshiLabMaterialTest03Reader'));assert.ok(r.calls.includes('--set-secrets=MG_GEMINI_API_KEY='+SECRET+':1'));assert.ok(!r.calls.includes('run deploy yoshilab-material-test01'));assert.ok(!r.calls.includes('gs://yoshi-lab-db3eb-material-test01'));assert.ok(!r.calls.includes('serviceAccount:yoshilab-material-test01@'));assert.ok(!r.calls.includes('versions add'));assert.ok(!r.calls.includes('delete'));assert.ok(!r.stdout.includes('PRIVATE-SECRET'));assert.ok(!r.stderr.includes('PRIVATE-SECRET'));});
test('TEST03 setup refuses missing approvals and unsafe existing bucket',()=>{for(const options of [{confirmed:false},{pap:'inherited'}]){const r=run('setup-deploy',options);assert.notEqual(r.status,0);assert.ok(!r.calls.includes('run deploy'));assert.ok(!r.calls.includes('storage buckets add-iam-policy-binding'));}});
test('TEST03 explicit approval only updates its generation flag and never calls model or generation',()=>{const denied=run('approve-generation');assert.notEqual(denied.status,0);assert.ok(!denied.calls.includes('run services update'));const r=run('approve-generation',{one:true});assert.equal(r.status,0,r.stderr);assert.ok(r.calls.includes('run services update yoshilab-material-test03 '));assert.ok(r.calls.includes('--update-env-vars=MG_GENERATION_APPROVED=true'));assert.ok(!r.calls.includes('versions access'));assert.ok(!r.calls.includes('builds submit'));assert.ok(!r.calls.includes('run deploy'));});
