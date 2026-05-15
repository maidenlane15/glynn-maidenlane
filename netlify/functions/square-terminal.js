exports.handler = async function(event, context) {
  const SQUARE_ACCESS_TOKEN = 'EAAAlzOzpaRO1to1RwWjBGSCQoGpsbP1rL9LPt8m2Q2P2-aczntEaTOVvzzfl7bQ';
  const SQUARE_DEVICE_ID    = '54331BBC32BB0B7';
  const SQUARE_API_BASE     = 'https://connect.squareup.com';
  const SQUARE_VERSION      = '2025-01-23';

  const sqHeaders = {
    'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': SQUARE_VERSION
  };

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod === 'GET') {
    const results = {};
    try {
      const r = await fetch(`${SQUARE_API_BASE}/v2/devices`, { headers: sqHeaders });
      results.devices = await r.json();
    } catch(e) { results.devices_error = e.message; }
    try {
      const r = await fetch(`${SQUARE_API_BASE}/v2/terminals/checkouts?limit=3`, { headers: sqHeaders });
      results.recent_checkouts = await r.json();
    } catch(e) { results.checkouts_error = e.message; }
    return { statusCode: 200, headers: cors, body: JSON.stringify(results, null, 2) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const amountCents = parseInt(body.amount_cents);
  const note = body.note || 'Maidenlane Sale';

  if (!amountCents || amountCents <= 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid amount' }) };
  }

  const idempotencyKey = 'glynn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const payload = {
    idempotency_key: idempotencyKey,
    checkout: {
      amount_money: { amount: amountCents, currency: 'USD' },
      reference_id: 'ML-' + Date.now(),
      note: note,
      payment_options: { autocomplete: true },
      tip_settings: { allow_tipping: false }
    },
    device_id: SQUARE_DEVICE_ID
  };

  try {
    const resp = await fetch(
      `${SQUARE_API_BASE}/v2/terminals/checkouts`,
      { method: 'POST', headers: sqHeaders, body: JSON.stringify(payload) }
    );
    const data = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers: cors,
        body: JSON.stringify({
          error: data.errors?.[0]?.detail || data.errors?.[0]?.code || 'Square checkout failed',
          square_errors: data.errors,
          device_id_used: SQUARE_DEVICE_ID
        })
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        checkout_id: data.checkout?.id,
        status: data.checkout?.status,
        device_id: SQUARE_DEVICE_ID
      })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Checkout failed: ' + err.message })
    };
  }
};
