// netlify/functions/generate-image.js
// Proxies Flux Pro 1.1 requests from browser through Netlify to avoid CORS

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { fal_key, action, request_id, prompt } = JSON.parse(event.body);

    if (!fal_key) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fal.ai API key' }) };
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Key ' + fal_key
    };

    // ACTION: poll existing request
    if (action === 'poll' && request_id) {
      const pollResp = await fetch(
        'https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/' + request_id,
        { headers }
      );
      const raw = await pollResp.text();
      let data;
      try { data = JSON.parse(raw); } catch(e) { data = { error: raw }; }
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    // ACTION: submit new image request
    if (!prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const submitResp = await fetch('https://queue.fal.run/fal-ai/flux-pro/v1.1', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt,
        image_size: 'square_hd',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        safety_tolerance: '2'
      })
    });

    const raw = await submitResp.text();
    console.log('FAL SUBMIT STATUS:', submitResp.status);
    console.log('FAL SUBMIT RESPONSE:', raw);

    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { error: raw }; }

    if (!submitResp.ok || data.detail) {
      return { statusCode: 200, body: JSON.stringify({ error: data.detail || raw }) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
