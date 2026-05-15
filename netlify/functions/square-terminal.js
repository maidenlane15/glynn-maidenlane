exports.handler = async function(event, context) {
  const SQUARE_ACCESS_TOKEN = 'EAAAl0MyXEtUhq9NrMN8_DdTCJID4WlSJpOrPQdrZr8ukoGjlIIZ8FZFlSsqqIiM';
  const SQUARE_LOCATION_ID  = 'L0FDVGJRJ8ZB3';
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

  // ── GET: diagnostic — returns all device info from Square ──────────────────
  if (event.httpMethod === 'GET') {
    const results = {};

    // Check 1: /v2/devices
    try {
      const r = await fetch(`${SQUARE_API_BASE}/v2/devices`, { headers: sqHeaders });
      results.devices_api = await r.json();
    } catch(e) { results.devices_api_error = e.message; }

    // Check 2: /v2/terminals/checkouts (recent)
    try {
      const r = await fetch(`${SQUARE_API_BASE}/v2/terminals/checkouts?limit=5`, { headers: sqHeaders });
      results.recent_checkouts = await r.json();
    } catch(e) { results.checkouts_error = e.message; }

    // Check 3: /v2/terminals/readers
    try {
      const r = await fetch(`${SQUARE_API_BASE}/v2/terminals/readers`, { headers: sqHeaders });
      results.readers = await r.json();
    } catch(e) { results.readers_error = e.message; }

    return { statusCode: 200, headers: cors, body: JSON.stringify(results, null, 2) };
  }

  // ── POST: create checkout ──────────────────────────────────────────────────
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

  // Discover device_id from Square's devices API
  let squareDeviceId = null;
  let deviceSource = '';

  try {
    const r = await fetch(`${SQUARE_API_BASE}/v2/devices`, { headers: sqHeaders });
    const d = await r.json();
    if (d.devices && d.devices.length > 0) {
      // Prefer a device with TERMINAL category and PAIRED status
      const best = d.devices.find(x =>
        x.status && (x.status.category === 'TERMINAL' || x.status.category === 'SQUARE_TERMINAL') && x.status.code === 'PAIRED'
      ) || d.devices.find(x => x.status && x.status.code === 'PAIRED') || d.devices[0];
      squareDeviceId = best.id;
      deviceSource = 'devices_api';
    }
  } catch(e) { /* continue to fallback */ }

  // Fallback: use device_id from most recent successful checkout
  if (!squareDeviceId) {
    try {
      const r = await fetch(`${SQUARE_API_BASE}/v2/terminals/checkouts?limit=10`, { headers: sqHeaders });
      const d = await r.json();
      if (d.checkouts && d.checkouts.length > 0) {
        const completed = d.checkouts.find(c => c.status === 'COMPLETED') || d.checkouts[0];
        squareDeviceId = completed.device_id;
        deviceSource = 'recent_checkout';
      }
    } catch(e) { /* ignore */ }
  }

  if (!squareDeviceId) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({
        error: 'No active Square Terminal found. Visit glynn-maidenlane-v2.netlify.app/.netlify/functions/square-terminal (GET) to see diagnostic info.',
      })
    };
  }

  // Create Terminal checkout
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
          device_id_used: squareDeviceId,
          device_source: deviceSource
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
        device_id: squareDeviceId,
        device_source: deviceSource
      })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Checkout failed: ' + err.message, device_id_used: squareDeviceId })
    };
  }
};
