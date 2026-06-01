// generate-video-piapi.js — PiAPI Kling video generation
// Isolated from Runway and Kling 1.6

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { piapi_key, action, task_id, prompt, duration, ratio, model } = body;

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
        const works = taskData.output && taskData.output.works;
        const videoUrl = works && works[0] && works[0].video
          ? (works[0].video.resource_without_watermark || works[0].video.resource)
          : null;
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
  // Map model to PiAPI mode + version
  let klingVersion, klingMode;
  if      (model === 'kling21-standard') { klingVersion = '2.1'; klingMode = 'std'; }
  else if (model === 'kling21-pro')      { klingVersion = '2.1'; klingMode = 'pro'; }
  else if (model === 'kling3-standard')  { klingVersion = '3.0'; klingMode = 'std'; }
  else if (model === 'kling3-pro')       { klingVersion = '3.0'; klingMode = 'pro'; }
  else { return { statusCode: 400, body: JSON.stringify({ error: 'Unknown model: ' + model }) }; }

  // PiAPI only accepts 5 or 10
  const dur = (parseInt(duration) || 5) >= 10 ? 10 : 5;

  // PiAPI accepts "16:9", "9:16", "1:1"
  const validRatios = ['16:9', '9:16', '1:1'];
  const aspectRatio = validRatios.includes(ratio) ? ratio : '9:16';

  // Minimal request body — only fields confirmed in PiAPI docs
  const taskBody = {
    model: 'kling',
    task_type: 'video_generation',
    input: {
      prompt: prompt || '',
      negative_prompt: '',
      duration: dur,
      aspect_ratio: aspectRatio,
      mode: klingMode,
      version: klingVersion
    },
    config: {
      service_mode: 'public'
    }
  };

  try {
    const resp = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers,
      body: JSON.stringify(taskBody)
    });
    const data = await resp.json();

    // Log full response for debugging
    const taskId = data.data && data.data.task_id;
    if (!taskId) {
      return { statusCode: 500, body: JSON.stringify({ error: (data.message || JSON.stringify(data)) }) };
    }

    return { statusCode: 200, body: JSON.stringify({ task_id: taskId }) };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Submit error: ' + e.message }) };
  }
};
