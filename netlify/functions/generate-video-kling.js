// netlify/functions/generate-video-kling.js
// Kling 1.6 via official Kling API (kling.ai/dev keys)

const crypto = require('crypto');

function generateJWT(ak, sk) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ak, exp: now + 3600, nbf: now - 5
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', sk).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const headers = { 'Content-Type': 'application/json' };
  try {
    const { ak, sk, action, task_id, prompt, duration, ratio, mode } = JSON.parse(event.body);
    if (!ak || !sk) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing Kling keys' }) };

    const token = generateJWT(ak, sk);
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

    // ── POLL ──────────────────────────────────────────────────────
    if (action === 'poll' && task_id) {
      const resp = await fetch(`https://api.klingai.com/v1/videos/text2video/${task_id}`, { headers: authHeaders });
      const data = await resp.json();
      console.log('KLING16 POLL:', data.code, data.data && data.data.task_status);
      if (data.code !== 0) throw new Error(`Kling ${data.code}: ${data.message}`);
      const td = data.data;
      const status = td.task_status;
      let video_url = '';
      if (status === 'succeed' && td.task_result && td.task_result.videos) {
        video_url = td.task_result.videos[0].url || '';
      }
      return { statusCode: 200, headers, body: JSON.stringify({ status, video_url }) };
    }

    // ── SUBMIT ────────────────────────────────────────────────────
    if (!prompt) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
    const validDur = duration <= 5 ? 5 : 10;
    const ratioMap = { '16:9':'16:9','9:16':'9:16','1:1':'1:1','4:3':'4:3','3:4':'3:4' };
    const payload = {
      model_name: 'kling-v1-6',
      prompt: prompt.substring(0, 2500),
      duration: String(validDur),
      aspect_ratio: ratioMap[ratio] || '9:16',
      mode: (mode === 'pro') ? 'pro' : 'std',
      cfg_scale: 0.5
    };
    console.log('KLING16 SUBMIT:', JSON.stringify(payload).substring(0, 200));
    const resp = await fetch('https://api.klingai.com/v1/videos/text2video', {
      method: 'POST', headers: authHeaders, body: JSON.stringify(payload)
    });
    const data = await resp.json();
    console.log('KLING16 SUBMIT RESULT:', data.code, data.message || '');
    if (data.code !== 0) throw new Error(`Kling ${data.code}: ${data.message}`);
    return { statusCode: 200, headers, body: JSON.stringify({ task_id: data.data.task_id }) };
  } catch(err) {
    console.log('KLING16 ERROR:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
