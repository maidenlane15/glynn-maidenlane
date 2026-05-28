// netlify/functions/generate-video-kling.js
const crypto = require('crypto');

function generateJWT(ak, sk) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ak, exp: now + 1800, nbf: now - 5
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', sk).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { ak, sk, action, task_id, prompt, duration, ratio } = JSON.parse(event.body);
    if (!ak || !sk) return { statusCode: 200, body: JSON.stringify({ error: 'Missing keys' }) };

    const token = generateJWT(ak, sk);
    const BASE = 'https://api.klingai.com';
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

    // POLL - single status check, returns immediately
    if (action === 'poll' && task_id) {
      const resp = await fetch(`${BASE}/v1/videos/text2video/${task_id}`, { headers });
      const raw = await resp.text();
      console.log('POLL HTTP:', resp.status, 'BODY:', raw.substring(0, 300));
      let data;
      try { data = JSON.parse(raw); } catch(e) { return { statusCode: 200, body: JSON.stringify({ error: raw.substring(0, 200) }) }; }
      if (data.code !== 0) return { statusCode: 200, body: JSON.stringify({ error: `Kling ${data.code}: ${data.message}` }) };
      const td = data.data;
      const status = td.task_status;
      let video_url = '';
      if (status === 'succeed' && td.task_result && td.task_result.videos) {
        video_url = td.task_result.videos[0].url || '';
      }
      return { statusCode: 200, body: JSON.stringify({ status, video_url, task_id }) };
    }

    // SUBMIT
    if (!prompt) return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    const validDuration = (parseInt(duration) <= 5) ? '5' : '10';
    const ratioMap = { '16:9':'16:9','9:16':'9:16','1:1':'1:1','4:3':'4:3','3:4':'3:4' };

    const payload = {
      model_name: 'kling-v1-6',
      prompt: prompt.substring(0, 2500),
      duration: validDuration,
      aspect_ratio: ratioMap[ratio] || '9:16',
      mode: 'pro',
      cfg_scale: 0.5
    };

    console.log('SUBMIT payload:', JSON.stringify(payload).substring(0, 200));
    const resp = await fetch(`${BASE}/v1/videos/text2video`, {
      method: 'POST', headers, body: JSON.stringify(payload)
    });
    const raw = await resp.text();
    console.log('SUBMIT HTTP:', resp.status, 'BODY:', raw.substring(0, 500));
    let data;
    try { data = JSON.parse(raw); } catch(e) { return { statusCode: 200, body: JSON.stringify({ error: raw.substring(0, 200) }) }; }
    if (data.code !== 0) return { statusCode: 200, body: JSON.stringify({ error: `Kling ${data.code}: ${data.message}` }) };
    const task_id_new = data.data && data.data.task_id;
    if (!task_id_new) return { statusCode: 200, body: JSON.stringify({ error: 'No task_id in: ' + raw.substring(0, 200) }) };
    console.log('TASK CREATED:', task_id_new);
    return { statusCode: 200, body: JSON.stringify({ task_id: task_id_new }) };

  } catch (err) {
    console.log('ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
