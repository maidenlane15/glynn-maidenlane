// netlify/functions/generate-image.js
// Deploy to: netlify/functions/generate-image.js in GitHub repo
// Proxies OpenAI image generation server-side - bypasses CORS on Android

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { openai_key, prompt, size, quality } = JSON.parse(event.body);
    if (!openai_key || !prompt) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Missing required fields' }) };
    }

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + openai_key
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: size || '1024x1024',
        quality: quality || 'auto'
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: false, message: data.error ? data.error.message : 'OpenAI error ' + response.status })
      };
    }

    if (data.data && data.data[0] && data.data[0].b64_json) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, b64_json: data.data[0].b64_json })
      };
    }

    return { statusCode: 200, body: JSON.stringify({ success: false, message: 'No image data returned' }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: err.message }) };
  }
};
