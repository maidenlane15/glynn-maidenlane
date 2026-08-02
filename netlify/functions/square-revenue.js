// netlify/functions/square-revenue.js
// Deploy to: netlify/functions/square-revenue.js in the GitHub repo
//
// Read-only Square connector: real settled sales, catalog count, customer count.
// This is intentionally NOT the same pattern as send-email.js / music-piapi.js
// (which take a key from the client each call). SQUARE_ACCESS_TOKEN grants
// unrestricted access to the whole Square account, so it lives ONLY as a
// Netlify environment variable (Site settings > Environment variables) and is
// never sent from, or stored in, the browser.

exports.handler = async function (event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ success: false, error: 'SQUARE_ACCESS_TOKEN is not set in Netlify environment variables yet.' })
    };
  }

  const base = 'https://connect.squareup.com/v2';
  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

  try {
    // 1. Locations
    const locResp = await fetch(base + '/locations', { headers: authHeaders });
    const locData = await locResp.json();
    if (!locResp.ok) {
      const detail = (locData.errors && locData.errors[0] && locData.errors[0].detail) || 'Square locations lookup failed.';
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: detail }) };
    }
    const locations = (locData.locations || []).map(function (l) { return { id: l.id, name: l.name }; });
    const locationIds = locations.map(function (l) { return l.id; });

    // 2. Orders — last 35 days, completed, all locations (paginate up to 5 pages)
    const since = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    let orders = [];
    let cursor = null;
    let pages = 0;
    do {
      const searchBody = {
        location_ids: locationIds,
        query: {
          filter: {
            date_time_filter: { created_at: { start_at: since } },
            state_filter: { states: ['COMPLETED'] }
          },
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
        },
        limit: 100
      };
      if (cursor) searchBody.cursor = cursor;
      const oResp = await fetch(base + '/orders/search', { method: 'POST', headers: authHeaders, body: JSON.stringify(searchBody) });
      const oData = await oResp.json();
      if (!oResp.ok) {
        const detail = (oData.errors && oData.errors[0] && oData.errors[0].detail) || 'Square orders search failed.';
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: detail }) };
      }
      orders = orders.concat(oData.orders || []);
      cursor = oData.cursor || null;
      pages++;
    } while (cursor && pages < 5);

    // 3. Aggregate revenue
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let todayCents = 0, weekCents = 0, monthCents = 0, totalCents = 0;
    let todayTx = 0, weekTx = 0, monthTx = 0;
    const recent = [];
    orders.forEach(function (o) {
      const amt = (o.total_money && o.total_money.amount) || 0;
      const created = new Date(o.created_at);
      totalCents += amt;
      if (o.created_at.slice(0, 10) === todayStr) { todayCents += amt; todayTx++; }
      if (created >= weekStart) { weekCents += amt; weekTx++; }
      if (created >= monthStart) { monthCents += amt; monthTx++; }
      if (recent.length < 10) recent.push({ id: o.id, amount: amt / 100, created_at: o.created_at, state: o.state });
    });

    // 4. Catalog count (first page — fast count, flags if more exist)
    let catalogCount = 0, catalogHasMore = false;
    try {
      const cResp = await fetch(base + '/catalog/list?types=ITEM', { headers: authHeaders });
      const cData = await cResp.json();
      if (cResp.ok) { catalogCount = (cData.objects || []).length; catalogHasMore = !!cData.cursor; }
    } catch (e) {}

    // 5. Customer count (first page)
    let customerCount = 0, customerHasMore = false;
    try {
      const cuResp = await fetch(base + '/customers?limit=100', { headers: authHeaders });
      const cuData = await cuResp.json();
      if (cuResp.ok) { customerCount = (cuData.customers || []).length; customerHasMore = !!cuData.cursor; }
    } catch (e) {}

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        fetchedAt: now.toISOString(),
        locations: locations,
        revenue: {
          today: todayCents / 100, week: weekCents / 100, month: monthCents / 100, total35d: totalCents / 100,
          todayTx: todayTx, weekTx: weekTx, monthTx: monthTx, totalTx35d: orders.length
        },
        catalogCount: catalogCount, catalogHasMore: catalogHasMore,
        customerCount: customerCount, customerHasMore: customerHasMore,
        recentOrders: recent
      })
    };
  } catch (err) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Square sync failed: ' + err.message }) };
  }
};
