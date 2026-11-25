import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const preview = '/teacher-season2-preview.html';
const production = 'https://f9-fish.github.io/Yoshi.Lab/';
const normalPages = new Set(['index.html', 'pair.html', 'ranking.html', 'writing.html', 'eiken.html', 'wordbook.html']);
const assets = new Map([
 ['teacher-season2-preview.js', 'text/javascript; charset=utf-8'],
 ['teacher-preview-access.js', 'text/javascript; charset=utf-8'],
 ['firebase-web-config.js', 'text/javascript; charset=utf-8'],
 ['season2-opening.js', 'text/javascript; charset=utf-8'],
 ['season-achievements-ui.js', 'text/javascript; charset=utf-8'],
 ['season2-opening.css', 'text/css; charset=utf-8'],
 ['season-achievements.css', 'text/css; charset=utf-8'],
 ['mountain-mobile-v7.jpg', 'image/jpeg'],
 ['mountain-desktop-v7.jpg', 'image/jpeg'],
]);
const previewPolicy = [
 "default-src 'none'",
 "script-src 'self' https://www.gstatic.com https://apis.google.com https://*.firebaseio.com",
 "style-src 'self'",
 "img-src 'self' data:",
 "connect-src 'self' https://apis.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://yoshi-lab-db3eb.firebaseapp.com",
 "frame-src https://yoshi-lab-db3eb.firebaseapp.com https://*.firebaseio.com",
 "frame-ancestors 'none'",
 "object-src 'none'",
 "base-uri 'none'",
 "form-action 'none'",
].join('; ');

function isAuthorized(authorization, expected) {
 const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization || '');
 if (!match) return false;
 const decoded = Buffer.from(match[1], 'base64').toString('utf8');
 if (!decoded.startsWith('preview:')) return false;
 const secret = decoded.slice('preview:'.length);
 if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return false;
 return timingSafeEqual(createHash('sha256').update(secret).digest(), expected);
}

export function createPreviewHandler({ origin, authorize, authorizationHeaders = {} }) {
 const url = new URL(origin);
 if (url.protocol !== 'https:' || url.href !== url.origin + '/') throw Error('PREVIEW_ORIGIN must be an HTTPS origin');
 const files = new Map([...assets].map(([file, type]) => [file, { type, body: readFileSync(new URL(file, root)) }]));
 const page = readFileSync(new URL(preview.slice(1), root), 'utf8')
  .replace('<head>', '<head><meta name="preview-home-source" content="./__home-source">');
 const home = readFileSync(new URL('index.html', root));
 return async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (req.headers.host?.toLowerCase() !== url.host) return res.writeHead(421).end();
  let authorized = false;
  try { authorized = await authorize(req); } catch { /* Fail closed on verification errors. */ }
  if (!authorized) return res.writeHead(401, authorizationHeaders).end();
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
  if (!req.url.startsWith('/') || req.url.startsWith('//')) return res.writeHead(400).end();
  let path;
  try { path = new URL(req.url, url); } catch { return res.writeHead(400).end(); }
  if (path.origin !== url.origin) return res.writeHead(400).end();
  if (path.pathname === '/') return res.writeHead(302, { Location: preview }).end();
  const file = path.pathname.slice(1);
  if (normalPages.has(file)) return res.writeHead(302, { Location: new URL(file + path.search, production).href }).end();
  if (path.pathname === preview) {
   res.setHeader('Content-Security-Policy', previewPolicy);
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
   return res.end(req.method === 'HEAD' ? undefined : page);
  }
  if (path.pathname === '/__home-source') {
   res.setHeader('Content-Type', 'text/plain; charset=utf-8');
   return res.end(req.method === 'HEAD' ? undefined : home);
  }
  const asset = files.get(file);
  if (!asset) return res.writeHead(404).end();
  res.setHeader('Content-Type', asset.type);
  return res.end(req.method === 'HEAD' ? undefined : asset.body);
 };
}

export function createPreviewServer({ origin, passwordHash, tls }) {
 if (!/^[a-f0-9]{64}$/.test(passwordHash || '')) throw Error('PREVIEW_PASSWORD_SHA256 is required');
 const expected = Buffer.from(passwordHash, 'hex');
 return createServer(tls, createPreviewHandler({
  origin,
  authorize: req => isAuthorized(req.headers.authorization, expected),
  authorizationHeaders: { 'WWW-Authenticate': 'Basic realm="Yoshi.Lab private teacher staging", charset="UTF-8"' },
 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const env = process.env;
 const local = process.argv[2] === '--local';
 const port = local ? 8443 : Number(env.PREVIEW_PORT || 8443);
 if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PREVIEW_PORT');
 const origin = local ? 'https://localhost:8443' : env.PREVIEW_ORIGIN;
 const cert = local ? process.argv[3] : env.PREVIEW_TLS_CERT;
 const key = local ? process.argv[4] : env.PREVIEW_TLS_KEY;
 if (!cert || !key) throw Error('TLS certificate and key required');
 const password = local ? randomBytes(32).toString('base64url') : undefined;
 const passwordHash = local ? createHash('sha256').update(password).digest('hex') : env.PREVIEW_PASSWORD_SHA256;
 const server = createPreviewServer({ origin, passwordHash, tls: { cert: readFileSync(cert), key: readFileSync(key) } });
 server.listen(port, local ? '127.0.0.1' : (env.PREVIEW_BIND || '127.0.0.1'), () => {
  console.log('Private preview: ' + new URL(preview, origin).href);
  if (local) console.log('This session only — username: preview / password: ' + password);
 });
}
