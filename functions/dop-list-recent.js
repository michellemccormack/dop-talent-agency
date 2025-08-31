// functions/dop-list-recent.js
// Lists recent dop uploads from the 'dop-uploads' blob store (grouped by dopId).

const { getStore } = require('@netlify/blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  // Gate with ADMIN_KEY
  const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
  const key = url.searchParams.get('key');
  if (!process.env.ADMIN_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ADMIN_KEY not set' }) };
  }
  if (key !== process.env.ADMIN_KEY) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // Same siteId/token you used for uploads; env first, then fallbacks
    const siteId = process.env.BLOBS_SITE_ID || 'e70ba1fd-64fe-41a4-bba5-dbc18fe30fc8';
    const token  = process.env.BLOBS_TOKEN   || 'nfp_BdZF6oCWf9H2scBdEpfjgimeR11FRnXf0e24';

    const store = getStore({ name: 'dop-uploads', siteId, token });

    // fetch all blobs (paged)
    const all = [];
    let cursor;
    do {
      const { blobs = [], cursor: next } = await store.list({ cursor, limit: 1000 });
      all.push(...blobs);
      cursor = next;
    } while (cursor);

    // group by dopId extracted from key: images/{dopId}/... or voices/{dopId}/...
    const map = new Map();
    for (const b of all) {
      const m = /^(images|voices)\/([^/]+)\//.exec(b.key);
      if (!m) continue;
      const dopId = m[2];
      if (!map.has(dopId)) map.set(dopId, []);
      map.get(dopId).push(b);
    }

    const rows = [...map.entries()].map(([dopId, files]) => {
      const bytesTotal = files.reduce((s, f) => s + (f.size || 0), 0);
      const updatedAt = new Date(
        Math.max(
          ...files.map(f => Date.parse(f.lastModified || f.updatedAt || 0) || 0)
        )
      ).toISOString();
      return { dopId, bytesTotal, files, updatedAt };
    }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    return {
      statusCode: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, count: rows.length, items: rows }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
