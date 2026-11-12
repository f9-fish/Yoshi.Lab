'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),script='material-generation/ops/test01/phase4-cloud-shell.sh';
function run(stage,{confirm=true,pap='enforced',version='1',extra=[]}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase4-ops-')),log=path.join(dir,'calls');
 const write=(name,body)=>fs.writeFileSync(path.join(dir,name),'#!/usr/bin/env bash\nset -eu\n'+body,{mode:0o700});
 write('git','if [[ "$1" == diff ]]; then exit 0; fi\nif [[ "$1" == rev-parse ]]; then echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; exit 0; fi\nexec '+JSON.stringify(spawnSync('which',['git'],{encoding:'utf8'}).stdout.trim())+' "$@"\n');
 write('curl','echo 401\n');
 write('node','echo "model metadata verified (mock)"\n');
 write('gcloud',`printf '%s\\n' "$*" >> "$OPS_LOG"
case "$*" in
  'run services describe '* )
    if [[ "$*" == *'--format=json'* ]]; then cat "$RUN_JSON"; else echo yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com; fi ;;
  'billing projects describe '* ) echo True ;;
  'secrets versions describe '* ) echo ENABLED ;;
  'secrets versions access '* ) echo MOCK_SECRET_MUST_NOT_BE_LOGGED ;;
  'storage buckets list '* ) echo yoshi-lab-db3eb-material-test01-jobs ;;
  'storage buckets describe '* ) printf '{"name":"yoshi-lab-db3eb-material-test01-jobs","labels":{"purpose":"material-test01"},"uniform_bucket_level_access":true,"public_access_prevention":"%s"}\\n' "$MOCK_PAP" ;;
  'artifacts docker images describe '* ) echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;;
  'run deploy '* )
    for arg in "$@"; do if [[ "$arg" == --env-vars-file=* ]]; then cp "\${arg#*=}" "$CAPTURE_ENV"; fi; done ;;
esac
`);
 const env={MG_MODE:'TEST',MG_ENABLED:'true',MG_PREFLIGHT_ENABLED:'false',MG_TEST_APPEND_ENABLED:'false',MG_PHASE4_SINGLE_JOB:'true',MG_AUTH_VERIFIED:'true',MG_STORAGE_VERIFIED:'true',MG_MODEL_VERIFIED:'true',MG_COST_CONFIRMED:'true',MG_DAILY_LIMIT:'1',MG_GEMINI_MODEL:'gemini-3.8-flash',MG_GCS_BUCKET:'yoshi-lab-db3eb-material-test01-jobs',MG_STORE_BACKEND:'gcs',MG_TEST_SPREADSHEET_ID:'1DhOMLWw9nlMvNLRuT32vCN0A69GnaREWZqLZJyFLERc',MG_GOOGLE_AUDIENCE:'484749540864-95miu3q2sndsm80oi4cron53hm0v16gc.apps.googleusercontent.com'};
 const snapshot={spec:{template:{spec:{serviceAccountName:'yoshilab-material-test01@yoshi-lab-db3eb.iam.gserviceaccount.com',containers:[{env:[...Object.entries(env).map(([name,value])=>({name,value})),{name:'MG_GEMINI_API_KEY',valueFrom:{secretKeyRef:{name:'yoshilab-material-test01-gemini',key:'1'}}}]}]}}},status:{latestReadyRevisionName:'test-0001',latestCreatedRevisionName:'test-0001',traffic:[{revisionName:'test-0001',percent:100}],url:'https://yoshilab-material-test01-test-an.a.run.app'}};
 fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(snapshot));
 try{const r=spawnSync('bash',[script,stage,...extra],{cwd:root,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,OPS_LOG:log,RUN_JSON:path.join(dir,'run.json'),MOCK_PAP:pap,CAPTURE_ENV:path.join(dir,'env.yaml'),MG_SECRET_VERSION:version,MG_ADMIN_CONFIRMED:confirm?'true':'false',MG_COST_CONFIRMED:confirm?'true':'false'}});return {...r,calls:fs.existsSync(log)?fs.readFileSync(log,'utf8'):'',config:fs.existsSync(path.join(dir,'env.yaml'))?fs.readFileSync(path.join(dir,'env.yaml'),'utf8'):''};}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('Cloud Shell setup targets only test resources, binds versioned Secret, keeps writes off and never exposes secret',()=>{const r=run('setup-deploy');assert.equal(r.status,0,r.stderr);assert.ok(r.calls.includes('run deploy yoshilab-material-test01 '));assert.ok(!r.calls.includes('studioapi'));assert.ok(!r.calls.includes('projects add-iam-policy-binding'));assert.ok(!r.calls.includes('--allow-unauthenticated'));assert.ok(r.calls.includes('--role=roles/storage.objectUser'));assert.ok(r.calls.includes('--role=roles/secretmanager.secretAccessor'));assert.ok(r.calls.includes('--set-secrets=MG_GEMINI_API_KEY=yoshilab-material-test01-gemini:1'));assert.ok(!r.stdout.includes('MOCK_SECRET_MUST_NOT_BE_LOGGED'));assert.ok(!r.stderr.includes('MOCK_SECRET_MUST_NOT_BE_LOGGED'));assert.match(r.config,/MG_TEST_APPEND_ENABLED: "false"/);assert.match(r.config,/MG_PHASE4_SINGLE_JOB: "true"/);assert.match(r.config,/MG_ENABLED: "true"/);assert.ok(!r.config.includes('MG_GEMINI_API_KEY='));});
test('Cloud Shell missing cost confirmation or unpinned Secret stops before changes',()=>{for(const options of [{confirm:false},{version:'latest'}]){const r=run('setup-deploy',options);assert.notEqual(r.status,0);assert.ok(!r.calls.includes('run deploy'));assert.ok(!r.calls.includes('add-iam-policy-binding'));}});
test('Cloud Shell refuses existing bucket without enforced PAP before IAM/deploy',()=>{const r=run('setup-deploy',{pap:'inherited'});assert.notEqual(r.status,0);assert.ok(!r.calls.includes('add-iam-policy-binding'));assert.ok(!r.calls.includes('run deploy'));});
