// functions/dop-list-recent.js
// Lists recent DOP uploads from the "dop-uploads" blob store.
// Secure with ?key=... that must match process.env.ADMIN_KEY

const { getStore } = require('@netlify/blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json',
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    // --- auth ---
    const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // --- Blobs store (explicit siteId + token just like dop-uploads) ---
    const siteId =
      process.env.NETLIFY_SITE_ID ||
      process.env.BLOBS_SITE_ID ||
      process.env.NETLIFY_SITE_ID_FALLBACK; // optional extra
    const token =
      process.env.NETLIFY_BLOBS_TOKEN ||
      process.env.BLOBS_TOKEN;

    if (!siteId || !token) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({
          error:
            'Missing siteId/token. Set NETLIFY_SITE_ID (or BLOBS_SITE_ID) and NETLIFY_BLOBS_TOKEN (or BLOBS_TOKEN).',
        }),
      };
    }

    const store = getStore({ name: 'dop-uploads', siteId, token });

    // --- page through the blobs ---
    const blobs = [];
    let cursor;
    do {
      const page = await store.list({ cursor });
      (page.blobs || []).forEach((b) => blobs.push(b));
      cursor = page.cursor;
    } while (cursor);

    // Group by dopId (keys look like: images/<dopId>/..., voices/<dopId>/...)
    const byId = new Map();
    for (const b of blobs) {
      const m = /^(?:images|voices)\/([^/]+)\//.exec(b.key || '');
      if (!m) continue;
      const dopId = m[1];
      const rec = byId.get(dopId) || { dopId, files: [], totalBytes: 0, updatedAt: 0 };
      rec.files.push({ key: b.key, size: b.size || 0, updatedAt: b.updatedAt || null });
      rec.totalBytes += b.size || 0;

      const ts = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (ts > rec.updatedAt) rec.updatedAt = ts;

      byId.set(dopId, rec);
    }

    const latest = Array.from(byId.values())
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 100);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, count: latest.length, latest }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
