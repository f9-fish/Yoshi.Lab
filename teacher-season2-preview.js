import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
 browserLocalPersistence, browserPopupRedirectResolver, getAuth, getIdTokenResult, getRedirectResult, GoogleAuthProvider,
 inMemoryPersistence, initializeAuth,
 onIdTokenChanged, setPersistence, signInWithPopup, signInWithRedirect,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getDatabase, onValue, ref } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { firebaseWebConfig } from './firebase-web-config.js';
import { watchTeacherAccess } from './teacher-preview-access.js';
import { mountSeasonOpening } from './season2-opening.js';

const app = initializeApp(firebaseWebConfig);
const homeSource = document.querySelector('meta[name=preview-home-source]')?.content;
const auth = homeSource
 ? initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver })
 : getAuth(app);
const db = getDatabase(app);
const status = document.getElementById('previewAccessStatus');
const login = document.getElementById('previewLogin');
const outlet = document.getElementById('previewOutlet');
const messages = {
 checking: '教員権限を確認しています…',
 'signed-out': '学校のGoogleアカウントでログインしてください。',
 denied: '教員アカウントでのみプレビューを利用できます。',
 offline: '教員権限を確認するため、接続を待っています。',
 error: '教員権限を確認できませんでした。接続を確認し、再読み込みしてください。',
};
let generation = 0;
let unmount;
watchTeacherAccess({
 observeAccount: receive => onIdTokenChanged(auth, receive),
 getTokenInfo: getIdTokenResult,
 observeConnection: (receive, fail) => onValue(ref(db, '.info/connected'), value => receive(value.val() === true), fail),
 observeRole: (uid, receive, fail) => onValue(ref(db, 'teacherUids/' + uid), value => receive(value.val()), fail),
}, async decision => {
 const serial = ++generation;
 unmount?.();
 unmount = undefined;
 outlet.hidden = true;
 document.getElementById('previewAccess').hidden = false;
 status.textContent = messages[decision] || 'ホーム画面を準備しています…';
 login.hidden = !['signed-out', 'denied'].includes(decision);
 if (decision !== 'allowed') return;
 try {
  // Inert Home markup provides the existing subject entry points and branding.
  const response = await fetch(homeSource || './index.html');
  if (!response.ok) throw Error('Home unavailable');
  const template = document.createElement('template');
  template.innerHTML = await response.text();
  if (generation !== serial) return;
  unmount = mountSeasonOpening(outlet, template.content);
  document.getElementById('previewAccess').hidden = true;
 } catch {
  if (generation === serial) status.textContent = 'ホーム画面を読み込めませんでした。再読み込みしてください。';
 }
});

login.onclick = async () => {
 const provider = new GoogleAuthProvider();
 provider.setCustomParameters({ prompt: 'select_account' });
 login.disabled = true;
 try {
  if (!homeSource) await setPersistence(auth, browserLocalPersistence);
  try {
   await signInWithPopup(auth, provider);
  } catch (error) {
   if (homeSource || !['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(error.code)) throw error;
   await signInWithRedirect(auth, provider);
  }
 } catch (error) {
  status.textContent = error.code === 'auth/popup-blocked'
   ? 'ログインのポップアップを許可し、再試行してください。'
   : 'ログインできませんでした。再試行してください。';
 } finally {
  login.disabled = false;
 }
};
if (!homeSource) getRedirectResult(auth).catch(() => {
 if (!auth.currentUser) status.textContent = 'ログインできませんでした。再試行してください。';
});
