// netlify/functions/generate-video-kling3.js
// Kling 3.0 via fal.ai — CORRECTED endpoint and polling

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

    // Correct model endpoint — text to video
    const modelId = endpoint || 'fal-ai/kling-video/v3/standard/text-to-video';

    // ── POLL: check status of existing request ─────────────────────
    if (action === 'poll' && request_id) {
      // Step 1: Check status
      const statusResp = await fetch(
        `https://queue.fal.run/${modelId}/requests/${request_id}/status`,
        { headers }
      );
      const statusRaw = await statusResp.text();
      console.log('KLING3 STATUS HTTP:', statusResp.status, 'BODY:', statusRaw.substring(0, 200));

      let statusData;
      try { statusData = JSON.parse(statusRaw); } catch(e) {
        return { statusCode: 200, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
      }

      if (statusData.status === 'COMPLETED') {
        // Step 2: Fetch the actual result
        const resultResp = await fetch(
          `https://queue.fal.run/${modelId}/requests/${request_id}`,
          { headers }
        );
        const resultRaw = await resultResp.text();
        console.log('KLING3 RESULT HTTP:', resultResp.status, 'BODY:', resultRaw.substring(0, 300));

        let resultData;
        try { resultData = JSON.parse(resultRaw); } catch(e) {
          return { statusCode: 200, body: JSON.stringify({ error: 'Could not parse result: ' + resultRaw.substring(0, 100) }) };
        }

        const videoUrl = resultData.video && resultData.video.url ? resultData.video.url : '';
        if (!videoUrl) {
          return { statusCode: 200, body: JSON.stringify({ error: 'No video URL in result: ' + resultRaw.substring(0, 200) }) };
        }

        return { statusCode: 200, body: JSON.stringify({ status: 'COMPLETED', video_url: videoUrl, has_audio: true }) };
      }

      if (statusData.status === 'FAILED') {
        const errMsg = statusData.error || statusData.detail || 'Generation failed';
        console.log('KLING3 FAILED:', errMsg);
        return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: errMsg }) };
      }

      // IN_QUEUE or IN_PROGRESS
      const queuePos = statusData.queue_position || null;
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: statusData.status || 'IN_PROGRESS',
          queue_position: queuePos
        })
      };
    }

    // ── SUBMIT: new video request ───────────────────────────────────
    if (!prompt) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    // Kling 3.0 supports 3-15 seconds
    const validDur = Math.min(15, Math.max(3, parseInt(duration) || 10));
    const ratioMap = { '9:16':'9:16', '16:9':'16:9', '1:1':'1:1', '4:3':'4:3', '3:4':'3:4' };

    const payload = {
      prompt: prompt.substring(0, 2500),
      duration: String(validDur),
      aspect_ratio: ratioMap[ratio] || '9:16',
      cfg_scale: 0.7,
      generate_audio: generate_audio !== false
    };

    console.log('KLING3 SUBMIT to:', modelId);
    console.log('KLING3 PAYLOAD:', JSON.stringify(payload).substring(0, 300));

    // Submit to queue
    const submitResp = await fetch(`https://queue.fal.run/${modelId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const submitRaw = await submitResp.text();
    console.log('KLING3 SUBMIT HTTP:', submitResp.status);
    console.log('KLING3 SUBMIT BODY:', submitRaw.substring(0, 400));

    if (!submitRaw || submitRaw.trim() === '') {
      return { statusCode: 200, body: JSON.stringify({ error: 'Empty response from fal.ai — check your key or try again' }) };
    }

    let submitData;
    try { submitData = JSON.parse(submitRaw); } catch(e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Invalid fal.ai response: ' + submitRaw.substring(0, 200) }) };
    }

    if (!submitResp.ok || submitData.detail) {
      return { statusCode: 200, body: JSON.stringify({ error: submitData.detail || 'fal.ai error ' + submitResp.status + ': ' + submitRaw.substring(0, 100) }) };
    }

    const reqId = submitData.request_id;
    if (!reqId) {
      return { statusCode: 200, body: JSON.stringify({ error: 'No request_id returned: ' + submitRaw.substring(0, 200) }) };
    }

    console.log('KLING3 QUEUED — request_id:', reqId);
    return { statusCode: 200, body: JSON.stringify({ request_id: reqId }) };

  } catch (err) {
    console.log('KLING3 EXCEPTION:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
