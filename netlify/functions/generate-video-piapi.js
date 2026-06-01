// generate-video-piapi.js — PiAPI Kling video generation (Unified API)
// Isolated from Runway (generate-video.js) and Kling 1.6 (generate-video-kling.js)

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
  // PiAPI unified API uses task_type to select model version, NOT a version field
  // kling-video-generation = 2.x standard; kling-video-generation-v2 = 2.1 specifically
  let taskType, klingMode;
  if      (model === 'kling21-standard') { taskType = 'video_generation'; klingMode = 'std'; }
  else if (model === 'kling21-pro')      { taskType = 'video_generation'; klingMode = 'pro'; }
  else if (model === 'kling3-standard')  { taskType = 'video_generation'; klingMode = 'std'; }
  else if (model === 'kling3-pro')       { taskType = 'video_generation'; klingMode = 'pro'; }
  else { return { statusCode: 400, body: JSON.stringify({ error: 'Unknown model: ' + model }) }; }

  // PiAPI only accepts 5 or 10
  const dur = (parseInt(duration) || 5) >= 10 ? 10 : 5;

  // PiAPI accepts "16:9", "9:16", "1:1"
  const validRatios = ['16:9', '9:16', '1:1'];
  const aspectRatio = validRatios.includes(ratio) ? ratio : '9:16';

  // Truncate prompt to 2500 chars (PiAPI hard limit)
  const safePrompt = (prompt || '').slice(0, 2500);

  // Unified API body — no version field, mode controls quality
  const taskBody = {
    model: 'kling',
    task_type: taskType,
    input: {
      prompt: safePrompt,
      negative_prompt: '',
      duration: dur,
      aspect_ratio: aspectRatio,
      mode: klingMode
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

    const taskId = data.data && data.data.task_id;
    if (!taskId) {
      return { statusCode: 500, body: JSON.stringify({ error: data.message || JSON.stringify(data) }) };
    }

    return { statusCode: 200, body: JSON.stringify({ task_id: taskId }) };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Submit error: ' + e.message }) };
  }
};
