// netlify/functions/shopify-data.js
// Deploy to: netlify/functions/shopify-data.js
//
// Read-only Shopify connector for BOTH stores (Maidenlane + Cramp Tea).
// Uses the client credentials grant (Shopify's current, post-2026 flow for
// custom apps) — a fresh access token is requested from Shopify every sync.
// Tokens expire in ~24 hours and are cheap/fast to acquire (no user redirect
// involved), so there's no need to persist them the way QuickBooks' do —
// each sync just gets its own fresh token and uses it once.
//
// Env vars required, per store:
//   SHOPIFY_MAIDENLANE_DOMAIN / SHOPIFY_MAIDENLANE_CLIENT_ID / SHOPIFY_MAIDENLANE_CLIENT_SECRET
//   SHOPIFY_CRAMPTEA_DOMAIN   / SHOPIFY_CRAMPTEA_CLIENT_ID   / SHOPIFY_CRAMPTEA_CLIENT_SECRET
// Domain = the store's *.myshopify.com address (not the custom domain).

const API_VERSION = '2026-07';

const STORES = [
  { key: 'maidenlane', label: 'Maidenlane', domainEnv: 'SHOPIFY_MAIDENLANE_DOMAIN', idEnv: 'SHOPIFY_MAIDENLANE_CLIENT_ID', secretEnv: 'SHOPIFY_MAIDENLANE_CLIENT_SECRET' },
  { key: 'cramptea', label: 'Cramp Tea', domainEnv: 'SHOPIFY_CRAMPTEA_DOMAIN', idEnv: 'SHOPIFY_CRAMPTEA_CLIENT_ID', secretEnv: 'SHOPIFY_CRAMPTEA_CLIENT_SECRET' }
];

async function fetchOrders(base, headers, monthStartIso) {
  let revenue = 0, count = 0;
  try {
    const url = base + '/orders.json?status=any&created_at_min=' + encodeURIComponent(monthStartIso) + '&limit=250';
    const r = await fetch(url, { headers: headers });
    const d = await r.json();
    const orders = d.orders || [];
    count = orders.length;
    orders.forEach(function (o) { revenue += parseFloat(o.total_price || 0) || 0; });
  } catch (e) {}
  return { revenue: revenue, count: count };
}

async function fetchCount(url, headers) {
  try {
    const r = await fetch(url, { headers: headers });
    const d = await r.json();
    return d.count || 0;
  } catch (e) {
    return 0;
  }
}

async function syncStore(store) {
  const domain = process.env[store.domainEnv];
  const clientId = process.env[store.idEnv];
  const clientSecret = process.env[store.secretEnv];

  if (!domain || !clientId || !clientSecret) {
    return { store: store.key, label: store.label, success: false, error: store.label + ' is not configured yet (missing environment variables).' };
  }

  try {
    const tokenResp = await fetch('https://' + domain + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString()
    });
    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      return { store: store.key, label: store.label, success: false, error: 'Could not get an access token for ' + store.label + '.' };
    }

    const apiHeaders = { 'X-Shopify-Access-Token': tokenData.access_token, 'Content-Type': 'application/json' };
    const base = 'https://' + domain + '/admin/api/' + API_VERSION;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [orders, productCount, customerCount] = await Promise.all([
      fetchOrders(base, apiHeaders, monthStart),
      fetchCount(base + '/products/count.json', apiHeaders),
      fetchCount(base + '/customers/count.json', apiHeaders)
    ]);

    return {
      store: store.key,
      label: store.label,
      success: true,
      mtdRevenue: orders.revenue,
      mtdOrderCount: orders.count,
      productCount: productCount,
      customerCount: customerCount
    };
  } catch (e) {
    return { store: store.key, label: store.label, success: false, error: 'Sync failed for ' + store.label + ': ' + e.message };
  }
}

exports.handler = async function (event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const now = new Date();
  const results = await Promise.all(STORES.map(syncStore));

  const combined = results.reduce(function (acc, r) {
    if (r.success) {
      acc.mtdRevenue += r.mtdRevenue || 0;
      acc.mtdOrderCount += r.mtdOrderCount || 0;
      acc.productCount += r.productCount || 0;
      acc.customerCount += r.customerCount || 0;
    }
    return acc;
  }, { mtdRevenue: 0, mtdOrderCount: 0, productCount: 0, customerCount: 0 });

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      success: true,
      fetchedAt: now.toISOString(),
      stores: results,
      combined: combined
    })
  };
};
