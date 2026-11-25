import { createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPreviewHandler } from './serve-teacher-preview.mjs';

const issuer = 'https://cloud.google.com/iap';
const keyEndpoint = 'https://www.gstatic.com/iap/verify/public_key-jwk';

export function makeIapAuthorization({ audience, teacherEmail, fetchKeys = fetch, now = Date.now }) {
 if (!/^\/projects\/\d+\/locations\/[a-z0-9-]+\/services\/[a-z0-9-]+$/.test(audience || '')) {
  throw Error('A Cloud Run IAP audience is required');
 }
 if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(teacherEmail || '')) throw Error('One teacher email is required');
 let keys = [], expiry = 0, pending;
 async function getKeys() {
  if (now() < expiry) return keys;
  if (!pending) pending = (async () => {
   const result = await fetchKeys(keyEndpoint, { signal: AbortSignal.timeout(5000), redirect: 'error' });
   if (!result.ok) throw Error('IAP signing keys unavailable');
   const body = await result.json();
   if (!Array.isArray(body.keys)) throw Error('Invalid IAP signing keys');
   keys = body.keys;
   expiry = now() + 60_000;
   return keys;
  })().finally(() => { pending = undefined; });
  return pending;
 }

 return async req => {
  try {
   const token = req.headers['x-goog-iap-jwt-assertion'];
   if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return false;
   const [header, payload, signature] = token.split('.');
   const parse = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
   const { alg, kid } = parse(header);
   if (alg !== 'ES256' || typeof kid !== 'string') return false;
   const claims = parse(payload);
   const time = Math.floor(now() / 1000);
   if (claims.iss !== issuer || claims.aud !== audience || typeof claims.sub !== 'string' || !claims.sub ||
       typeof claims.email !== 'string' || claims.email.toLowerCase() !== teacherEmail.toLowerCase() ||
       !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
       claims.iat > time + 30 || claims.exp <= time || claims.exp <= claims.iat ||
       claims.exp - claims.iat > 660) return false;
   const jwk = (await getKeys()).find(key => key.kid === kid && key.kty === 'EC' && key.crv === 'P-256');
   if (!jwk) return false;
   return verify('sha256', Buffer.from(header + '.' + payload), {
    key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
   }, Buffer.from(signature, 'base64url'));
  } catch {
   return false;
  }
 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const { PREVIEW_ORIGIN, IAP_AUDIENCE, PREVIEW_TEACHER_EMAIL, PORT = '8080' } = process.env;
 const authorize = makeIapAuthorization({ audience: IAP_AUDIENCE, teacherEmail: PREVIEW_TEACHER_EMAIL });
 createServer(createPreviewHandler({ origin: PREVIEW_ORIGIN, authorize })).listen(Number(PORT), '0.0.0.0');
}
