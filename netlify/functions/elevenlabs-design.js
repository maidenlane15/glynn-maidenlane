// elevenlabs-design.js - B3.44 - AI voice design (novel voice from a text description)
// NEW FILE. Does not touch the locked elevenlabs.js.
// Action: {action:'design', key, description, name} -> {voice_id} | {error}
exports.handler = async function (event) {
  var HDR = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HDR, body: JSON.stringify({ error: 'POST only' }) };
  }
  var body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'Bad JSON' }) };
  }
  var key = body.key;
  if (!key) return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'key required' }) };

  if (body.action === 'tts') {
    try {
      var vid = String(body.voice_id || '');
      var text = String(body.text || '').slice(0, 2400);
      if (!vid || !text) return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'voice_id and text required' }) };
      var payload = { text: text, model_id: 'eleven_multilingual_v2' };
      if (body.voice_settings) payload.voice_settings = body.voice_settings;
      if (typeof body.seed === 'number') payload.seed = body.seed;
      var rt = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(vid) + '?output_format=mp3_44100_192', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify(payload)
      });
      if (!rt.ok) {
        var et = await rt.text();
        return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: 'TTS ' + rt.status + ': ' + et.slice(0, 200) }) };
      }
      var ab = await rt.arrayBuffer();
      var b64 = Buffer.from(ab).toString('base64');
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ audio: 'data:audio/mpeg;base64,' + b64 }) };
    } catch (e1) {
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: String(e1 && e1.message ? e1.message : e1) }) };
    }
  }

  if (body.action !== 'design') return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'Unknown action' }) };

  var desc = String(body.description || '').slice(0, 900);
  if (desc.length < 20) return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'Voice description too short' }) };
  var name = String(body.name || 'Glynn Voice').slice(0, 60);

  try {
    // Step 1: generate voice previews from the description (engine writes its own sample text)
    var r1 = await fetch('https://api.elevenlabs.io/v1/text-to-voice/create-previews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify({ voice_description: desc, auto_generate_text: true })
    });
    var d1 = await r1.json();
    if (!r1.ok) {
      var m1 = (d1 && d1.detail && (d1.detail.message || d1.detail)) || 'Voice design failed';
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: String(typeof m1 === 'string' ? m1 : JSON.stringify(m1)).slice(0, 300) }) };
    }
    var prevs = (d1 && d1.previews) || [];
    if (!prevs.length || !prevs[0].generated_voice_id) {
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: 'No voice previews generated' }) };
    }
    // Step 2: save the first preview as a permanent voice
    var r2 = await fetch('https://api.elevenlabs.io/v1/text-to-voice/create-voice-from-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify({ voice_name: name, voice_description: desc, generated_voice_id: prevs[0].generated_voice_id })
    });
    var d2 = await r2.json();
    if (!r2.ok || !d2.voice_id) {
      var m2 = (d2 && d2.detail && (d2.detail.message || d2.detail)) || 'Could not save the designed voice';
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: String(typeof m2 === 'string' ? m2 : JSON.stringify(m2)).slice(0, 300) }) };
    }
    return { statusCode: 200, headers: HDR, body: JSON.stringify({ voice_id: d2.voice_id }) };
  } catch (err) {
    return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: String(err && err.message ? err.message : err) }) };
  }
};
