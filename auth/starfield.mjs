// Same background as Animes; no generation, storage or project dependencies.
const field = document.querySelector('#starfield');
if (field) {
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2 + .5;
    star.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*4}s`;
    field.append(star);
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  setInterval(() => {
    if (document.hidden || reduced.matches) return;
    const comet = document.createElement('div');
    comet.className = 'comet';
    comet.style.animation = 'shoot 3s linear';
    field.append(comet);
    setTimeout(() => comet.remove(), 3000);
  }, 8000);
}
