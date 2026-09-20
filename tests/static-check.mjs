import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const fail = (msg) => { console.error('❌ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('✅ ' + msg);

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).filter(s => s.trim());

if (!scripts.length) fail('index.html no contiene script inline');
scripts.forEach((src, i) => {
  try { new Function(src); ok(`index.html script ${i + 1} parsea`); }
  catch (e) { fail(`index.html script ${i + 1}: ${e.message}`); }
});

for (const file of [
  'api/_lib/gcp.js','api/_lib/texto.js','api/assemble.js','api/audio.js',
  'api/download-url.js','api/health.js','api/image.js','api/music.js',
  'api/script.js','api/transcribe.js','api/upload-url.js','api/video-start.js',
  'api/video-status.js','api/voices.js'
]) {
  const src = fs.readFileSync(file, 'utf8');
  try { new Function('module','exports','require','process','fetch','Buffer',src); ok(file + ' parsea'); }
  catch (e) { fail(file + ': ' + e.message); }
}

// Build an actual montage shell script and let bash validate its quoting.
// Parsing the JavaScript alone cannot catch a malformed ffmpeg/case expression
// inside a generated template string.
try {
  const fnStart = html.indexOf('function buildMontarScript(');
  const fnEndMarker = '\n}\n\n// ════════════════════════════════════════════════════════════════\n// VOLUMEN DE LA MÚSICA';
  const fnEnd = html.indexOf(fnEndMarker, fnStart);
  if (fnStart < 0 || fnEnd < 0) throw new Error('no se encontró buildMontarScript');
  const fnText = html.slice(fnStart, fnEnd + 2);
  const build = new Function(fnText + '; return buildMontarScript;')();
  const shell = build([
    { audio:'narr_000.wav', planos:[{ image:'img_000.png' }] },
    { audio:'narr_001.wav', planos:[{ clip:'vid_001.mp4' }, { image:'img_001.png' }] }
  ], { vertical:false, hasMusic:true, musicVol:25, episodio:1 });
  fs.writeFileSync('/tmp/anime-studio-montar-test.sh', shell);
  execFileSync('bash', ['-n', '/tmp/anime-studio-montar-test.sh'], { stdio:'pipe' });
  ok('buildMontarScript genera bash válido');
} catch (e) {
  fail('buildMontarScript: ' + (e.stderr?.toString() || e.message));
}

const required = [
  ['storyModeSelect', 'selector Narrada/Dramatizada'],
  ['endingModeSelect', 'selector de cierre'],
  ['motionProfileSelect', 'perfil de movimiento'],
  ["hora:       { scenes: 84", 'formato de 60 minutos'],
  ["hora_media: { scenes: 120", 'formato de 90 minutos'],
  ["ESTILO_POR_DEFECTO = 'japon_2d'", 'anime japonés 2D por defecto'],
  ['REGISTRO_LONGFORM_REFERENCIA', 'motor narrativo largo'],
  ['generarAudioDeEscena', 'audio dramatizado por intervención'],
  ['tiposMovimiento', 'dirección motion-comic'],
  ['continuarAnterior', 'continuidad explícita entre escenas'],
  ['btnAllCharacterRefs', 'generación en lote de referencias maestras'],
  ['longformDrafts', 'reanudación persistente de historias largas'],
  ['creativeVersion', 'versionado compatible de proyectos'],
  ['Motion anime', 'perfil motion-anime visible']
];
for (const [needle, label] of required) html.includes(needle) ? ok(label) : fail('Falta ' + label);

if (/reintentando sin refs/i.test(html)) fail('Todavía existe un fallback que elimina referencias de personaje');
else ok('Nunca se eliminan referencias de identidad silenciosamente');

if (/on\/CF/.test(html)) fail('Montaje contiene CF sin expansión en un paneo');
else ok('Paneos de montaje expanden el conteo de fotogramas');

if (/Facebook Reels/i.test(html)) fail('El motor largo todavía contiene reglas editoriales de Facebook Reels');
else ok('El motor largo no hereda reglas de Facebook Reels');

if (/REGLAS DE PERSONAJES FEMENINOS/.test(html)) fail('Persisten reglas de apariencia femenina de fórmula');
else ok('El reparto no usa un molde femenino obligatorio');

const imageApi = fs.readFileSync('api/image.js','utf8');
if (!/AUTHENTIC JAPANESE HAND-DRAWN 2D TV ANIME FRAME/.test(imageApi)) fail('api/image.js no comparte el contrato japonés 2D');
else ok('api/image.js comparte el contrato japonés 2D');
if (/form-fitting clothing, blushing expressions, suggestive poses/.test(imageApi)) fail('api/image.js todavía fuerza fan service genérico en todas las escenas');
else ok('Fan service del servidor es situacional, no obligatorio por fotograma');

const gcp = fs.readFileSync('api/_lib/gcp.js','utf8');
const setup = fs.readFileSync('setup.sh','utf8');
if (!gcp.includes("anime-studio-montage") || !setup.includes('anime-studio-montage')) fail('El nombre del Job no coincide entre código e instalador');
else ok('Montador y aplicación usan el mismo Job');

if (process.exitCode) process.exit(process.exitCode);
console.log('\nValidación estática completa.');
