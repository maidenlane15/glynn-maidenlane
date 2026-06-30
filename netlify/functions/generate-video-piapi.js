// generate-video-piapi.js — PiAPI video generation (HARDENED)
// Models: Kling 2.1 std/pro, Kling 2.6 Pro (+ native audio), Kling 3.0 std/pro,
//         Seedance 2.0 Fast (text_to_video)
// Verified against PiAPI live docs (Kling create-task + Seedance-2-fast).
//
// Two hardening fixes vs the previous version:
//   1. POLL: completed-video URL is now found ANYWHERE in the response
//      (recursive search). Previously, if PiAPI returned the finished URL in a
//      field the old code didn't check, the task showed COMPLETED with an empty
//      url — which the app reads as "still processing" forever (a false hang).
//   2. SUBMIT (Kling): adds cfg_scale: 0.5, which PiAPI's Kling spec expects.
// Submit format is otherwise unchanged (it already matched the PiAPI docs).

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { piapi_key, action, task_id, prompt, duration, ratio, model, generate_audio } = body;

  if (!piapi_key) {
    return { statusCode: 400, body: JSON.stringify({ error: 'PiAPI key required' }) };
  }

  const headers = { 'x-api-key': piapi_key, 'Content-Type': 'application/json' };

  // Recursively locate the first real video URL anywhere in the response object.
  // Handles Kling (output.video_url), Seedance (output.works[].video.resource*),
  // and any future shape PiAPI returns — so a finished render is never missed.
  function findVideoUrl(obj, depth) {
    if (obj == null || depth > 6) return null;
    if (typeof obj === 'string') {
      return /^https?:\/\/\S+\.(mp4|mov|webm|m3u8)(\?|$)/i.test(obj) ? obj : null;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const u = findVideoUrl(obj[i], depth + 1);
        if (u) return u;
      }
      return null;
    }
    if (typeof obj === 'object') {
      const preferred = ['resource_without_watermark', 'resource', 'video_url', 'url', 'download_url'];
      for (const k of preferred) {
        if (typeof obj[k] === 'string') { const u = findVideoUrl(obj[k], depth + 1); if (u) return u; }
      }
      for (const k in obj) {
        const u = findVideoUrl(obj[k], depth + 1);
        if (u) return u;
      }
    }
    return null;
  }

  // ── POLL ────────────────────────────────────────────────────
  if (action === 'poll') {
    if (!task_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task_id required' }) };
    }
    try {
      const resp = await fetch(`https://api.piapi.ai/api/v1/task/${task_id}`, { method: 'GET', headers });
      const data = await resp.json();
      const taskData = data.data || {};
      const status = (taskData.status || '').toString().toLowerCase();

      if (status === 'completed' || status === 'success' || status === 'succeed' || status === 'succeeded') {
        const videoUrl = findVideoUrl(taskData.output, 0) || findVideoUrl(taskData, 0) || '';
        return { statusCode: 200, body: JSON.stringify({ status: 'COMPLETED', video_url: videoUrl }) };
      }

      if (status === 'failed' || status === 'error') {
        const errMsg = (taskData.error && (taskData.error.message || taskData.error.raw_message)) || 'Generation failed';
        return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: errMsg }) };
      }

      // pending / processing / staged / anything else → keep polling
      return { statusCode: 200, body: JSON.stringify({ status: 'IN_QUEUE', raw: status || 'pending' }) };

    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Poll error: ' + e.message }) };
    }
  }

  // ── SUBMIT ──────────────────────────────────────────────────
  const rawDur = parseInt(duration) || 5;
  const validRatios = ['16:9', '9:16', '1:1'];
  const aspectRatio = validRatios.includes(ratio) ? ratio : '9:16';
  const safePrompt = (prompt || '').slice(0, 2500);

  let taskBody;

  // ── SEEDANCE 2.0 FAST (text-to-video; renders fastest) ───────
  if (model === 'seedance2-fast' || model === 'seedance2-pro') {
    const seedDur = rawDur >= 15 ? 15 : rawDur >= 10 ? 10 : 5;
    taskBody = {
      model: 'seedance',
      task_type: 'seedance-2-fast',
      input: {
        prompt: safePrompt,
        mode: 'text_to_video',
        duration: seedDur,
        aspect_ratio: aspectRatio
      },
      config: { service_mode: 'public' }
    };

  // ── KLING MODELS ─────────────────────────────────────────────
  } else {
    let klingVersion, klingMode, audioSupported;
    if      (model === 'kling21-standard') { klingVersion = '2.1'; klingMode = 'std'; audioSupported = false; }
    else if (model === 'kling21-pro')      { klingVersion = '2.1'; klingMode = 'pro'; audioSupported = false; }
    else if (model === 'kling26-pro')      { klingVersion = '2.6'; klingMode = 'pro'; audioSupported = true;  }
    else if (model === 'kling3-standard')  { klingVersion = '3.0'; klingMode = 'std'; audioSupported = false; }
    else if (model === 'kling3-pro')       { klingVersion = '3.0'; klingMode = 'pro'; audioSupported = false; }
    else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown model: ' + model }) };
    }

    const klingDur = rawDur >= 10 ? 10 : 5;
    const inputBody = {
      prompt: safePrompt,
      negative_prompt: '',
      cfg_scale: 0.5,            // PiAPI Kling spec expects this; was missing
      duration: klingDur,
      aspect_ratio: aspectRatio,
      mode: klingMode,
      version: klingVersion
    };

    // Native audio: Kling 2.6 Pro only, and only when explicitly requested.
    // (Audio roughly DOUBLES render time + cost — leave it off for fast turns.)
    if (audioSupported && generate_audio) {
      inputBody.enable_audio = true;
    }

    taskBody = {
      model: 'kling',
      task_type: 'video_generation',
      input: inputBody,
      config: { service_mode: 'public' }
    };
  }

  try {
    const resp = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers,
      body: JSON.stringify(taskBody)
    });
    const data = await resp.json();

    const taskId = data.data && data.data.task_id;
    if (!taskId) {
      return { statusCode: 500, body: JSON.stringify({ error: data.message || JSON.stringify(data) }) };
    }

    return { statusCode: 200, body: JSON.stringify({ task_id: taskId }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Submit error: ' + e.message }) };
  }
};
