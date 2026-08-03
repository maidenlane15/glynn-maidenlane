// netlify/functions/quickbooks-data.js
// Deploy to: netlify/functions/quickbooks-data.js
//
// Reads QuickBooks Online data server-side. v1 scope = "read everything":
// month-to-date P&L, open invoices, open bills, customer + vendor counts.
// Each data section below is wrapped in its own try/catch and is independent
// of the others on purpose — a future Settings toggle can simply skip calling
// a section without touching the rest of this function.
//
// Access tokens (1hr) are refreshed automatically when close to expiry. The
// refresh token ROTATES every time it's used — the new one is saved back to
// Netlify Blobs immediately, or the connection is lost until reconnected.

const { getStore } = require('@netlify/blobs');

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

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'QuickBooks environment variables are not set yet.' }) };
  }

  const store = getStore('quickbooks');
  let record;
  try { record = await store.get('tokens', { type: 'json' }); } catch (e) { record = null; }
  if (!record || !record.refresh_token) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'QuickBooks is not connected yet. Tap Connect QuickBooks first.' }) };
  }

  async function refreshAccessToken() {
    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const resp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': 'Basic ' + basic
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: record.refresh_token }).toString()
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error('refresh_failed');
    record.access_token = data.access_token;
    record.refresh_token = data.refresh_token || record.refresh_token; // rotates — must persist
    record.expires_at = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000);
    record.updated_at = new Date().toISOString();
    await store.setJSON('tokens', record);
  }

  try {
    if (!record.expires_at || Date.now() > (record.expires_at - 120000)) {
      await refreshAccessToken();
    }
  } catch (e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'QuickBooks reconnection needed \u2014 the refresh token was rejected. Tap Connect QuickBooks again.' }) };
  }

  const realmId = record.realmId;
  const qbEnv = (process.env.QUICKBOOKS_ENVIRONMENT || 'production').toLowerCase();
  const apiHost = qbEnv === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
  const base = apiHost + '/v3/company/' + realmId;
  const authHeaders = { 'Authorization': 'Bearer ' + record.access_token, 'Accept': 'application/json' };

  async function qbFetch(url) {
    const r = await fetch(url, { headers: authHeaders });
    const d = await r.json();
    if (!r.ok) {
      const detail = (d.Fault && d.Fault.Error && d.Fault.Error[0] && d.Fault.Error[0].Message) || 'QuickBooks API error';
      throw new Error(detail);
    }
    return d;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  // ── Section 1: Profit & Loss, month-to-date ─────────────────────────────
  let plIncome = 0, plExpense = 0;
  try {
    const plData = await qbFetch(base + '/reports/ProfitAndLoss?start_date=' + monthStart + '&end_date=' + today + '&minorversion=65');
    const rows = (plData.Rows && plData.Rows.Row) || [];
    rows.forEach(function (r) {
      if (r.group === 'Income' && r.Summary && r.Summary.ColData) plIncome = parseFloat((r.Summary.ColData[1] || {}).value || 0) || plIncome;
      if (r.group === 'Expenses' && r.Summary && r.Summary.ColData) plExpense = parseFloat((r.Summary.ColData[1] || {}).value || 0) || plExpense;
    });
  } catch (e) {}

  // ── Section 2: Open invoices (receivables) ──────────────────────────────
  let openInvoicesTotal = 0, openInvoicesCount = 0;
  try {
    const invData = await qbFetch(base + '/query?query=' + encodeURIComponent("SELECT Id, Balance FROM Invoice WHERE Balance > '0' MAXRESULTS 1000") + '&minorversion=65');
    const invoices = (invData.QueryResponse && invData.QueryResponse.Invoice) || [];
    openInvoicesCount = invoices.length;
    invoices.forEach(function (i) { openInvoicesTotal += (i.Balance || 0); });
  } catch (e) {}

  // ── Section 3: Open bills (payables) ────────────────────────────────────
  let openBillsTotal = 0, openBillsCount = 0;
  try {
    const billData = await qbFetch(base + '/query?query=' + encodeURIComponent("SELECT Id, Balance FROM Bill WHERE Balance > '0' MAXRESULTS 1000") + '&minorversion=65');
    const bills = (billData.QueryResponse && billData.QueryResponse.Bill) || [];
    openBillsCount = bills.length;
    bills.forEach(function (b) { openBillsTotal += (b.Balance || 0); });
  } catch (e) {}

  // ── Section 4: Customer + Vendor counts ─────────────────────────────────
  let customerCount = 0, vendorCount = 0;
  try {
    const custData = await qbFetch(base + '/query?query=' + encodeURIComponent('SELECT COUNT(*) FROM Customer') + '&minorversion=65');
    customerCount = (custData.QueryResponse && custData.QueryResponse.totalCount) || 0;
  } catch (e) {}
  try {
    const vendData = await qbFetch(base + '/query?query=' + encodeURIComponent('SELECT COUNT(*) FROM Vendor') + '&minorversion=65');
    vendorCount = (vendData.QueryResponse && vendData.QueryResponse.totalCount) || 0;
  } catch (e) {}

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      success: true,
      fetchedAt: now.toISOString(),
      profitLoss: { mtdIncome: plIncome, mtdExpense: plExpense, mtdNet: plIncome - plExpense },
      openInvoicesTotal: openInvoicesTotal, openInvoicesCount: openInvoicesCount,
      openBillsTotal: openBillsTotal, openBillsCount: openBillsCount,
      customerCount: customerCount, vendorCount: vendorCount
    })
  };
};
