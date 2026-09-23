import {api,say,mountStudio} from './studio.mjs';
const $=selector=>document.querySelector(selector);
async function boot(){
 const c=await api('/config');
 if(!c.enabled||!c.configured){say('Cortos aún no está conectado.');return;}
 const [firebase,authentication]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]);
 const auth=authentication.getAuth(firebase.initializeApp(c.firebase));
 $('#login').hidden=false;
 $('#signin').onclick=async()=>{try{await authentication.signInWithPopup(auth,new authentication.GoogleAuthProvider());}catch(e){say(e.code==='auth/popup-blocked'?'Abre esta página en Safari y permite la ventana de inicio de sesión.':'No se completó el inicio de sesión. Intenta entrar otra vez.',true);}};
 $('#account').onclick=()=>authentication.signOut(auth);
 authentication.onAuthStateChanged(auth,u=>mountStudio(u).catch(e=>say(e.message,true)));
}
boot().catch(e=>say(e.message,true));
