// netlify/functions/generate-video-kling3.js
// Kling 3.0 via fal.ai
// Single-call design: each call does ONE submit or ONE poll — no loops
// Browser handles the polling interval (every 15s)

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const responseHeaders = { 'Content-Type': 'application/json' };

  try {
    const body = JSON.parse(event.body);
    const { fal_key, action, request_id, endpoint, prompt, duration, ratio, generate_audio } = body;

    if (!fal_key) {
      return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'Missing fal.ai API key' }) };
    }

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Key ' + fal_key
    };

    const modelId = endpoint || 'fal-ai/kling-video/v3/standard/text-to-video';
    const baseUrl = 'https://queue.fal.run/' + modelId;

    // ── POLL: single status check ─────────────────────────────────
    if (action === 'poll' && request_id) {
      const statusUrl = baseUrl + '/requests/' + request_id + '/status';
      console.log('POLL URL:', statusUrl);

      const statusResp = await fetch(statusUrl, { headers: authHeaders });
      const statusRaw = await statusResp.text();
      console.log('STATUS HTTP:', statusResp.status, 'BODY:', statusRaw.substring(0, 300));

      if (statusResp.status === 404) {
        return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ status: 'NOT_FOUND', error: 'Request ID not found on fal.ai — may have expired or failed' }) };
      }

      let statusData;
      try { statusData = JSON.parse(statusRaw); }
      catch(e) { return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ status: 'IN_PROGRESS' }) }; }

      if (statusData.status === 'COMPLETED') {
        // Fetch result
        const resultUrl = baseUrl + '/requests/' + request_id;
        console.log('RESULT URL:', resultUrl);
        const resultResp = await fetch(resultUrl, { headers: authHeaders });
        const resultRaw = await resultResp.text();
        console.log('RESULT HTTP:', resultResp.status, 'BODY:', resultRaw.substring(0, 400));

        let resultData;
        try { resultData = JSON.parse(resultRaw); }
        catch(e) { return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'Result parse error: ' + resultRaw.substring(0, 100) }) }; }

        const videoUrl = resultData.video && resultData.video.url ? resultData.video.url : '';
        if (!videoUrl) {
          return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'No video URL in result. Keys: ' + Object.keys(resultData).join(',') }) };
        }
        return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ status: 'COMPLETED', video_url: videoUrl, has_audio: true }) };
      }

      if (statusData.status === 'FAILED') {
        return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ status: 'FAILED', error: statusData.error || statusData.detail || 'Generation failed on fal.ai' }) };
      }

      // IN_QUEUE or IN_PROGRESS — return position if available
      return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({
        status: statusData.status || 'IN_PROGRESS',
        queue_position: statusData.queue_position || null
      })};
    }

    // ── SUBMIT: single submit, return request_id immediately ───────
    if (!prompt) {
      return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    // Duration must be integer string, 3-15
    const validDur = String(Math.min(15, Math.max(3, parseInt(duration) || 10)));

    // aspect_ratio: only 16:9, 9:16, 1:1 accepted
    const validRatios = ['16:9', '9:16', '1:1'];
    const validRatio = validRatios.includes(ratio) ? ratio : '9:16';

    const payload = {
      prompt: prompt.substring(0, 2500),
      duration: validDur,
      aspect_ratio: validRatio,
      negative_prompt: 'blur, distort, low quality, slow motion, artificial motion, CGI, fake, morphing',
      cfg_scale: 0.7,
      generate_audio: generate_audio !== false
    };

    console.log('SUBMIT to:', baseUrl);
    console.log('PAYLOAD:', JSON.stringify(payload).substring(0, 400));

    const submitResp = await fetch(baseUrl, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload)
    });

    const submitRaw = await submitResp.text();
    console.log('SUBMIT HTTP:', submitResp.status);
    console.log('SUBMIT BODY:', submitRaw.substring(0, 400));

    if (!submitRaw || submitRaw.trim() === '') {
      return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'Empty response from fal.ai. HTTP: ' + submitResp.status }) };
    }

    let submitData;
    try { submitData = JSON.parse(submitRaw); }
    catch(e) { return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'Parse error: ' + submitRaw.substring(0, 200) }) }; }

    if (!submitResp.ok || submitData.detail || submitData.error) {
      const errMsg = submitData.detail || submitData.error || ('HTTP ' + submitResp.status);
      return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'fal.ai rejected: ' + errMsg }) };
    }

    const reqId = submitData.request_id;
    if (!reqId) {
      return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ error: 'No request_id. Response: ' + submitRaw.substring(0, 200) }) };
    }

    console.log('SUBMITTED — request_id:', reqId);
    return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ request_id: reqId }) };

  } catch (err) {
    console.log('EXCEPTION:', err.message, err.stack);
    return { statusCode: 500, headers: responseHeaders, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
