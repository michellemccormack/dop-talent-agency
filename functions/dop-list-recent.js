// functions/dop-list-recent.js
// Lists recent dop-uploads grouped by dopId (reads NETLIFY_* envs).
const { getStore } = require('@netlify/blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json',
};

// Your admin key
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'adm_8d2e3c9b7a4b4f6cbd1b9d8a3c';

// Read the correct env names; fall back to your values
const SITE_ID =
  process.env.NETLIFY_SITE_ID || 'e70ba1fd-64fe-41a4-bba5-dbc18fe30fc8';
const BLOBS_TOKEN =
  process.env.NETLIFY_BLOBS_TOKEN || 'nfp_z9XGX9kR8DqEoCVeamSxErwQKbzgKxFg33f0';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Very simple admin check (?key=...)
  const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
  if (key !== ADMIN_KEY) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // IMPORTANT: pass siteId + token explicitly
    const store = getStore({ name: 'dop-uploads', siteId: SITE_ID, token: BLOBS_TOKEN });

    // List everything and group by dopId (images/<dopId>/..., voices/<dopId>/...)
    let cursor;
    const grouped = {}; // { dopId: { dopId, lastModified, files: { image:[], voice:[] } } }

    do {
      const { blobs = [], cursor: next } = await store.list({ cursor });
      for (const b of blobs) {
        const parts = String(b.key).split('/');
        if (parts.length < 3) continue;

        const type = parts[0];         // 'images' or 'voices'
        const dopId = parts[1];        // group key
        const bucket = type === 'images' ? 'image' : (type === 'voices' ? 'voice' : null);
        if (!bucket) continue;

        grouped[dopId] ||= { dopId, lastModified: 0, files: { image: [], voice: [] } };
        grouped[dopId].files[bucket].push({
          key: b.key,
          size: b.size,
          lastModified: b.lastModified,
        });

        const ts = new Date(b.lastModified || Date.now()).getTime();
        if (ts > grouped[dopId].lastModified) grouped[dopId].lastModified = ts;
      }
      cursor = next;
    } while (cursor);

    // Sort newest first, cap to something reasonable
    const items = Object.values(grouped)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 100);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
