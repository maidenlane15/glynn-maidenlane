// netlify/functions/generate-video.js
// Deploy to: netlify/functions/generate-video.js in your GitHub repo

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

    // Ratio map: Runway requires pixel format like "1280:720" not "16:9"
    const ratioMap = {
      '16:9': '1280:720',
      '9:16': '720:1280',
      '1:1': '960:960',
      '4:3': '1104:832',
      '3:4': '832:1104'
    };

    // ACTION: poll existing task
    if (action === 'poll' && task_id) {
      const pollResp = await fetch('https://api.runwayml.com/v1/tasks/' + task_id, { headers });
      const pollData = await pollResp.json();
      return { statusCode: 200, body: JSON.stringify(pollData) };
    }

    // ACTION: create new video task
    const mappedRatio = ratioMap[ratio] || '720:1280'; // default 9:16 for vertical
    const payload = {
      model: 'gen4_turbo',
      promptImage: prompt_image,
      promptText: prompt_text || '',
      duration: parseInt(duration) || 5,
      ratio: mappedRatio
    };

    const createResp = await fetch('https://api.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const rawText = await createResp.text();
    let createData;
    try { createData = JSON.parse(rawText); } catch(e) { createData = { error: rawText }; }

    if (createData.id) {
      return { statusCode: 200, body: JSON.stringify({ success: true, id: createData.id }) };
    } else {
      // Return full Runway response for debugging
      const msg = createData.message || createData.error || createData.detail || JSON.stringify(createData);
      return { statusCode: 200, body: JSON.stringify({ success: false, message: msg, debug: createData }) };
    }

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: err.message }) };
  }
};
