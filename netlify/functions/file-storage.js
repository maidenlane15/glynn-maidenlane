// netlify/functions/file-storage.js
// Deploy to: netlify/functions/file-storage.js
//
// Server-side document/image storage for Glynn Pro's company chat file
// uploads. Files live in Netlify Blobs, not the browser, so they're
// accessible from any device signed in — not just the one that uploaded
// them. Uses the same explicit siteID/token pattern as quickbooks-data.js,
// since Netlify's automatic Blobs detection has proven unreliable.
//
// Storage design: a lightweight "index" blob holds metadata for every file
// (id, name, type, coId, coName, date, size — no file content), so listing
// files stays fast even with many uploaded. Each file's actual content
// (base64 dataUrl) is stored in its own separate blob, fetched only when a
// specific file is opened. This keeps "list" calls small and fast.
//
// Enforced size limit: 4MB per file (raw, pre-base64). This is not an
// arbitrary choice — Netlify Functions have a hard 6MB request payload
// limit, reduced to ~4.5MB effective for base64-encoded binary data. 4MB
// raw leaves safety margin and comfortably covers 1-page contracts and
// photos, which is the actual real-world use case here.

const { getStore } = require('@netlify/blobs');

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB raw file size limit
const INDEX_KEY = 'file-index';

function getBlobsStore(name) {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name, siteID, token });
  }
  return getStore(name);
}

function estimateBytesFromDataUrl(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  // Base64 -> raw byte estimate
  return Math.floor(b64.length * 0.75);
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

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Invalid request body.' }) };
  }

  const store = getBlobsStore('glynn-files');
  const action = body.action;

  try {
    if (action === 'upload') {
      const { coId, coName, type, name, mimeType, dataUrl } = body;
      if (!dataUrl || !name) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Missing file data.' }) };
      }
      const sizeBytes = estimateBytesFromDataUrl(dataUrl);
      if (sizeBytes > MAX_FILE_BYTES) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'File is too large. Maximum size is 4MB — this file is about ' + (sizeBytes / (1024 * 1024)).toFixed(1) + 'MB.' }) };
      }

      const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const record = {
        id: id, coId: coId || '', coName: coName || '', type: type || 'doc',
        name: name, mimeType: mimeType || '', dataUrl: dataUrl,
        size: sizeBytes,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        uploadedAt: new Date().toISOString()
      };
      await store.setJSON('file:' + id, record);

      let index = [];
      try { index = (await store.get(INDEX_KEY, { type: 'json' })) || []; } catch (e) { index = []; }
      index.unshift({ id: id, coId: record.coId, coName: record.coName, type: record.type, name: record.name, mimeType: record.mimeType, size: record.size, date: record.date, uploadedAt: record.uploadedAt });
      await store.setJSON(INDEX_KEY, index);

      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, id: id, meta: index[0] }) };
    }

    if (action === 'list') {
      let index = [];
      try { index = (await store.get(INDEX_KEY, { type: 'json' })) || []; } catch (e) { index = []; }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, files: index }) };
    }

    if (action === 'get') {
      const id = body.id;
      if (!id) return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Missing file id.' }) };
      let record = null;
      try { record = await store.get('file:' + id, { type: 'json' }); } catch (e) { record = null; }
      if (!record) return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'File not found.' }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, file: record }) };
    }

    if (action === 'delete') {
      const id = body.id;
      if (!id) return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Missing file id.' }) };
      try { await store.delete('file:' + id); } catch (e) {}
      let index = [];
      try { index = (await store.get(INDEX_KEY, { type: 'json' })) || []; } catch (e) { index = []; }
      index = index.filter(function (f) { return f.id !== id; });
      await store.setJSON(INDEX_KEY, index);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Unknown action.' }) };
  } catch (err) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'File storage error: ' + err.message }) };
  }
};
