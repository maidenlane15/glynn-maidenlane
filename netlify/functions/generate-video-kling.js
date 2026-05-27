// netlify/functions/generate-video-kling.js
// Handles SUBMIT only - returns task_id + JWT token to browser
// Browser polls Kling directly (no Netlify overhead per poll)

const crypto = require('crypto');

function generateJWT(ak, sk) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: ak,
    exp: now + 3600, // 1 hour - enough for polling
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
    const { ak, sk, prompt, duration, ratio } = JSON.parse(event.body);

    if (!ak || !sk) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing Kling Access Key or Secret Key' }) };
    }
    if (!prompt) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const token = generateJWT(ak, sk);
    console.log('JWT generated OK');

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

    console.log('SUBMIT to Kling...');
    const createResp = await fetch('https://api.klingai.com/v1/videos/text2video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    });

    const raw = await createResp.text();
    console.log('SUBMIT HTTP:', createResp.status);
    console.log('SUBMIT RESPONSE:', raw.substring(0, 500));

    let data;
    try { data = JSON.parse(raw); } catch(e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Bad JSON from Kling: ' + raw.substring(0, 200) }) };
    }

    if (data.code !== 0) {
      return { statusCode: 200, body: JSON.stringify({ error: `Kling ${data.code}: ${data.message}` }) };
    }

    const task_id = data.data && data.data.task_id;
    if (!task_id) {
      return { statusCode: 200, body: JSON.stringify({ error: 'No task_id: ' + raw.substring(0, 200) }) };
    }

    console.log('TASK CREATED:', task_id);
    // Return task_id AND token so browser can poll directly
    return { statusCode: 200, body: JSON.stringify({ task_id, token }) };

  } catch (err) {
    console.log('ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
