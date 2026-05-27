// netlify/functions/generate-video-kling.js
// Kling AI video generation via official API
// Uses JWT authentication (Access Key + Secret Key → Bearer token)

const crypto = require('crypto');

function generateJWT(ak, sk) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ak,
    exp: now + 1800, // 30 minutes
    nbf: now - 5
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

    if (!ak || !sk) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing Kling Access Key or Secret Key' }) };
    }

    const token = generateJWT(ak, sk);
    const BASE = 'https://api.klingai.com';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    };

    // Ratio map for Kling
    const ratioMap = {
      '16:9': '16:9', '9:16': '9:16',
      '1:1': '1:1', '4:3': '4:3', '3:4': '3:4'
    };

    // ACTION: poll existing task
    if (action === 'poll' && task_id) {
      const pollResp = await fetch(`${BASE}/v1/videos/text2video/${task_id}`, { headers });
      const raw = await pollResp.text();
      console.log('KLING POLL:', raw.substring(0, 300));
      let data;
      try { data = JSON.parse(raw); } catch(e) { return { statusCode: 200, body: JSON.stringify({ error: raw }) }; }

      if (data.code !== 0) {
        return { statusCode: 200, body: JSON.stringify({ error: data.message || 'Kling error' }) };
      }

      const taskData = data.data;
      const status = taskData.task_status;
      let video_url = '';

      if (status === 'succeed' && taskData.task_result && taskData.task_result.videos) {
        video_url = taskData.task_result.videos[0].url || '';
      }

      return { statusCode: 200, body: JSON.stringify({ status, video_url, task_id }) };
    }

    // ACTION: create new video task
    if (!prompt) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const validDuration = duration <= 5 ? 5 : 10;
    const mappedRatio = ratioMap[ratio] || '9:16';

    const payload = {
      model_name: 'kling-v1-6',
      prompt: prompt.substring(0, 2500),
      duration: String(validDuration),
      aspect_ratio: mappedRatio,
      mode: 'pro',
      cfg_scale: 0.5
    };

    console.log('KLING SUBMIT:', JSON.stringify(payload));

    const createResp = await fetch(`${BASE}/v1/videos/text2video`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await createResp.text();
    console.log('KLING SUBMIT STATUS:', createResp.status);
    console.log('KLING SUBMIT RESPONSE:', raw.substring(0, 500));

    let data;
    try { data = JSON.parse(raw); } catch(e) { return { statusCode: 200, body: JSON.stringify({ error: raw }) }; }

    if (data.code !== 0) {
      return { statusCode: 200, body: JSON.stringify({ error: data.message || 'Kling submit error' }) };
    }

    const task_id_new = data.data.task_id;
    return { statusCode: 200, body: JSON.stringify({ task_id: task_id_new }) };

  } catch (err) {
    console.log('KLING ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
