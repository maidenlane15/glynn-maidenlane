// netlify/functions/generate-image.js
// Uses fal.ai direct run endpoint - synchronous, no polling needed
// Netlify function timeout is 26 seconds on free plan, 60s on paid

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { fal_key, prompt } = JSON.parse(event.body);

    if (!fal_key) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fal.ai API key' }) };
    }
    if (!prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    // Direct run - synchronous, returns result immediately when done
    const resp = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Key ' + fal_key
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: 'square_hd',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        safety_tolerance: '2'
      })
    });

    const raw = await resp.text();
    console.log('FAL STATUS:', resp.status);
    console.log('FAL RESPONSE:', raw.substring(0, 500));

    let data;
    try { data = JSON.parse(raw); } catch(e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Invalid response from fal.ai: ' + raw.substring(0, 200) }) };
    }

    if (!resp.ok || data.detail) {
      return { statusCode: 200, body: JSON.stringify({ error: data.detail || 'fal.ai error ' + resp.status }) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };

  } catch (err) {
    console.log('ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
