'use strict';
// The actual Google library verifies locally signed JWTs against an injected test certificate.
// The production verifier still uses Google's certificate source. No Google/Firebase traffic.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {OAuth2Client}=require('google-auth-library'),{createIdentityVerifier}=require('../phase3/auth.cjs');
const audience='test-client.apps.googleusercontent.com',now=Math.floor(Date.now()/1000),{privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
class OfflineClient extends OAuth2Client{async getFederatedSignonCertsAsync(){return {certs:{test:publicKey.export({type:'spki',format:'pem'})},format:'PEM'};}}
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(changes={}){const payload={iss:'https://accounts.google.com',aud:audience,sub:'google-sub',email:'teacher@example.test',email_verified:true,iat:now,exp:now+300,...changes};const input=encode({alg:'RS256',kid:'test'})+'.'+encode(payload);return input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');}
test('real Google verification library accepts a correctly signed token offline',async()=>{const verify=createIdentityVerifier({audience,OAuth2Client:OfflineClient});assert.deepEqual(await verify('Bearer '+token()),{email:'teacher@example.test',sub:'google-sub'});});
test('real Google library rejects forged signature, wrong audience and expired tokens offline',async()=>{const verify=createIdentityVerifier({audience,OAuth2Client:OfflineClient});const good=token(),parts=good.split('.'),forged=parts[0]+'.'+encode({...JSON.parse(Buffer.from(parts[1],'base64url').toString()),email:'attacker@example.test'})+'.'+parts[2];for(const value of [forged,token({aud:'other-client'}),token({iat:now-7200,exp:now-3600})])await assert.rejects(verify('Bearer '+value),{code:401});});
