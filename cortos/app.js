import { api, say, mountStudio } from './studio.mjs';
import { protectPage, signOut } from '/auth/client.mjs';
async function boot() {
  document.querySelector('#account').onclick = () => signOut().catch(e => say(e.message, true));
  await protectPage(async user => {
    const config = await api('/config');
    if (!config.enabled || !config.configured) { say('Cortos aún no está conectado.'); return; }
    await mountStudio(user);
  }, e => say(e.message, true));
}
boot().catch(e => say(e.message, true));
