// netlify/functions/generate-video.js
// Deploy to: netlify/functions/generate-video.js in GitHub repo
// Uses api.dev.runwayml.com - required for keys from dev.runwayml.com portal

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { runway_key, action, task_id, prompt_image, prompt_text, duration, ratio } = JSON.parse(event.body);
    if (!runway_key) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Missing Runway API key' }) };
    }

    const BASE = 'https://api.dev.runwayml.com';

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + runway_key,
      'X-Runway-Version': '2024-11-06'
    };

    const ratioMap = {
      '16:9': '1280:720', '9:16': '720:1280',
      '1:1': '960:960', '4:3': '1104:832', '3:4': '832:1104'
    };

    // ACTION: poll existing task
    if (action === 'poll' && task_id) {
      const pollResp = await fetch(BASE + '/v1/tasks/' + task_id, { headers });
      const rawPoll = await pollResp.text();
      let pollData;
      try { pollData = JSON.parse(rawPoll); } catch(e) { pollData = { error: rawPoll }; }
      return { statusCode: 200, body: JSON.stringify(pollData) };
    }

    // ACTION: create new video task
    const mappedRatio = ratioMap[ratio] || '1280:720';
    const hasImage = prompt_image && prompt_image.trim().length > 0;

    let endpoint, payload;

    if (hasImage) {
      endpoint = '/v1/image_to_video';
      payload = {
        model: 'gen4_turbo',
        promptImage: prompt_image,
        promptText: prompt_text || '',
        duration: parseInt(duration) || 5,
        ratio: mappedRatio
      };
    } else {
      endpoint = '/v1/text_to_video';
      payload = {
        model: 'gen4_turbo',
        promptText: prompt_text || '',
        duration: parseInt(duration) || 5,
        ratio: mappedRatio
      };
    }

    console.log('RUNWAY REQUEST:', endpoint, JSON.stringify(payload));

    const createResp = await fetch(BASE + endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const rawText = await createResp.text();
    console.log('RUNWAY STATUS:', createResp.status);
    console.log('RUNWAY RESPONSE:', rawText);

    let createData;
    try { createData = JSON.parse(rawText); } catch(e) { createData = { error: rawText }; }

    if (createData.id) {
      return { statusCode: 200, body: JSON.stringify({ success: true, id: createData.id }) };
    } else {
      const msg = createData.message || createData.error || createData.detail || rawText;
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: msg,
          debug: {
            runway_status: createResp.status,
            runway_raw: rawText,
            endpoint_used: endpoint,
            payload_sent: payload
          }
        })
      };
    }

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: err.message }) };
  }
};
