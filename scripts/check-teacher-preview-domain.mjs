import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { firebaseWebConfig } from '../firebase-web-config.js';

export async function checkDomain(origin, fetchProject = fetch) {
 const url = new URL(origin);
 if (url.protocol !== 'https:' || url.href !== url.origin + '/') throw Error('HTTPS origin required');
 const endpoint = new URL('https://identitytoolkit.googleapis.com/v1/projects');
 endpoint.searchParams.set('key', firebaseWebConfig.apiKey);
 const response = await fetchProject(endpoint, { signal: AbortSignal.timeout(10000), redirect: 'error' });
 if (!response.ok) throw Error('Firebase project lookup returned HTTP ' + response.status);
 const { authorizedDomains } = await response.json();
 if (!Array.isArray(authorizedDomains) || authorizedDomains.some(domain => typeof domain !== 'string')) {
  throw Error('Firebase did not return an authorized domain list');
 }
 const host = url.hostname.toLowerCase();
 return authorizedDomains.some(domain => {
  const allowed = domain.toLowerCase();
  return host === allowed || (!isIP(allowed) && host.endsWith('.' + allowed));
 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const allowed = await checkDomain(process.argv[2]);
  console.log(allowed ? 'Firebase Authentication authorized domain confirmed.' : 'Firebase Authentication domain is not authorized.');
  if (!allowed) process.exitCode = 1;
 } catch (error) {
  console.error('Firebase Authentication domain check failed: ' + error.message);
  process.exitCode = 2;
 }
}
