const endpoint = '/api/health?studioAuth=';
let client;
export async function sessionRequest(action, token) {
  const post = action === 'session' || action === 'logout';
  const response = await fetch(endpoint + action, { method: post ? 'POST' : 'GET', credentials: 'same-origin',
    headers: token ? { Authorization: 'Bearer ' + token } : {}, cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error || 'No se pudo comprobar el acceso.'); error.status = response.status; throw error; }
  return value;
}
export function getClient() {
  return client ||= (async () => {
    const config = await sessionRequest('config');
    const [app, sdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
    ]);
    const auth = sdk.getAuth(app.getApps()[0] || app.initializeApp(config.firebase));
    await auth.authStateReady();
    return { auth, sdk };
  })();
}
export async function syncSession(user) {
  return sessionRequest('session', await user.getIdToken());
}
export async function signOut() {
  // Clear the shared server cookie before navigating away or clearing Firebase.
  await sessionRequest('logout');
  const { auth, sdk } = await getClient();
  await sdk.signOut(auth);
  location.replace('/login/');
}
export function loginPath() {
  return '/login/?next=' + encodeURIComponent(location.pathname.startsWith('/cortos') ? '/cortos/' : '/');
}
export async function protectPage(onUser = () => {}, onError = showSessionError) {
  const { auth, sdk } = await getClient();
  let mounted, mounting;
  sdk.onIdTokenChanged(auth, async user => {
    try {
      if (!user) { await sessionRequest('logout'); location.replace(loginPath()); return; }
      await syncSession(user);
      if (mounted !== user.uid) {
        // getIdToken can notify again while the first mount is awaiting its
        // project list. Share that mount; token refresh must preserve the form.
        if (!mounting || mounting.uid !== user.uid) {
          const current = { uid:user.uid };
          current.promise = Promise.resolve().then(() => onUser(user)).then(() => { mounted = user.uid; })
            .finally(() => { if (mounting === current) mounting = undefined; });
          mounting = current;
        }
        await mounting.promise;
      }
    } catch (e) { onError(e); }
  });
  // Safari can suspend refresh timers in the background. Renew on return;
  // never replay a generation or reload an in-progress Animes project.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && auth.currentUser) syncSession(auth.currentUser).catch(onError);
  });
  const button = document.querySelector('[data-studio-signout]');
  if (button) button.onclick = () => signOut().catch(onError);
}
export function showSessionError(error) {
  let notice = document.querySelector('#studio-access-notice');
  if (!notice) {
    notice = document.createElement('dialog'); notice.id = 'studio-access-notice';
    notice.style.cssText = 'max-width:28rem;padding:24px;border:1px solid rgba(180,140,255,.3);border-radius:18px;background:#0f0f2e;color:#f0eeff;font:16px/1.6 "M PLUS Rounded 1c",sans-serif';
    const text = document.createElement('p'); notice.append(text);
    const link = document.createElement('a'); link.textContent = 'Comprobar mi acceso'; link.href = loginPath(); link.target = '_blank'; link.rel = 'noopener'; link.style.color = '#00e5ff'; notice.append(link);
    const close = document.createElement('button'); close.textContent = 'Volver al proyecto'; close.style.cssText = 'display:block;margin-top:20px;padding:10px'; close.onclick = () => notice.close(); notice.append(close);
    document.body.append(notice);
  }
  notice.querySelector('p').textContent = error.message;
  if (!notice.open) notice.showModal();
}
