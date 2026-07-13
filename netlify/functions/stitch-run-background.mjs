// stitch-run-background.mjs - B3.52 - the real render: FFmpeg on the server.
// Background function (15 min budget). {job, clips:["clip00.mp4",...], audio:"mix.wav"|null, w,h,fps}
// Writes status to {job}/status.json and the finished film to {job}/out.mp4 in Blobs.
import { getStore } from '@netlify/blobs';
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import ffmpegPath from 'ffmpeg-static';

async function setStatus(store, job, obj) {
  try { await store.setJSON(job + '/status.json', obj); } catch (e) {}
}
async function assemble(store, job, name) {
  const meta = await store.get(job + '/' + name + '.meta', { type: 'json' });
  if (!meta) throw new Error('missing upload: ' + name);
  const parts = [];
  for (let i = 0; i < meta.parts; i++) {
    const ab = await store.get(job + '/' + name + '.part' + i, { type: 'arrayBuffer' });
    if (!ab) throw new Error('missing chunk ' + i + ' of ' + name);
    parts.push(Buffer.from(ab));
  }
  return Buffer.concat(parts);
}

export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch (e) {}
  const job = String(body.job || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const clips = Array.isArray(body.clips) ? body.clips.slice(0, 40) : [];
  const store = getStore('glynn-stitch');
  if (!job || !clips.length) { await setStatus(store, job || 'unknown', { state: 'error', error: 'job and clips required' }); return new Response('', { status: 202 }); }
  const W = parseInt(body.w, 10) || 720, H = parseInt(body.h, 10) || 1280, FPS = parseInt(body.fps, 10) || 30;
  const dir = '/tmp/' + job;
  try {
    await setStatus(store, job, { state: 'preparing', pct: 2 });
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < clips.length; i++) {
      const nm = String(clips[i]).replace(/[^a-zA-Z0-9._-]/g, '');
      const buf = await assemble(store, job, nm);
      await writeFile(dir + '/' + nm, buf);
      await setStatus(store, job, { state: 'preparing', pct: 2 + Math.round((i + 1) * 18 / clips.length) });
    }
    let hasAudio = false;
    if (body.audio) {
      try { const ab = await assemble(store, job, String(body.audio)); await writeFile(dir + '/mix.wav', ab); hasAudio = true; } catch (e) {}
    }
    const args = [];
    for (const c of clips) args.push('-i', dir + '/' + String(c).replace(/[^a-zA-Z0-9._-]/g, ''));
    if (hasAudio) args.push('-i', dir + '/mix.wav');
    let fc = '';
    for (let i = 0; i < clips.length; i++) {
      fc += '[' + i + ':v]scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2:color=black,fps=' + FPS + ',format=yuv420p,setsar=1[v' + i + '];';
    }
    for (let i = 0; i < clips.length; i++) fc += '[v' + i + ']';
    fc += 'concat=n=' + clips.length + ':v=1:a=0[vout]';
    args.push('-filter_complex', fc, '-map', '[vout]');
    if (hasAudio) args.push('-map', String(clips.length) + ':a', '-c:a', 'aac', '-b:a', '160k');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-movflags', '+faststart', '-shortest', '-y', dir + '/out.mp4');
    await setStatus(store, job, { state: 'rendering', pct: 25 });
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, args);
      let errTail = '';
      p.stderr.on('data', (d) => {
        errTail = (errTail + d.toString()).slice(-1500);
        const m = errTail.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
        if (m && m.length) {
          const last = m[m.length - 1].match(/time=(\d+):(\d+):(\d+\.\d+)/);
          const sec = parseInt(last[1], 10) * 3600 + parseInt(last[2], 10) * 60 + parseFloat(last[3]);
          const total = parseFloat(body.total) || 60;
          const pct = 25 + Math.min(70, Math.round(sec * 70 / total));
          setStatus(store, job, { state: 'rendering', pct });
        }
      });
      p.on('error', reject);
      p.on('close', (code) => { if (code === 0) resolve(); else reject(new Error('ffmpeg exit ' + code + ': ' + errTail.slice(-400))); });
    });
    const out = await readFile(dir + '/out.mp4');
    await store.set(job + '/out.mp4', out);
    await setStatus(store, job, { state: 'done', pct: 100, size: out.length });
  } catch (err) {
    await setStatus(store, job, { state: 'error', error: String(err && err.message ? err.message : err).slice(0, 500) });
  }
  return new Response('', { status: 202 });
};
