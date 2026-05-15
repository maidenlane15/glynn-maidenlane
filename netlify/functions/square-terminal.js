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

  const amountCents = parseInt(body.amount_cents);
  const note = body.note || 'Maidenlane Sale';

  if (!amountCents || amountCents <= 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid amount' }) };
  }

  // Step 1: Discover the real Square device_id by listing devices at this location
  let squareDeviceId = null;
  try {
    const devResp = await fetch(
      `${SQUARE_API_BASE}/v2/devices?location_id=${SQUARE_LOCATION_ID}`,
      { method: 'GET', headers: sqHeaders }
    );
    const devData = await devResp.json();
    if (devData.devices && devData.devices.length > 0) {
      const terminal = devData.devices.find(d => d.status && d.status.category === 'TERMINAL') || devData.devices[0];
      squareDeviceId = terminal.id;
    }
  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Device lookup failed: ' + e.message }) };
  }

  // Step 2: Fallback — check recent checkouts for a valid device_id
  if (!squareDeviceId) {
    try {
      const listResp = await fetch(`${SQUARE_API_BASE}/v2/terminals/checkouts?limit=5`, { method: 'GET', headers: sqHeaders });
      const listData = await listResp.json();
      if (listData.checkouts && listData.checkouts.length > 0) {
        squareDeviceId = listData.checkouts[0].device_id;
      }
    } catch(e) { /* ignore */ }
  }

  if (!squareDeviceId) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({
        error: 'Square Terminal not found. Make sure Terminal 1895 is powered on and connected to Maidenlane01-5G.',
        hint: 'Check Square Dashboard > Devices to confirm the terminal shows as Active.'
      })
    };
  }

  // Step 3: Create the Terminal checkout — this sends payment prompt to Terminal 1895
  const idempotencyKey = 'glynn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const checkoutPayload = {
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
      { method: 'POST', headers: sqHeaders, body: JSON.stringify(checkoutPayload) }
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
