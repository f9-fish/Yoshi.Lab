// No URL or storage state participates in authorization.
export function watchTeacherAccess({ observeAccount, getTokenInfo, observeConnection, observeRole }, notify) {
 let disposeAccount = () => {};
 const unsubscribe = observeAccount(async user => {
  disposeAccount();
  let current = true;
  let stopConnection, stopRole;
  let connectionVersion = 0;
  disposeAccount = () => {
   current = false;
   stopRole?.();
   stopConnection?.();
  };

  if (!user || user.isAnonymous || !user.emailVerified) {
   notify(user ? 'denied' : 'signed-out');
   return;
  }
  notify('checking');
  try {
   const token = await getTokenInfo(user);
   if (!current) return;
   if (token.signInProvider !== 'google.com') {
    notify('denied');
    return;
   }
   stopConnection = observeConnection(connected => {
    if (!current) return;
    const version = ++connectionVersion;
    stopRole?.();
    stopRole = undefined;
    if (!connected) {
     notify('offline');
     return;
    }
    notify('checking');
    stopRole = observeRole(user.uid, value => {
     if (current && connectionVersion === version) notify(value === true ? 'allowed' : 'denied');
    }, () => {
     if (current && connectionVersion === version) notify('error');
    });
   }, () => { if (current) notify('error'); });
  } catch {
   if (current) notify('error');
  }
 });
 return () => { disposeAccount(); unsubscribe(); };
}
