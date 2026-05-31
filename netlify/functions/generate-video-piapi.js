// generate-video-piapi.js — PiAPI Kling video generation (Kling 2.1, 2.5, 2.6, 3.0)
// Completely isolated from Runway (generate-video.js) and Kling 1.6 (generate-video-kling.js)

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

  // ── POLL (fetch completed task) ──────────────────────────────
  if (action === 'poll') {
    if (!task_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task_id required for poll' }) };
    }
    try {
      const resp = await fetch(`https://api.piapi.ai/api/v1/task/${task_id}`, {
        method: 'GET',
        headers
      });
      const data = await resp.json();

      if (!resp.ok) {
        return { statusCode: resp.status, body: JSON.stringify({ error: data.message || 'PiAPI error' }) };
      }

      const taskData = data.data || {};
      const status = taskData.status; // pending | processing | completed | failed

      if (status === 'completed') {
        // Extract video URL — resource_without_watermark preferred
        const works = taskData.output && taskData.output.works;
        const videoUrl = works && works[0] && works[0].video
          ? (works[0].video.resource_without_watermark || works[0].video.resource)
          : null;

        return {
          statusCode: 200,
          body: JSON.stringify({
            status: 'COMPLETED',
            video_url: videoUrl || '',
            task_id: taskData.task_id
          })
        };
      }

      if (status === 'failed') {
        const errMsg = taskData.error && taskData.error.message ? taskData.error.message : 'Generation failed';
        return {
          statusCode: 200,
          body: JSON.stringify({ status: 'FAILED', error: errMsg })
        };
      }

      // Still running — return IN_QUEUE or PROCESSING
      return {
        statusCode: 200,
        body: JSON.stringify({ status: status === 'processing' ? 'PROCESSING' : 'IN_QUEUE' })
      };

    } catch(e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Poll error: ' + e.message }) };
    }
  }

  // ── SUBMIT (create new task) ─────────────────────────────────
  // Map model value from HTML to PiAPI model+version strings
  // HTML model values: kling21-standard, kling21-pro, kling25-standard, kling25-pro,
  //                    kling3-standard, kling3-pro
  let klingVersion, klingMode;

  if (model === 'kling21-standard')     { klingVersion = '2.1'; klingMode = 'std'; }
  else if (model === 'kling21-pro')     { klingVersion = '2.1'; klingMode = 'pro'; }
  else if (model === 'kling25-standard'){ klingVersion = '2.5'; klingMode = 'std'; }
  else if (model === 'kling25-pro')     { klingVersion = '2.5'; klingMode = 'pro'; }
  else if (model === 'kling3-standard') { klingVersion = '3.0'; klingMode = 'std'; }
  else if (model === 'kling3-pro')      { klingVersion = '3.0'; klingMode = 'pro'; }
  else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown model: ' + model }) };
  }

  // Map aspect ratio from HTML dropdown values to PiAPI format
  const ratioMap = {
    '9:16': '9:16',
    '16:9': '16:9',
    '1:1': '1:1',
    '4:5': '4:5',
    '3:4': '3:4'
  };
  const aspectRatio = ratioMap[ratio] || '9:16';

  // Duration: PiAPI accepts 5 or 10 (integers)
  const dur = parseInt(duration) >= 10 ? 10 : 5;

  const taskBody = {
    model: 'kling',
    task_type: 'video_generation',
    input: {
      prompt: prompt || '',
      negative_prompt: '',
      cfg_scale: 0.5,
      duration: dur,
      aspect_ratio: aspectRatio,
      mode: klingMode,
      version: klingVersion
    },
    config: {
      service_mode: 'public'
    }
  };

  // Audio only supported on 2.6 pro (and later) — skip for 2.1
  // Enable for 3.0 if requested
  if (generate_audio && (klingVersion === '3.0') && klingMode === 'pro') {
    taskBody.input.enable_audio = true;
  }

  try {
    const resp = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers,
      body: JSON.stringify(taskBody)
    });
    const data = await resp.json();

    if (!resp.ok || data.code !== 200) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: data.message || 'Submit error: ' + JSON.stringify(data) })
      };
    }

    const taskId = data.data && data.data.task_id;
    if (!taskId) {
      return { statusCode: 500, body: JSON.stringify({ error: 'No task_id returned: ' + JSON.stringify(data) }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ task_id: taskId })
    };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Submit error: ' + e.message }) };
  }
};
