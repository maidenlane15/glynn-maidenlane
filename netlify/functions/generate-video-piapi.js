// generate-video-piapi.js — PiAPI video generation (HARDENED + REFERENCES)
// Models: Kling 2.1 std/pro, Kling 2.6 Pro (+audio), Kling 3.0 std/pro,
//         Seedance 2.0 Fast (text_to_video AND omni_reference image-to-video)
// Verified against PiAPI live docs (Seedance-2, File Upload API, Kling create-task).
//
// What v3 adds on top of the hardened poll:
//   1. DURATION (Seedance): now passes the EXACT integer 4–15 the user picked.
//      The old code snapped to 5/10/15, so a value of 8 silently became 5s.
//   2. REFERENCES (Seedance): when `images` are supplied, each base64 image is
//      hosted via PiAPI's File Upload API to get a public URL, then the task runs
//      in omni_reference mode with image_urls + resolution 720p. This is what
//      actually locks the real person + real product into the video.
//      mode is set EXPLICITLY to 'omni_reference' — with exactly 2 images PiAPI
//      would otherwise treat them as first/last frames, not content references.
//   3. Clear plan error: File Upload requires a PiAPI Creator plan or higher.
//      If the account can't host, we say so instead of failing silently.

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { piapi_key, action, task_id, prompt, duration, ratio, model, generate_audio } = body;
  const faceRef = body.face_ref === true;   // route face refs through the verified-asset door (B3.25)
  const audioRef = (typeof body.audio === 'string' && body.audio.indexOf('data:audio/') === 0) ? body.audio : null;   // Brit's cloned voice track (B3.26)
  const images = Array.isArray(body.images) ? body.images.filter(function(x){ return typeof x === 'string' && x.length > 0; }) : [];

  if (!piapi_key) {
    return { statusCode: 400, body: JSON.stringify({ error: 'PiAPI key required' }) };
  }

  const headers = { 'x-api-key': piapi_key, 'Content-Type': 'application/json' };

  // Recursively locate the first real video URL anywhere in the response object.
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

  // Host one base64 reference image via PiAPI's ephemeral File Upload API.
  // Returns { url } on success or { error } with a human-readable reason.
  // Requires a PiAPI Creator plan or higher (Free/PAYG -> 403).
  async function hostReference(dataUri, idx) {
    let ext = 'jpg';
    const m = /^data:(image|audio)\/([a-zA-Z0-9-]+);base64,/.exec(dataUri || '');
    if (m) {
      const t = m[2].toLowerCase();
      if (m[1] === 'audio') {
        ext = (t === 'mpeg' || t === 'mp3') ? 'mp3' : (t === 'wav' || t === 'x-wav') ? 'wav' : 'mp3';
      } else {
        ext = (t === 'jpeg') ? 'jpg' : t;          // jpg/png/webp
      }
    }
    try {
      const r = await fetch('https://upload.theapi.app/api/ephemeral_resource', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ file_name: 'ref' + idx + '.' + ext, file_data: dataUri })
      });
      let j = {};
      try { j = await r.json(); } catch (e) {}
      if (j && j.code === 200 && j.data && j.data.url) return { url: j.data.url };
      if (r.status === 403 || (j && j.code === 403)) {
        return { error: 'PLAN: Reference photos need a PiAPI Creator plan or higher to host. Your current plan can\u2019t upload images, so the engine can\u2019t lock the real face/product. Upgrade at piapi.ai \u2192 Workspace, or run without references.' };
      }
      return { error: 'Reference upload failed: ' + ((j && j.message) || ('HTTP ' + r.status)) };
    } catch (e) {
      return { error: 'Reference upload error: ' + e.message };
    }
  }

  // ── POLL ────────────────────────────────────────────────────
  if (action === 'poll') {
    if (!task_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'task_id required' }) };
    }
    try {
      const resp = await fetch('https://api.piapi.ai/api/v1/task/' + task_id, { method: 'GET', headers });
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

      return { statusCode: 200, body: JSON.stringify({ status: 'IN_QUEUE', raw: status || 'pending' }) };

    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Poll error: ' + e.message }) };
    }
  }

  // ── LIP SYNC (redub a finished video with a new voice track) ──
  if (action === 'lip_sync') {
    const videoUrl = (typeof body.video_url === 'string' && /^https?:\/\//.test(body.video_url)) ? body.video_url : null;
    if (!videoUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'video_url required for lip_sync' }) };
    }
    if (!audioRef) {
      return { statusCode: 400, body: JSON.stringify({ error: 'audio (data URI) required for lip_sync' }) };
    }
    const av = await hostReference(audioRef, 'dub');
    if (av.error) {
      return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: av.error }) };
    }
    try {
      const resp = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'kling',
          task_type: 'lip_sync',
          input: { video_url: videoUrl, tts_text: '', tts_timbre: '', tts_speed: 1, local_dubbing_url: av.url },
          config: { service_mode: 'public' }
        })
      });
      const data = await resp.json();
      const taskId = data.data && data.data.task_id;
      if (!taskId) {
        return { statusCode: 500, body: JSON.stringify({ error: data.message || JSON.stringify(data) }) };
      }
      return { statusCode: 200, body: JSON.stringify({ task_id: taskId, dbg: { mode: 'lip_sync', audio_hosted: true } }) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Lip-sync submit error: ' + e.message }) };
    }
  }

  // ── SUBMIT ──────────────────────────────────────────────────
  const rawDur = parseInt(duration) || 5;
  const validRatios = ['16:9', '9:16', '1:1'];
  const aspectRatio = validRatios.includes(ratio) ? ratio : '9:16';
  const safePrompt = (prompt || '').slice(0, 2500);

  const isSeedance = (model === 'seedance2-fast' || model === 'seedance2-pro');
  const wantRefs = images.length > 0;

  let taskBody;

  // ── SEEDANCE 2.0 FAST — text_to_video OR omni_reference ──────
  if (isSeedance || wantRefs) {
    const seedDur = Math.max(4, Math.min(15, rawDur));   // EXACT 4–15 (fixes 8→5 bug)
    const input = {
      prompt: safePrompt,
      duration: seedDur,
      aspect_ratio: aspectRatio,
      resolution: '720p'                                  // formal models default 480p
    };

    if (wantRefs) {
      const urls = [];
      for (let i = 0; i < images.length && i < 9; i++) {
        const out = await hostReference(images[i], i + 1);
        if (out.error) {
          return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: out.error }) };
        }
        urls.push(out.url);
      }
      input.mode = 'omni_reference';                      // EXPLICIT (2 imgs != first/last)
      input.image_urls = urls;
      if (faceRef) {
        // Seedance now hard-blocks raw photographic face references on the strict
        // task types (deepfake policy). The sanctioned route is the Private Asset
        // door: auto_upload_assets ingests each URL as a vetted ephemeral asset,
        // which is only accepted on the -less-restriction task types (+10% price).
        input.auto_upload_assets = true;
        input.asset_retention_hours = 3;
      }
      if (audioRef) {
        // Voice track (mp3, <=15s): only valid in omni_reference and never alone.
        const av = await hostReference(audioRef, 'a1');
        if (av.error) {
          return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: av.error }) };
        }
        input.audio_urls = [av.url];
      }
    } else {
      if (audioRef) {
        return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: 'A voice track needs at least one image reference alongside it (engine rule) \u2014 add a face or product photo.' }) };
      }
      input.mode = 'text_to_video';
    }

    taskBody = {
      model: 'seedance',
      task_type: (wantRefs && faceRef) ? 'seedance-2-fast-less-restriction' : 'seedance-2-fast',
      input: input,
      config: { service_mode: 'public' }
    };

  // ── KLING MODELS (text-to-video) ─────────────────────────────
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
      cfg_scale: 0.5,
      duration: klingDur,
      aspect_ratio: aspectRatio,
      mode: klingMode,
      version: klingVersion
    };
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

    const dbg = {
      sent: (taskBody.input && taskBody.input.duration),
      mode: (taskBody.input && taskBody.input.mode) || 'kling',
      refs: images.length,
      face_route: (wantRefs && faceRef) ? 'less-restriction+assets' : 'strict',
      voice: !!audioRef,
      piapi_saw: (data.data && data.data.input && data.data.input.duration)
    };
    return { statusCode: 200, body: JSON.stringify({ task_id: taskId, dbg: dbg }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Submit error: ' + e.message }) };
  }
};
