// elevenlabs.js — Netlify function: Instant Voice Clone (IVC) + Text-to-Speech
// Verified against ElevenLabs live docs:
//   clone: POST https://api.elevenlabs.io/v1/voices/add  (multipart: name, files[])
//   tts:   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}  (JSON) -> mp3
//   auth header: xi-api-key
// The key is passed from the browser (localStorage), never hardcoded.
// Node 18+ (Netlify) provides global fetch, FormData, Blob, Buffer.

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const key = (body.key || '').trim();
  const action = body.action;
  if (!key) return { statusCode: 400, body: JSON.stringify({ error: 'ElevenLabs key required' }) };

  // ---- VERIFY (check the key alone) ----
  if (action === 'verify') {
    const dbg = 'len ' + key.length + ' ' + key.slice(0, 5) + '\u2026' + key.slice(-4);
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user', { method: 'GET', headers: { 'xi-api-key': key } });
      if (r.ok) return { statusCode: 200, body: JSON.stringify({ ok: true, dbg: dbg }) };
      let et = ''; try { et = await r.text(); } catch (e) {}
      return { statusCode: 200, body: JSON.stringify({ error: 'ElevenLabs ' + r.status + ' [' + dbg + ']: ' + et.slice(0, 200) }) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Key check error [' + dbg + ']: ' + e.message }) };
    }
  }

  // ---- CLONE (Instant Voice Clone) ----
  if (action === 'clone') {
    try {
      const name = (body.name || 'Voice').slice(0, 100);
      const dataUri = body.audio || '';
      const m = /^data:([^;]+);base64,(.*)$/.exec(dataUri);
      if (!m) return { statusCode: 200, body: JSON.stringify({ error: 'No audio provided for cloning.' }) };
      const mime = m[1];
      const bytes = Buffer.from(m[2], 'base64');
      const ext = /mp4|m4a|aac/i.test(mime) ? 'm4a' : /mpeg|mp3/i.test(mime) ? 'mp3' : /wav/i.test(mime) ? 'wav' : /ogg|webm/i.test(mime) ? 'webm' : 'm4a';

      const fd = new FormData();
      fd.append('name', name);
      fd.append('remove_background_noise', 'true');
      fd.append('files', new Blob([bytes], { type: mime }), 'sample.' + ext);

      const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: fd
      });
      let j = {};
      try { j = await r.json(); } catch (e) {}
      if (j && j.voice_id) return { statusCode: 200, body: JSON.stringify({ voice_id: j.voice_id }) };
      if (r.status === 401) return { statusCode: 200, body: JSON.stringify({ error: 'ElevenLabs rejected the key (401). Check the key in Settings.' }) };
      const detail = (j && j.detail && (j.detail.message || (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)))) || (j && j.message) || ('HTTP ' + r.status);
      return { statusCode: 200, body: JSON.stringify({ error: 'Clone failed: ' + detail }) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Clone error: ' + e.message }) };
    }
  }

  // ---- TTS (speak text in a cloned voice) -> mp3 as base64 data URI ----
  if (action === 'tts') {
    try {
      const vid = body.voice_id;
      const text = (body.text || '').slice(0, 900);
      if (!vid) return { statusCode: 200, body: JSON.stringify({ error: 'voice_id required' }) };
      if (!text) return { statusCode: 200, body: JSON.stringify({ error: 'text required' }) };

      const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(vid), {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          output_format: 'mp3_44100_128',
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true }
        })
      });
      if (!r.ok) {
        let et = '';
        try { et = await r.text(); } catch (e) {}
        return { statusCode: 200, body: JSON.stringify({ error: 'TTS HTTP ' + r.status + ': ' + et.slice(0, 180) }) };
      }
      const buf = Buffer.from(await r.arrayBuffer());
      return { statusCode: 200, body: JSON.stringify({ audio: 'data:audio/mpeg;base64,' + buf.toString('base64') }) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ error: 'TTS error: ' + e.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
};
