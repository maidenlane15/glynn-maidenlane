// generate-video-piapi.js — PiAPI video generation
// Models: Kling 2.1 std/pro, Kling 2.6 Pro (+ audio), Kling 3.0 std/pro,
//         Seedance 2.0 Fast (audio native), Seedance 2.0 Pro (audio native)
// Isolated from Runway (generate-video.js) and Kling 1.6 (generate-video-kling.js)

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { piapi_key, action, task_id, prompt, duration, ratio, model, generate_audio } = body;

  if (!piapi_key) {
    return { statusCode: 400, body: JSON.stringify({ error: 'PiAPI key required' }) };
  }

  const headers = {
    'x-api-key': piapi_key,
    'Content-Type': 'application/json'
  };

  // ── POLL ────────────────────────────────────────────────────
  if (action === 'poll') {
    if (!task_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task_id required' }) };
    }
    try {
      const resp = await fetch(`https://api.piapi.ai/api/v1/task/${task_id}`, {
        method: 'GET', headers
      });
      const data = await resp.json();
      const taskData = data.data || {};
      const status = taskData.status;

      if (status === 'completed') {
        // Kling: output.works[0].video.resource_without_watermark
        // Seedance: output.video_url OR output.works[0].video.resource
        let videoUrl = null;
        const out = taskData.output || {};

        if (out.works && out.works[0] && out.works[0].video) {
          videoUrl = out.works[0].video.resource_without_watermark || out.works[0].video.resource;
        } else if (out.video_url) {
          videoUrl = out.video_url;
        } else if (out.url) {
          videoUrl = out.url;
        }

        return { statusCode: 200, body: JSON.stringify({ status: 'COMPLETED', video_url: videoUrl || '' }) };
      }

      if (status === 'failed') {
        const errMsg = (taskData.error && taskData.error.message) || 'Generation failed';
        return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: errMsg }) };
      }

      return { statusCode: 200, body: JSON.stringify({ status: 'IN_QUEUE' }) };

    } catch(e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Poll error: ' + e.message }) };
    }
  }

  // ── SUBMIT ──────────────────────────────────────────────────
  // PiAPI only accepts 5 or 10 for Kling; 5/10/15 for Seedance (4-15 integer)
  const rawDur = parseInt(duration) || 5;
  const validRatios = ['16:9', '9:16', '1:1'];
  const aspectRatio = validRatios.includes(ratio) ? ratio : '9:16';
  const safePrompt = (prompt || '').slice(0, 2500);

  let taskBody;

  // ── SEEDANCE 2.0 ─────────────────────────────────────────────
  if (model === 'seedance2-fast' || model === 'seedance2-pro') {
    // Seedance supports 4-15s; snap to 5/10/15
    const seedDur = rawDur >= 15 ? 15 : rawDur >= 10 ? 10 : 5;
    const seedTaskType = model === 'seedance2-pro' ? 'seedance-2' : 'seedance-2-fast';

    taskBody = {
      model: 'seedance',
      task_type: seedTaskType,
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
      duration: klingDur,
      aspect_ratio: aspectRatio,
      mode: klingMode,
      version: klingVersion
    };

    // Audio only for Kling 2.6 Pro when checkbox is checked
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

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Submit error: ' + e.message }) };
  }
};
