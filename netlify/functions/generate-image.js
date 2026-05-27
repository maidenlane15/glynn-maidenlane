// netlify/functions/generate-image.js
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
      const statusResp = await fetch(
        'https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/' + request_id + '/status',
        { headers }
      );
      const statusData = await statusResp.json();
      console.log('FAL POLL STATUS:', JSON.stringify(statusData));

      // If completed, fetch the actual result
      if (statusData.status === 'COMPLETED') {
        const resultResp = await fetch(
          'https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/' + request_id,
          { headers }
        );
        const resultData = await resultResp.json();
        console.log('FAL RESULT:', JSON.stringify(resultData));
        return { statusCode: 200, body: JSON.stringify(resultData) };
      }

      // Still running or failed
      return { statusCode: 200, body: JSON.stringify(statusData) };
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

    const submitData = await submitResp.json();
    console.log('FAL SUBMIT STATUS:', submitResp.status);
    console.log('FAL SUBMIT RESPONSE:', JSON.stringify(submitData));

    if (!submitResp.ok || submitData.detail) {
      return { statusCode: 200, body: JSON.stringify({ error: submitData.detail || 'fal.ai submit failed' }) };
    }

    // Some requests complete immediately - check for images in submit response
    if (submitData.images && submitData.images[0]) {
      return { statusCode: 200, body: JSON.stringify(submitData) };
    }

    return { statusCode: 200, body: JSON.stringify(submitData) };

  } catch (err) {
    console.log('FAL ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
