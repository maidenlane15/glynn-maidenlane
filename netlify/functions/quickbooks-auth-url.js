// netlify/functions/quickbooks-auth-url.js
// Deploy to: netlify/functions/quickbooks-auth-url.js
//
// Returns the Intuit OAuth2 consent-screen URL. Client ID lives server-side
// (env var) so it's never hardcoded in the client. The `state` value is
// generated client-side (CSRF token) and simply echoed back into the URL.

exports.handler = async function (event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ error: 'QUICKBOOKS_CLIENT_ID or QUICKBOOKS_REDIRECT_URI is not set in Netlify environment variables yet.' })
    };
  }

  const state = (event.queryStringParameters && event.queryStringParameters.state) || '';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state: state
  });

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ url: 'https://appcenter.intuit.com/connect/oauth2?' + params.toString() })
  };
};
