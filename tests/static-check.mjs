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
    { audio:'narr_001.wav', planos:[
      { clip:'vid_same.mp4', image:'img_001.png' },
      { clip:'vid_same.mp4', image:'img_002.png' }
    ] }
  ], { vertical:false, hasMusic:true, musicVol:25, episodio:1 });
  const repeatedInputs = (shell.match(/-i vid_same\.mp4/g) || []).length;
  if (repeatedInputs !== 1) throw new Error('el mismo clip consecutivo se usaría más de una vez');
  fs.writeFileSync('/tmp/anime-studio-montar-test.sh', shell);
  execFileSync('bash', ['-n', '/tmp/anime-studio-montar-test.sh'], { stdio:'pipe' });
  ok('buildMontarScript genera bash válido');
} catch (e) {
  fail('buildMontarScript: ' + (e.stderr?.toString() || e.message));
}

const required = [
  ['storyModeSelect', 'selector Narrado/Voces por personaje'],
  ['endingModeSelect', 'selector de cierre'],
  ["hora:       { scenes: 84", 'formato de 60 minutos'],
  ["hora_media: { scenes: 120", 'formato de 90 minutos'],
  ["ESTILO_POR_DEFECTO = 'japon_2d'", 'anime japonés 2D por defecto'],
  ['REGISTRO_LONGFORM_REFERENCIA', 'motor narrativo largo'],
  ['generarAudioDeEscena', 'audio dramatizado por intervención'],
  ['videoRecommendedA', 'recomendación de video por plano'],
  ['continuarAnterior', 'continuidad explícita entre escenas'],
  ['btnAllCharacterRefs', 'generación en lote de referencias maestras'],
  ['generationDrafts', 'reanudación persistente para cualquier duración'],
  ['sceneVidOpKeyBy', 'reanudación de operaciones Veo en curso'],
  ['creativeVersion', 'versionado compatible de proyectos']
];
for (const [needle, label] of required) html.includes(needle) ? ok(label) : fail('Falta ' + label);

if (/btnRepairScenes|Reparar escenas vacías/i.test(html)) fail('Volvió a aparecer reparación manual de escenas');
else ok('No existe botón de reparación post-hoc');

if (/motionProfileSelect/.test(html)) fail('Motion anime volvió a aparecer como un modo separado');
else ok('Motion anime no es un tipo de proyecto; es interno al montaje');

if (/panel-corto|data-panel="corto"|CORTO CINEMATOGRÁFICO|btnEscribirCorto/.test(html)) {
  fail('Volvió a aparecer el flujo legado de cortos');
} else {
  ok('No existe un flujo separado de cortos');
}

const modeBlock = html.match(/<select id="storyModeSelect">([\s\S]*?)<\/select>/)?.[1] || '';
const projectModes = [...modeBlock.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
if (projectModes.length !== 2 || projectModes[0] !== 'narrated' || projectModes[1] !== 'cast') {
  fail('Los tipos de proyecto visibles no son exactamente Narrado y Voces por personaje');
} else {
  ok('Sólo existen dos tipos de proyecto: Narrado y Voces por personaje');
}

if (/if \(best\) return best/.test(html)) fail('El guion todavía acepta bloques cortos como éxito');
else ok('Los bloques de historia insuficientes no se aceptan');

if (/while \(chunks\.length < wanted\) chunks\.push\(''\)/.test(html)) fail('La división todavía puede fabricar escenas vacías');
else ok('La división no rellena escenas con cadenas vacías');

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
if (!setup.includes("gcloud auth list") || !setup.includes("Cuenta Google activa")) fail('setup.sh no valida la cuenta activa de Cloud Shell');
else ok('setup.sh usa la sesión/proyecto activos; no depende de un correo hardcodeado');

if (process.exitCode) process.exit(process.exitCode);
console.log('\nValidación estática completa.');
