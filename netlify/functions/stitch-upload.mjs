// stitch-upload.js - B3.52 - receives base64 chunks of clips/soundtrack into Netlify Blobs
// {job, name, off, b64, done} -> appends chunk; done:true finalizes the part.
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const HDR = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: HDR });
  let body;
  try { body = await req.json(); } catch (e) { return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400, headers: HDR }); }
  const job = String(body.job || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const name = String(body.name || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
  if (!job || !name) return new Response(JSON.stringify({ error: 'job and name required' }), { status: 400, headers: HDR });
  try {
    const store = getStore('glynn-stitch');
    const key = job + '/' + name + '.part' + String(parseInt(body.off, 10) || 0);
    if (body.b64) {
      const buf = Buffer.from(String(body.b64), 'base64');
      await store.set(key, buf);
    }
    if (body.done) {
      // record the part count so the runner can reassemble in order
      await store.setJSON(job + '/' + name + '.meta', { parts: parseInt(body.parts, 10) || 1, size: parseInt(body.size, 10) || 0 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: HDR });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message ? err.message : err) }), { status: 200, headers: HDR });
  }
};
