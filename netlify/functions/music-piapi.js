// music-piapi.js - B3.42 - AI music bed generation via PiAPI (DiffRhythm)
// NEW FILE. Does not touch the locked generate-video-piapi.js or elevenlabs.js.
// Actions: {action:'create', piapi_key, prompt} -> {task_id}
//          {action:'poll',   piapi_key, task_id} -> {status, audio_url?, error?}
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
  var key = body.piapi_key;
  if (!key) return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'piapi_key required' }) };

  try {
    if (body.action === 'create') {
      var prompt = String(body.prompt || 'soft warm instrumental folk, gentle plucked strings, light and unhurried, no vocals').slice(0, 500);
      var r = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({
          model: 'Qubico/diffrhythm',
          task_type: 'txt2audio-base',
          input: { style_prompt: prompt, lyrics: '' },
          config: { service_mode: 'public' }
        })
      });
      var d = await r.json();
      var task = d && d.data ? d.data : d;
      var tid = task && (task.task_id || task.id);
      if (!tid) {
        var msg = (d && d.message) || (task && task.error && task.error.message) || 'No task id returned';
        return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: String(msg) }) };
      }
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ task_id: tid }) };
    }

    if (body.action === 'poll') {
      if (!body.task_id) return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'task_id required' }) };
      var r2 = await fetch('https://api.piapi.ai/api/v1/task/' + encodeURIComponent(body.task_id), {
        headers: { 'x-api-key': key }
      });
      var d2 = await r2.json();
      var t2 = d2 && d2.data ? d2.data : d2;
      var status = String((t2 && t2.status) || '').toLowerCase();
      if (status === 'completed' || status === 'success' || status === 'finished') {
        var out = (t2 && t2.output) || {};
        var url = out.audio_url || out.audio || out.url || null;
        if (!url) {
          // scan output values for the first audio-looking URL
          try {
            var stack = [out];
            while (stack.length && !url) {
              var cur = stack.pop();
              for (var k in cur) {
                var v = cur[k];
                if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.(mp3|wav|m4a|flac|ogg)(\?|$)/i.test(v)) { url = v; break; }
                if (v && typeof v === 'object') stack.push(v);
              }
            }
          } catch (e) {}
        }
        if (!url) return { statusCode: 200, headers: HDR, body: JSON.stringify({ status: 'FAILED', error: 'Completed but no audio URL in output' }) };
        return { statusCode: 200, headers: HDR, body: JSON.stringify({ status: 'COMPLETED', audio_url: url }) };
      }
      if (status === 'failed' || status === 'error') {
        var emsg = (t2 && t2.error && (t2.error.message || t2.error.raw_message)) || 'Music generation failed';
        return { statusCode: 200, headers: HDR, body: JSON.stringify({ status: 'FAILED', error: String(emsg) }) };
      }
      return { statusCode: 200, headers: HDR, body: JSON.stringify({ status: 'PENDING' }) };
    }

    return { statusCode: 400, headers: HDR, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return { statusCode: 200, headers: HDR, body: JSON.stringify({ error: String(err && err.message ? err.message : err) }) };
  }
};
