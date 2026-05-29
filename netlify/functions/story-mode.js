// netlify/functions/story-mode.js
// Stateless version - no dependencies required
// Job state lives in the browser (localStorage), not the server

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

async function klingSubmit(ak, sk, prompt, model, ratio) {
  const token = generateJWT(ak, sk);
  const ratioMap = { '16:9':'16:9','9:16':'9:16','1:1':'1:1','4:3':'4:3','3:4':'3:4' };
  const payload = {
    model_name: 'kling-v1-6',
    prompt: prompt.substring(0, 2500),
    duration: '10',
    aspect_ratio: ratioMap[ratio] || '9:16',
    mode: model === 'pro' ? 'pro' : 'std',
    cfg_scale: 0.5
  };
  const resp = await fetch('https://api.klingai.com/v1/videos/text2video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  console.log('KLING SUBMIT:', data.code, data.message || '');
  if (data.code !== 0) throw new Error('Kling ' + data.code + ': ' + data.message);
  return data.data.task_id;
}

async function klingPoll(ak, sk, task_id) {
  const token = generateJWT(ak, sk);
  const resp = await fetch('https://api.klingai.com/v1/videos/text2video/' + task_id, {
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error('Kling poll ' + data.code + ': ' + data.message);
  const td = data.data;
  const status = td.task_status;
  let video_url = '';
  if (status === 'succeed' && td.task_result && td.task_result.videos) {
    video_url = td.task_result.videos[0].url || '';
  }
  return { status, video_url };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const body = JSON.parse(event.body);
    const { action, ak, sk } = body;
    if (!ak || !sk) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing Kling keys' }) };

    // ── SUBMIT: submit one clip to Kling ──────────────────────────
    if (action === 'submit') {
      const { prompt, model, ratio } = body;
      if (!prompt) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
      const task_id = await klingSubmit(ak, sk, prompt, model || 'std', ratio || '9:16');
      return { statusCode: 200, headers, body: JSON.stringify({ task_id }) };
    }

    // ── POLL: check status of one clip ────────────────────────────
    if (action === 'poll') {
      const { task_id } = body;
      if (!task_id) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing task_id' }) };
      const result = await klingPoll(ak, sk, task_id);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    // ── REVISE: Nova rewrites a prompt then submits ───────────────
    if (action === 'revise') {
      const { prompt, feedback, api_key, model, ratio } = body;
      let newPrompt = prompt;
      if (feedback && api_key) {
        try {
          const novaResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': api_key,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 1500,
              system: 'You are Nova, luxury brand cinematic Creative Director. Rewrite this video clip prompt based on the feedback. Keep the same character and story context. No hand-holding bags. Output ONLY the revised prompt, max 200 words.',
              messages: [{ role: 'user', content: 'Original: ' + prompt + ' | Fix: ' + feedback }]
            })
          });
          const nd = await novaResp.json();
          if (nd.content && nd.content[0]) newPrompt = nd.content[0].text.trim();
        } catch(e) { console.log('Nova error:', e.message); }
      }
      const task_id = await klingSubmit(ak, sk, newPrompt, model || 'std', ratio || '9:16');
      return { statusCode: 200, headers, body: JSON.stringify({ task_id, prompt: newPrompt }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch(err) {
    console.log('STORY ERROR:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
