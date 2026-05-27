// netlify/functions/generate-video-kling.js
const crypto = require('crypto');

function generateJWT(ak, sk) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ak,
    exp: now + 1800,
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
    const body = JSON.parse(event.body);
    const { ak, sk, action, task_id, prompt, duration, ratio } = body;

    if (!ak || !sk) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing Kling Access Key or Secret Key' }) };
    }

    const token = generateJWT(ak, sk);
    console.log('JWT generated, first 20 chars:', token.substring(0, 20));

    const BASE = 'https://api.klingai.com';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    };

    // ACTION: poll existing task
    if (action === 'poll' && task_id) {
      const url = `${BASE}/v1/videos/text2video/${task_id}`;
      console.log('POLL URL:', url);
      const pollResp = await fetch(url, { headers });
      const raw = await pollResp.text();
      console.log('POLL HTTP STATUS:', pollResp.status);
      console.log('POLL RESPONSE:', raw.substring(0, 500));

      let data;
      try { data = JSON.parse(raw); } catch(e) {
        return { statusCode: 200, body: JSON.stringify({ error: 'Invalid JSON from Kling: ' + raw.substring(0, 200) }) };
      }

      if (data.code !== 0) {
        return { statusCode: 200, body: JSON.stringify({ error: `Kling error ${data.code}: ${data.message}` }) };
      }

      const taskData = data.data;
      const status = taskData.task_status;
      let video_url = '';
      if (status === 'succeed' && taskData.task_result && taskData.task_result.videos) {
        video_url = taskData.task_result.videos[0].url || '';
      }
      return { statusCode: 200, body: JSON.stringify({ status, video_url, task_id }) };
    }

    // ACTION: submit new task
    if (!prompt) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const validDuration = (parseInt(duration) <= 5) ? '5' : '10';
    const ratioMap = { '16:9':'16:9','9:16':'9:16','1:1':'1:1','4:3':'4:3','3:4':'3:4' };
    const mappedRatio = ratioMap[ratio] || '9:16';

    const payload = {
      model_name: 'kling-v1-6',
      prompt: prompt.substring(0, 2500),
      duration: validDuration,
      aspect_ratio: mappedRatio,
      mode: 'pro',
      cfg_scale: 0.5
    };

    console.log('SUBMIT URL:', `${BASE}/v1/videos/text2video`);
    console.log('SUBMIT PAYLOAD:', JSON.stringify(payload).substring(0, 300));

    const createResp = await fetch(`${BASE}/v1/videos/text2video`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await createResp.text();
    console.log('SUBMIT HTTP STATUS:', createResp.status);
    console.log('SUBMIT RESPONSE:', raw.substring(0, 500));

    let data;
    try { data = JSON.parse(raw); } catch(e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Invalid JSON from Kling: ' + raw.substring(0, 200) }) };
    }

    if (data.code !== 0) {
      return { statusCode: 200, body: JSON.stringify({ error: `Kling error ${data.code}: ${data.message}` }) };
    }

    const newTaskId = data.data && data.data.task_id;
    if (!newTaskId) {
      return { statusCode: 200, body: JSON.stringify({ error: 'No task_id in response: ' + raw.substring(0, 200) }) };
    }

    console.log('TASK ID CREATED:', newTaskId);
    return { statusCode: 200, body: JSON.stringify({ task_id: newTaskId }) };

  } catch (err) {
    console.log('EXCEPTION:', err.message, err.stack);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
