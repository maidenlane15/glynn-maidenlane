// netlify/functions/quickbooks-callback.js
// Deploy to: netlify/functions/quickbooks-callback.js
// This is the exact URL that must be registered as the Redirect URI in the
// Intuit Developer Portal: https://glynn-maidenlane-v2.netlify.app/.netlify/functions/quickbooks-callback
//
// Intuit redirects here after the user approves access, with ?code&realmId&state
// (or ?error on denial). This exchanges the code for an access/refresh token
// pair and stores it in Netlify Blobs — never in the client. It then redirects
// back to the app with a status flag for the UI to read.

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const qs = event.queryStringParameters || {};
  const code = qs.code;
  const realmId = qs.realmId;
  const state = qs.state || '';
  const oauthError = qs.error;

  const appBase = 'https://glynn-maidenlane-v2.netlify.app/';

  function redirectBack(statusVal, extra) {
    const p = new URLSearchParams({ qb_status: statusVal, qb_state: state });
    if (extra) Object.keys(extra).forEach(function (k) { p.set(k, extra[k]); });
    return { statusCode: 302, headers: { Location: appBase + '?' + p.toString() }, body: '' };
  }

  if (oauthError) return redirectBack('error', { qb_error: oauthError });
  if (!code || !realmId) return redirectBack('error', { qb_error: 'missing_code_or_realm' });
  if (!clientId || !clientSecret || !redirectUri) return redirectBack('error', { qb_error: 'server_not_configured' });

  try {
    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const tokenResp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': 'Basic ' + basic
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }).toString()
    });
    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      return redirectBack('error', { qb_error: 'token_exchange_failed' });
    }

    const store = getStore('quickbooks');
    const record = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      realmId: realmId,
      expires_at: Date.now() + (tokenData.expires_in ? tokenData.expires_in * 1000 : 3600000),
      updated_at: new Date().toISOString()
    };
    await store.setJSON('tokens', record);

    return redirectBack('connected');
  } catch (e) {
    return redirectBack('error', { qb_error: 'exception' });
  }
};
