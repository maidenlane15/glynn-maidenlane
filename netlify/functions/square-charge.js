// ═══════════════════════════════════════════════════════════════════
// GLYNN PRO — Square Terminal Netlify Function
// File: netlify/functions/square-charge.js
// ═══════════════════════════════════════════════════════════════════
exports.handler = async function(event, context) {
  if(event.httpMethod !== 'POST'){
    return {statusCode:405, body:'Method not allowed'};
  }
  const SQUARE_KEY = process.env.SQUARE_API_KEY;
  if(!SQUARE_KEY){
    return {statusCode:500, body:JSON.stringify({error:'Square API key not configured on server.'})};
  }
  let body;
  try { body = JSON.parse(event.body); }
  catch(e){ return {statusCode:400, body:JSON.stringify({error:'Invalid request body'})}; }
  const { amount, currency, locationId, deviceId, note, env } = body;
  const baseUrl = env === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
  const idempotencyKey = 'glynn-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  try {
    const checkoutResp = await fetch(`${baseUrl}/v2/terminals/checkouts`, {
      method: 'POST',
      headers: {
        'Square-Version': '2024-01-18',
        'Authorization': `Bearer ${SQUARE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        checkout: {
          amount_money: { amount: amount, currency: currency || 'USD' },
          device_options: { device_id: deviceId },
          note: note,
          reference_id: 'GLYNN-' + Date.now()
        }
      })
    });
    const checkoutData = await checkoutResp.json();
    if(!checkoutResp.ok || checkoutData.errors){
      return {statusCode:400, body:JSON.stringify({error:checkoutData.errors?.[0]?.detail||'Square checkout failed'})};
    }
    const checkoutId = checkoutData.checkout?.id;
    if(!checkoutId){
      return {statusCode:500, body:JSON.stringify({error:'No checkout ID returned from Square'})};
    }
    // Poll for completion up to 90 seconds
    for(let i = 0; i < 18; i++){
      await new Promise(r => setTimeout(r, 5000));
      const pollResp = await fetch(`${baseUrl}/v2/terminals/checkouts/${checkoutId}`, {
        headers:{'Square-Version':'2024-01-18','Authorization':`Bearer ${SQUARE_KEY}`}
      });
      const pollData = await pollResp.json();
      const status = pollData.checkout?.status;
      if(status === 'COMPLETED'){
        return {statusCode:200, body:JSON.stringify({
          status:'COMPLETED',
          paymentId:pollData.checkout?.payment_ids?.[0]||checkoutId,
          amount:amount
        })};
      }
      if(status === 'CANCEL_COMPLETED' || status === 'TIMED_OUT'){
        return {statusCode:200, body:JSON.stringify({status:status,error:'Payment cancelled or timed out.'})};
      }
    }
    return {statusCode:200, body:JSON.stringify({status:'TIMED_OUT',error:'Terminal did not respond in 90 seconds.'})};
  } catch(err) {
    return {statusCode:500, body:JSON.stringify({error:'Server error: '+err.message})};
  }
};
