// Inline Animes startup must wait for the same verified session as Cortos.
// This only coordinates the UI; every API still verifies the owner itself.
window.studioAccessReady = new Promise(resolve => {
  window.addEventListener('studio-access-ready', resolve, { once: true });
});
