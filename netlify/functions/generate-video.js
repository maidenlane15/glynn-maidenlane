// netlify/functions/generate-video.js
// Deploy to: netlify/functions/generate-video.js in your GitHub repo
// Proxies Runway API calls server-side to bypass CORS

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { runway_key, action, task_id, prompt_image, prompt_text, duration, ratio } = JSON.parse(event.body);
    if (!runway_key) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Missing Runway API key' }) };
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + runway_key,
      'X-Runway-Version': '2024-11-06'
    };

    // ACTION: poll existing task
    if (action === 'poll' && task_id) {
      const pollResp = await fetch('https://api.runwayml.com/v1/tasks/' + task_id, { headers });
      const pollData = await pollResp.json();
      return { statusCode: 200, body: JSON.stringify(pollData) };
    }

    // ACTION: create new video task
    const payload = {
      model: 'gen4_turbo',
      promptImage: prompt_image,
      promptText: prompt_text || '',
      duration: parseInt(duration) || 5,
      ratio: ratio || '9:16'
    };

    const createResp = await fetch('https://api.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const createData = await createResp.json();

    if (createData.id) {
      return { statusCode: 200, body: JSON.stringify({ success: true, id: createData.id }) };
    } else {
      return { statusCode: 200, body: JSON.stringify({ success: false, message: createData.message || createData.error || JSON.stringify(createData) }) };
    }

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: err.message }) };
  }
};
