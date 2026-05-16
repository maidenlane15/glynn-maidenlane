exports.handler = async function(event, context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { to, from, subject, text, html, resend_key } = body;

  if (!resend_key) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'No Resend API key provided' }) };
  }
  if (!to || !subject) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing to or subject' }) };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resend_key}`
      },
      body: JSON.stringify({
        from: from || 'Glynn <hello@maidenlane.com>',
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        text: text || '',
        html: html || ''
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers: cors,
        body: JSON.stringify({ error: data.message || 'Resend API error', details: data })
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ success: true, id: data.id })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Email send failed: ' + err.message })
    };
  }
};
