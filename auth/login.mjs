import { getClient, syncSession, sessionRequest } from './client.mjs';
const button = document.querySelector('#signin'), status = document.querySelector('#status');
const requested = new URL(location.href).searchParams.get('next');
const destination = requested === '/cortos/' ? '/cortos/' : '/';
async function enter(user) {
  status.textContent = 'Comprobando tu acceso…';
  await syncSession(user);
  location.replace(destination);
}
async function boot() {
  const { auth, sdk } = await getClient();
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  button.onclick = async () => {
    button.disabled = true;
    try { const result = await sdk.signInWithPopup(auth, provider); await enter(result.user); }
    catch (e) {
      status.textContent = e.code === 'auth/popup-blocked' ? 'Permite la ventana de Google en Safari y vuelve a pulsar Entrar.' : e.code ? 'No se completó el acceso con Google. Puedes intentarlo otra vez.' : e.message;
      if (e.status === 401 || e.status === 403) { await sessionRequest('logout'); await sdk.signOut(auth); }
    } finally { button.disabled = false; }
  };
  if (auth.currentUser) {
    try { await enter(auth.currentUser); return; }
    catch (e) { status.textContent = e.message; await sessionRequest('logout'); await sdk.signOut(auth); }
  } else status.textContent = '';
  button.disabled = false;
}
boot().catch(error => { status.textContent = error.message; });
