// stitch-result.mjs - B3.52 - poll job status and stream the finished MP4 in chunks.
// {job, action:'status'} -> {state,pct,size?,error?}
// {job, action:'chunk', off} -> {b64, next, done, total}
import { getStore } from '@netlify/blobs';

const CHUNK = 3 * 1024 * 1024;

export default async (req) => {
  const HDR = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: HDR });
  let body;
  try { body = await req.json(); } catch (e) { return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400, headers: HDR }); }
  const job = String(body.job || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  if (!job) return new Response(JSON.stringify({ error: 'job required' }), { status: 400, headers: HDR });
  try {
    const store = getStore('glynn-stitch');
    if (body.action === 'status') {
      const st = await store.get(job + '/status.json', { type: 'json' });
      return new Response(JSON.stringify(st || { state: 'pending', pct: 0 }), { status: 200, headers: HDR });
    }
    if (body.action === 'chunk') {
      const ab = await store.get(job + '/out.mp4', { type: 'arrayBuffer' });
      if (!ab) return new Response(JSON.stringify({ error: 'not ready' }), { status: 200, headers: HDR });
      const buf = Buffer.from(ab);
      const off = Math.max(0, parseInt(body.off, 10) || 0);
      const end = Math.min(buf.length, off + CHUNK);
      const b64 = buf.subarray(off, end).toString('base64');
      return new Response(JSON.stringify({ b64, next: end, done: end >= buf.length, total: buf.length }), { status: 200, headers: HDR });
    }
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: HDR });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message ? err.message : err) }), { status: 200, headers: HDR });
  }
};
