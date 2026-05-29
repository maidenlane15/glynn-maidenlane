// netlify/functions/story-mode.js
// Server-side Story Mode job runner using Netlify Blobs
// Survives screen timeouts, page refreshes, app closes

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

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
  const validDuration = '10';
  const ratioMap = { '16:9':'16:9','9:16':'9:16','1:1':'1:1','4:3':'4:3','3:4':'3:4' };
  const payload = {
    model_name: 'kling-v1-6',
    prompt: prompt.substring(0, 2500),
    duration: validDuration,
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
  if (data.code !== 0) throw new Error(`Kling ${data.code}: ${data.message}`);
  return data.data.task_id;
}

async function klingPoll(ak, sk, task_id) {
  const token = generateJWT(ak, sk);
  const resp = await fetch(`https://api.klingai.com/v1/videos/text2video/${task_id}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Kling poll ${data.code}: ${data.message}`);
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

  try {
    const body = JSON.parse(event.body);
    const { action, ak, sk } = body;

    if (!ak || !sk) return { statusCode: 200, body: JSON.stringify({ error: 'Missing Kling keys' }) };

    const store = getStore({ name: 'story-jobs', consistency: 'strong' });

    // ── ACTION: START ──────────────────────────────────────────────
    if (action === 'start') {
      const { prompts, model, ratio, co } = body;
      if (!prompts || !prompts.length) return { statusCode: 200, body: JSON.stringify({ error: 'No prompts provided' }) };

      const jobId = 'story_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

      // Submit clip 0 to Kling immediately
      let clip0TaskId = null;
      try {
        clip0TaskId = await klingSubmit(ak, sk, prompts[0], model || 'std', ratio || '9:16');
      } catch(e) {
        return { statusCode: 200, body: JSON.stringify({ error: 'Kling submit error: ' + e.message }) };
      }

      // Build job state
      const clips = prompts.map((prompt, i) => ({
        index: i,
        prompt,
        status: i === 0 ? 'submitted' : 'pending',
        task_id: i === 0 ? clip0TaskId : null,
        video_url: null
      }));

      const job = {
        job_id: jobId,
        status: 'running',
        approved: false,
        current_clip: 0,
        total_clips: prompts.length,
        model: model || 'std',
        ratio: ratio || '9:16',
        co: co || 'Maidenlane',
        clips,
        created_at: Date.now()
      };

      await store.setJSON(jobId, job);
      console.log('Story job created:', jobId, 'clips:', prompts.length);
      return { statusCode: 200, body: JSON.stringify({ job_id: jobId, status: 'started' }) };
    }

    // ── ACTION: POLL ───────────────────────────────────────────────
    if (action === 'poll') {
      const { job_id } = body;
      if (!job_id) return { statusCode: 200, body: JSON.stringify({ error: 'Missing job_id' }) };

      let job;
      try { job = await store.get(job_id, { type: 'json' }); } catch(e) {}
      if (!job) return { statusCode: 200, body: JSON.stringify({ error: 'Job not found: ' + job_id }) };

      // Check current submitted clip
      const currentClip = job.clips[job.current_clip];
      if (currentClip && currentClip.status === 'submitted' && currentClip.task_id) {
        try {
          const result = await klingPoll(ak, sk, currentClip.task_id);
          if (result.status === 'succeed' && result.video_url) {
            job.clips[job.current_clip].status = 'done';
            job.clips[job.current_clip].video_url = result.video_url;

            // If clip 0 just finished and not yet approved — pause and wait
            if (job.current_clip === 0 && !job.approved) {
              await store.setJSON(job_id, job);
              return { statusCode: 200, body: JSON.stringify({ ...job, status: 'awaiting_approval' }) };
            }

            // Advance to next pending clip if approved
            if (job.approved) {
              const nextPending = job.clips.findIndex(c => c.status === 'pending');
              if (nextPending !== -1) {
                try {
                  const nextTaskId = await klingSubmit(ak, sk, job.clips[nextPending].prompt, job.model, job.ratio);
                  job.clips[nextPending].status = 'submitted';
                  job.clips[nextPending].task_id = nextTaskId;
                  job.current_clip = nextPending;
                } catch(e) {
                  console.log('Error submitting clip', nextPending, e.message);
                }
              } else {
                // All clips done
                const allDone = job.clips.every(c => c.status === 'done');
                if (allDone) job.status = 'complete';
              }
            }
            await store.setJSON(job_id, job);
          } else if (result.status === 'failed') {
            job.clips[job.current_clip].status = 'failed';
            await store.setJSON(job_id, job);
          }
        } catch(e) {
          console.log('Poll error for clip', job.current_clip, e.message);
        }
      }

      return { statusCode: 200, body: JSON.stringify(job) };
    }

    // ── ACTION: APPROVE ────────────────────────────────────────────
    if (action === 'approve') {
      const { job_id } = body;
      let job;
      try { job = await store.get(job_id, { type: 'json' }); } catch(e) {}
      if (!job) return { statusCode: 200, body: JSON.stringify({ error: 'Job not found' }) };

      job.approved = true;

      // Submit next pending clip
      const nextPending = job.clips.findIndex(c => c.status === 'pending');
      if (nextPending !== -1) {
        try {
          const nextTaskId = await klingSubmit(ak, sk, job.clips[nextPending].prompt, job.model, job.ratio);
          job.clips[nextPending].status = 'submitted';
          job.clips[nextPending].task_id = nextTaskId;
          job.current_clip = nextPending;
        } catch(e) {
          console.log('Error submitting after approval:', e.message);
        }
      } else {
        job.status = 'complete';
      }

      await store.setJSON(job_id, job);
      return { statusCode: 200, body: JSON.stringify({ approved: true, job_id }) };
    }

    // ── ACTION: RETRY_CLIP ─────────────────────────────────────────
    if (action === 'retry_clip') {
      const { job_id, clip_index, feedback, api_key } = body;
      let job;
      try { job = await store.get(job_id, { type: 'json' }); } catch(e) {}
      if (!job) return { statusCode: 200, body: JSON.stringify({ error: 'Job not found' }) };

      let newPrompt = job.clips[clip_index].prompt;

      // If feedback + api_key provided, use Nova to revise prompt
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
              max_tokens: 400,
              system: 'You are Nova, luxury brand cinematic Creative Director. Rewrite this video clip prompt based on the feedback. Keep the same character and story context. Output ONLY the revised prompt, max 200 words.',
              messages: [{ role: 'user', content: 'Original prompt: ' + newPrompt + ' | Feedback: ' + feedback }]
            })
          });
          const novaData = await novaResp.json();
          if (novaData.content && novaData.content[0]) {
            newPrompt = novaData.content[0].text.trim();
          }
        } catch(e) { console.log('Nova revision error:', e.message); }
      }

      // Submit retry to Kling
      const retryTaskId = await klingSubmit(ak, sk, newPrompt, job.model, job.ratio);
      job.clips[clip_index].status = 'submitted';
      job.clips[clip_index].task_id = retryTaskId;
      job.clips[clip_index].prompt = newPrompt;
      job.clips[clip_index].video_url = null;
      job.current_clip = clip_index;

      await store.setJSON(job_id, job);
      return { statusCode: 200, body: JSON.stringify({ retried: true, clip_index, task_id: retryTaskId }) };
    }

    return { statusCode: 200, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch(err) {
    console.log('STORY MODE ERROR:', err.message, err.stack);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
