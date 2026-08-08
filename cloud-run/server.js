// ════════════════════════════════════════════════════════════════
// ASSEMBLY SERVICE — turns an episode's assets into one MP4.
//
// Runs on Cloud Run because ffmpeg needs real CPU, real disk and
// minutes of wall clock: Vercel caps functions at 60s and cannot
// hold a 16-minute render.
//
// Contract:
//   POST /render   { manifest }  → { jobId }        (returns immediately)
//   GET  /status/:jobId          → { state, ... }
//   GET  /healthz                → { ok: true }
//
// The manifest references assets by GCS object path; this service
// downloads them with its own service account (Cloud Run's identity),
// renders, uploads the result and reports a signed URL.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const app = express();
app.use(express.json({ limit: '32mb' }));

const storage = new Storage();
const BUCKET = (process.env.GCS_OUTPUT_BUCKET || '').replace(/^gs:\/\//, '').replace(/\/+$/, '');

// Jobs live in memory. Cloud Run keeps the instance alive while a render is
// running (CPU is always allocated in this deployment), and a lost job simply
// means the client re-renders — no state worth a database.
const jobs = new Map();

const run = (bin, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let err = '';
  p.stdout.on('data', d => { if (opts.onStdout) opts.onStdout(String(d)); });
  p.stderr.on('data', d => { err += d; if (err.length > 40000) err = err.slice(-20000); });
  p.on('error', reject);
  p.on('close', code => code === 0 ? resolve() : reject(new Error(`${bin} salió con código ${code}: ${err.slice(-1500)}`)));
});

const ffprobeDuration = async file => {
  let out = '';
  await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file], { onStdout: d => { out += d; } });
  const v = parseFloat(out.trim());
  return Number.isFinite(v) ? v : 0;
};

async function download(objectPath, dest) {
  await storage.bucket(BUCKET).file(objectPath).download({ destination: dest });
}

// ─── Render ───
// Each scene becomes a segment: its still (with a slow Ken Burns push) or its
// Veo clip, held for exactly the length of that scene's narration. Segments are
// concatenated, the narration track is laid over the whole thing, music is
// mixed underneath, and subtitles are burned in.
async function render(job) {
  const { manifest } = job;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-'));
  job.dir = dir;

  const W = manifest.aspectRatio === '16:9' ? 1920 : 1080;
  const H = manifest.aspectRatio === '16:9' ? 1080 : 1920;
  const FPS = 24;

  try {
    // 1. Narration: download every scene's audio, measure it, concatenate.
    job.state = 'descargando';
    const narrParts = [];
    for (let i = 0; i < manifest.scenes.length; i++) {
      const s = manifest.scenes[i];
      if (!s.audio) continue;
      const f = path.join(dir, `narr_${i}.wav`);
      await download(s.audio, f);
      narrParts.push({ i, file: f, dur: await ffprobeDuration(f) });
    }
    if (!narrParts.length) throw new Error('El episodio no tiene narración generada');

    // Each scene lasts exactly its narration; scenes without audio get a floor
    // so a missing track never collapses a segment to zero frames.
    const durations = manifest.scenes.map((_, i) => {
      const p = narrParts.find(n => n.i === i);
      return p ? Math.max(p.dur, 0.5) : 2.0;
    });

    const narrList = path.join(dir, 'narr.txt');
    await fs.writeFile(narrList, narrParts.map(p => `file '${p.file}'`).join('\n'));
    const narration = path.join(dir, 'narration.wav');
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', narrList, '-c', 'copy', narration]);
    const totalDur = durations.reduce((a, b) => a + b, 0);

    // 2. One video segment per scene.
    job.state = 'montando escenas';
    const segments = [];
    for (let i = 0; i < manifest.scenes.length; i++) {
      const s = manifest.scenes[i];
      const dur = durations[i];
      const out = path.join(dir, `seg_${String(i).padStart(3, '0')}.mp4`);
      job.progress = Math.round((i / manifest.scenes.length) * 60);

      if (s.clip) {
        // Veo clip: loop or trim it to the narration length.
        const src = path.join(dir, `clip_${i}.mp4`);
        await download(s.clip, src);
        await run('ffmpeg', ['-y', '-stream_loop', '-1', '-i', src, '-t', String(dur),
          '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`,
          '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out]);
      } else if (s.image) {
        // Still: slow zoom so the frame is never completely static.
        const src = path.join(dir, `img_${i}.png`);
        await download(s.image, src);
        const frames = Math.max(Math.round(dur * FPS), 1);
        // zoompan works on an upscaled copy to avoid the jitter it shows at 1x.
        await run('ffmpeg', ['-y', '-loop', '1', '-i', src, '-t', String(dur),
          '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},`
               + `zoompan=z='min(zoom+0.0006,1.12)':d=${frames}:s=${W}x${H}:fps=${FPS},`
               + `format=yuv420p`,
          '-an', '-c:v', 'libx264', '-preset', 'veryfast', out]);
      } else {
        // Neither asset: black, so the timeline stays aligned with the audio.
        await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}`,
          '-t', String(dur), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out]);
      }
      segments.push(out);
    }

    // 3. Concatenate the segments.
    job.state = 'uniendo';
    job.progress = 65;
    const segList = path.join(dir, 'segs.txt');
    await fs.writeFile(segList, segments.map(f => `file '${f}'`).join('\n'));
    const silent = path.join(dir, 'silent.mp4');
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', segList, '-c', 'copy', silent]);

    // 4. Music: concatenate the act cues, loop to cover the episode, duck it
    //    under the narration.
    job.state = 'mezclando audio';
    job.progress = 75;
    let musicFile = null;
    const cues = manifest.music || [];
    if (cues.length) {
      const cueFiles = [];
      for (let i = 0; i < cues.length; i++) {
        const f = path.join(dir, `mus_${i}.wav`);
        await download(cues[i], f);
        cueFiles.push(f);
      }
      const musList = path.join(dir, 'mus.txt');
      await fs.writeFile(musList, cueFiles.map(f => `file '${f}'`).join('\n'));
      musicFile = path.join(dir, 'music.wav');
      await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', musList, '-c', 'copy', musicFile]);
    }

    const mixed = path.join(dir, 'mixed.wav');
    const musicGain = typeof manifest.musicGain === 'number' ? manifest.musicGain : 0.18;
    if (musicFile) {
      await run('ffmpeg', ['-y', '-i', narration, '-stream_loop', '-1', '-i', musicFile,
        '-filter_complex',
        `[1:a]volume=${musicGain},afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(totalDur - 3, 0)}:d=3[m];`
        + `[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
        '-map', '[a]', '-t', String(totalDur), mixed]);
    } else {
      await fs.copyFile(narration, mixed);
    }

    // 5. Mux, burning subtitles in when the client sent an SRT.
    job.state = 'renderizando';
    job.progress = 85;
    const final = path.join(dir, 'episodio.mp4');
    const args = ['-y', '-i', silent, '-i', mixed];
    if (manifest.srt) {
      const srtFile = path.join(dir, 'subs.srt');
      await fs.writeFile(srtFile, manifest.srt, 'utf8');
      // Escaping matters: the filter argument is parsed by ffmpeg, not a shell.
      const escaped = srtFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
      args.push('-vf', `subtitles='${escaped}':force_style='FontName=DejaVu Sans,Fontsize=${manifest.aspectRatio === '16:9' ? 22 : 18},`
        + `PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=${manifest.aspectRatio === '16:9' ? 40 : 160}'`);
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20');
    } else {
      args.push('-c:v', 'copy');
    }
    args.push('-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final);
    await run('ffmpeg', args);

    // 6. Upload and hand back a signed URL.
    job.state = 'subiendo';
    job.progress = 95;
    const objectPath = `ensamblados/${manifest.projectId || 'proyecto'}/${job.id}.mp4`;
    await storage.bucket(BUCKET).upload(final, { destination: objectPath, contentType: 'video/mp4' });
    const [url] = await storage.bucket(BUCKET).file(objectPath).getSignedUrl({
      version: 'v4', action: 'read', expires: Date.now() + 7 * 24 * 3600 * 1000,
    });

    job.state = 'listo';
    job.progress = 100;
    job.url = url;
    job.gcsUri = `gs://${BUCKET}/${objectPath}`;
    job.durationSeconds = Math.round(totalDur);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

app.get('/healthz', (req, res) => res.json({ ok: true, bucket: BUCKET || null, ffmpeg: fsSync.existsSync('/usr/bin/ffmpeg') }));

app.post('/render', (req, res) => {
  const manifest = req.body?.manifest;
  if (!manifest?.scenes?.length) return res.status(400).json({ error: 'manifest.scenes requerido' });
  if (!BUCKET) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en el servicio' });

  const id = randomUUID();
  const job = { id, state: 'en cola', progress: 0, manifest, createdAt: Date.now() };
  jobs.set(id, job);

  // Render in the background so the HTTP call returns immediately.
  render(job).catch(e => {
    console.error('render falló:', e);
    job.state = 'error';
    job.error = e.message;
  });

  // Keep the map from growing without bound.
  for (const [k, v] of jobs) if (Date.now() - v.createdAt > 6 * 3600 * 1000) jobs.delete(k);

  res.json({ jobId: id });
});

app.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job no encontrado (el servicio pudo reiniciarse)' });
  res.json({
    state: job.state, progress: job.progress, error: job.error,
    url: job.url, gcsUri: job.gcsUri, durationSeconds: job.durationSeconds,
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`assembly service escuchando en :${port} (bucket: ${BUCKET || 'SIN CONFIGURAR'})`));
