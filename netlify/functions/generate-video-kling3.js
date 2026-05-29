// netlify/functions/generate-video-kling3.js
// Kling 3.0 via fal.ai — uses existing fal.ai key
// No new account needed — same key as Flux Pro image generation

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
      const pollResp = await fetch(
        `https://queue.fal.run/${modelEndpoint}/requests/${request_id}/status`,
        { headers }
      );
      const statusData = await pollResp.json();
      console.log('KLING3 POLL STATUS:', statusData.status);

      if (statusData.status === 'COMPLETED') {
        const resultResp = await fetch(
          `https://queue.fal.run/${modelEndpoint}/requests/${request_id}`,
          { headers }
        );
        const resultData = await resultResp.json();
        console.log('KLING3 RESULT keys:', Object.keys(resultData));
        const videoUrl = resultData.video && resultData.video.url ? resultData.video.url : '';
        const hasAudio = resultData.video && resultData.video.content_type === 'video/mp4';
        return {
          statusCode: 200,
          body: JSON.stringify({
            status: 'COMPLETED',
            video_url: videoUrl,
            has_audio: hasAudio
          })
        };
      }

      if (statusData.status === 'FAILED') {
        return { statusCode: 200, body: JSON.stringify({ status: 'FAILED', error: 'Kling 3.0 generation failed' }) };
      }

      return { statusCode: 200, body: JSON.stringify({ status: statusData.status || 'IN_PROGRESS' }) };
    }

    // ── SUBMIT ────────────────────────────────────────────────────
    if (!prompt) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    // Duration: Kling 3.0 supports 3-15 seconds
    const validDur = Math.min(15, Math.max(3, parseInt(duration) || 10));
    
    // Ratio mapping
    const ratioMap = {
      '9:16': '9:16', '16:9': '16:9',
      '1:1': '1:1', '4:3': '4:3', '3:4': '3:4'
    };

    const payload = {
      prompt: prompt.substring(0, 2500),
      duration: String(validDur),
      aspect_ratio: ratioMap[ratio] || '9:16',
      cfg_scale: 0.7, // Higher = more prompt adherence, reduces slow-motion defaults
      generate_audio: generate_audio !== false // default true
    };

    console.log('KLING3 SUBMIT to:', modelEndpoint);
    console.log('KLING3 PAYLOAD:', JSON.stringify(payload).substring(0, 300));

    const submitResp = await fetch(`https://queue.fal.run/${modelEndpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await submitResp.text();
    console.log('KLING3 SUBMIT STATUS:', submitResp.status);
    console.log('KLING3 SUBMIT RESPONSE:', raw.substring(0, 400));

    let submitData;
    try { submitData = JSON.parse(raw); } catch(e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Invalid response: ' + raw.substring(0, 200) }) };
    }

    if (!submitResp.ok || submitData.detail) {
      return { statusCode: 200, body: JSON.stringify({ error: submitData.detail || 'fal.ai error ' + submitResp.status }) };
    }

    const reqId = submitData.request_id;
    if (!reqId) {
      return { statusCode: 200, body: JSON.stringify({ error: 'No request_id: ' + raw.substring(0, 200) }) };
    }

    console.log('KLING3 REQUEST ID:', reqId);
    return { statusCode: 200, body: JSON.stringify({ request_id: reqId }) };

  } catch (err) {
    console.log('KLING3 ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
