exports.handler = async function(event, context) {
  const SQUARE_ACCESS_TOKEN = 'EAAAlzOzpaRO1to1RwWjBGSCQoGpsbP1rL9LPt8m2Q2P2-aczntEaTOVvzzfl7bQ';
  const SQUARE_LOCATION_ID  = 'L0FDVGJRJ8ZB3';
  const SQUARE_DEVICE_ID    = '606CS149C4001895';
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

  // GET: diagnostic
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

  // Step 1: Get real device_id from Square API
  let squareDeviceId = null;
  try {
    const r = await fetch(`${SQUARE_API_BASE}/v2/devices`, { headers: sqHeaders });
    const d = await r.json();
    if (d.devices && d.devices.length > 0) {
      const terminal = d.devices.find(x => x.status && x.status.code === 'PAIRED') || d.devices[0];
      squareDeviceId = terminal.id;
    }
  } catch(e) {}

  // Step 2: Fallback to hardcoded if API lookup fails
  if (!squareDeviceId) squareDeviceId = SQUARE_DEVICE_ID;

  // Step 3: Create Terminal checkout
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
    device_id: squareDeviceId
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
          device_id_used: squareDeviceId
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
        device_id: squareDeviceId
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
