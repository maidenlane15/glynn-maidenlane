exports.handler = async function(event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SQUARE_ACCESS_TOKEN = 'EAAAl0MyXEtUhq9NrMN8_DdTCJID4WlSJpOrPQdrZr8ukoGjlIIZ8FZFlSsqqIiM';
  const SQUARE_DEVICE_ID    = '606CS149C4001895';
  const SQUARE_LOCATION_ID  = 'L0FDVGJRJ8ZB3';

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const amountCents = body.amount_cents;
  const note        = body.note || 'Maidenlane Sale';

  if (!amountCents || amountCents <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
  }

  // Unique idempotency key per request
  const idempotencyKey = 'glynn-' + Date.now() + '-' + Math.random().toString(36).slice(2);

  const payload = {
    idempotency_key: idempotencyKey,
    checkout: {
      amount_money: {
        amount: amountCents,
        currency: 'USD'
      },
      reference_id: idempotencyKey,
      note: note,
      payment_options: {
        autocomplete: true
      }
    },
    device_id: SQUARE_DEVICE_ID
  };

  try {
    const response = await fetch(
      `https://connect.squareup.com/v2/terminals/checkouts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-01-18'
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data.errors?.[0]?.detail || 'Square API error', raw: data })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        checkout_id: data.checkout?.id,
        status: data.checkout?.status
      })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
