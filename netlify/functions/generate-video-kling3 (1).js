// netlify/functions/generate-video-kling3.js
// Kling 3.0 via fal.ai queue API

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { fal_key, action, request_id, endpoint, prompt, duration, ratio, generate_audio } = JSON.parse(event.body);

    if (!fal_key) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing fal.ai API key' }) };
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Key ' + fal_key
    };

    const modelEndpoint = endpoint || 'fal-ai/kling-video/v3/standard/text-to-video';

    // ── POLL ──────────────────────────────────────────────────────
    if (action === 'poll' && request_id) {
      // Try to get the result directly first
      const resultResp = await fetch(
        `https://queue.fal.run/${modelEndpoint}/requests/${request_id}`,
        { headers }
      );
      
      const rawResult = await resultResp.text();
      console.log('KLING3 RESULT HTTP:', resultResp.status);
      console.log('KLING3 RESULT RAW:', rawResult.substring(0, 500));

      if (!rawResult || rawResult.trim() === '') {
        // Empty response = still processing
        return { statusCode: 200, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
      }

      let resultData;
      try { resultData = JSON.parse(rawResult); } catch(e) {
        return { statusCode: 200, body: JSON.stringify({ status: 'IN_PROGRESS', debug: rawResult.substring(0, 100) }) };
      }

      // Check if it has a video - means completed
      if (resultData.video && resultData.video.url) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            status: 'COMPLETED',
            video_url: resultData.video.url,
            has_audio: true
          })
        };
      }

      // Check for error
      if (resultData.detail || resultData.error) {
        // If 404 or "not ready" - still processing
        if (resultResp.status === 404 || (resultData.detail && resultData.detail.includes('not found'))) {
          return { statusCode: 200, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
        }
        return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: resultData.detail || resultData.error }) };
      }

      // Check status field
      if (resultData.status) {
        if (resultData.status === 'IN_QUEUE' || resultData.status === 'IN_PROGRESS') {
          return { statusCode: 200, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
        }
        if (resultData.status === 'COMPLETED') {
          // Fetch result separately
          return { statusCode: 200, body: JSON.stringify({ status: 'COMPLETED', video_url: '' }) };
        }
      }

      return { statusCode: 200, body: JSON.stringify({ status: 'IN_PROGRESS', raw: rawResult.substring(0, 100) }) };
    }

    // ── SUBMIT ────────────────────────────────────────────────────
    if (!prompt) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const validDur = Math.min(15, Math.max(3, parseInt(duration) || 10));
    const ratioMap = { '9:16':'9:16','16:9':'16:9','1:1':'1:1','4:3':'4:3','3:4':'3:4' };

    const payload = {
      prompt: prompt.substring(0, 2500),
      duration: String(validDur),
      aspect_ratio: ratioMap[ratio] || '9:16',
      cfg_scale: 0.7,
      generate_audio: generate_audio !== false
    };

    console.log('KLING3 SUBMIT endpoint:', modelEndpoint);
    console.log('KLING3 PAYLOAD:', JSON.stringify(payload).substring(0, 300));

    const submitResp = await fetch(`https://queue.fal.run/${modelEndpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await submitResp.text();
    console.log('KLING3 SUBMIT STATUS:', submitResp.status);
    console.log('KLING3 SUBMIT RESPONSE:', raw.substring(0, 400));

    if (!raw || raw.trim() === '') {
      return { statusCode: 200, body: JSON.stringify({ error: 'Empty response from fal.ai' }) };
    }

    let submitData;
    try { submitData = JSON.parse(raw); } catch(e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Invalid JSON from fal.ai: ' + raw.substring(0, 200) }) };
    }

    if (!submitResp.ok || submitData.detail) {
      return { statusCode: 200, body: JSON.stringify({ error: submitData.detail || 'fal.ai error ' + submitResp.status }) };
    }

    const reqId = submitData.request_id;
    if (!reqId) {
      return { statusCode: 200, body: JSON.stringify({ error: 'No request_id in response: ' + raw.substring(0, 200) }) };
    }

    console.log('KLING3 REQUEST ID:', reqId);
    return { statusCode: 200, body: JSON.stringify({ request_id: reqId }) };

  } catch (err) {
    console.log('KLING3 ERROR:', err.message, err.stack);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
