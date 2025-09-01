// functions/dop-list-recent.js
// List recent DOP uploads from the 'dop-uploads' store.

const { uploadsStore } = require('./_blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json',
};

// Admin key (env or fallback for testing)
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'adm_8d2e3c9b7a4b4f6cbd1b9d8a3c';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // very simple admin check (?key=...)
  const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
  if (key !== ADMIN_KEY) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const store = uploadsStore();

    let cursor;
    const grouped = {}; // dopId -> { dopId, lastModified, files:{image:[], voice:[]} }

    do {
      const { blobs = [], cursor: next } = await store.list({ cursor });
      for (const b of blobs) {
        const parts = String(b.key).split('/');
        if (parts.length < 3) continue;
        const kind = parts[0]; // images | voices
        const dopId = parts[1];

        const bucket = kind === 'images' ? 'image' : (kind === 'voices' ? 'voice' : null);
        if (!bucket) continue;

        grouped[dopId] ??= { dopId, lastModified: 0, files: { image: [], voice: [] } };
        grouped[dopId].files[bucket].push({ key: b.key, size: b.size, lastModified: b.lastModified });

        const ts = new Date(b.lastModified || Date.now()).getTime();
        if (ts > grouped[dopId].lastModified) grouped[dopId].lastModified = ts;
      }
      cursor = next;
    } while (cursor);

    const items = Object.values(grouped)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 100);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
