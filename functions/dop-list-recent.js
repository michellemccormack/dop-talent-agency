// functions/dop-list-recent.js
// Lists recent DOP uploads by reading metas/<dopId>.json from the 'dop-uploads' store.
// Secure with ADMIN_KEY (pass as query ?key=...).

const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const adminKey = process.env.ADMIN_KEY || '';
    const provided = (event.queryStringParameters && event.queryStringParameters.key) || '';

    if (!adminKey || provided !== adminKey) {
      return {
        statusCode: 401,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const limit = Math.max(1, Math.min(100, Number(event.queryStringParameters?.limit || 50)));

    const siteId = process.env.BLOBS_SITE_ID || 'e70ba1fd-64fe-41a4-bba5-dbc18fe30fc8';
    const token  = process.env.BLOBS_TOKEN   || 'nfp_BdZF6oCWf9H2scBdEpfjgimeR11FRnXf0e24';
    const store  = getStore({ name: 'dop-uploads', siteId, token });

    // List metas/* and load their JSON
    const listed = await store.list({ prefix: 'metas/' });
    const blobItems = Array.isArray(listed?.blobs) ? listed.blobs : (listed || []);

    // Fetch each meta JSON (cap to 200 reads just in case)
    const keys = blobItems.map(b => b.key).slice(0, 200);

    const metas = [];
    for (const key of keys) {
      try {
        const meta = await store.get(key, { type: 'json' });
        if (meta && meta.dopId) metas.push(meta);
      } catch (_) {
        // ignore bad entries
      }
    }

    metas.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, count: Math.min(limit, metas.length), items: metas.slice(0, limit) }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
