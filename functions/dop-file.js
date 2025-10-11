// functions/dop-file.js
// Plan B: Use Netlify Blobs REST API directly to avoid SDK issues

// ---- MIME type helper ----
const guessType = (key = '') => {
  const k = key.toLowerCase();
  if (k.endsWith('.json')) return 'application/json; charset=utf-8'; // so JSON shows in browser
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.mp3') || k.endsWith('.mpeg')) return 'audio/mpeg';
  if (k.endsWith('.wav')) return 'audio/wav';
  if (k.endsWith('.webm')) return 'audio/webm';
  return 'application/octet-stream';
};

const guessType = (key = '') => {
  const k = key.toLowerCase();
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.mp3') || k.endsWith('.mpeg')) return 'audio/mpeg';
  if (k.endsWith('.wav')) return 'audio/wav';
  if (k.endsWith('.webm')) return 'audio/webm';
  return 'application/octet-stream';
};

exports.handler = async (event) => {
  try {
    const key = event.queryStringParameters?.key;
    if (!key) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing key parameter' })
      };
    }

    const siteId = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN;

    if (!siteId || !token) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing Netlify Blobs credentials' })
      };
    }

    console.log(`[dop-file] Fetching key "${key}" via REST API`);

    // Use Netlify Blobs REST API directly
    const blobUrl = `https://api.netlify.com/api/v1/sites/${siteId}/blobs/dop-uploads/${encodeURIComponent(key)}`;
    
    const response = await fetch(blobUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream'
      }
    });

    if (response.status === 404) {
      console.log('[dop-file] File not found via REST API');
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File not found' })
      };
    }

    if (!response.ok) {
      console.error('[dop-file] REST API error:', response.status, response.statusText);
      const errorText = await response.text().catch(() => '');
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Failed to fetch from Netlify Blobs',
          status: response.status,
          details: errorText
        })
      };
    }

    // Get the blob data
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[dop-file] Successfully fetched ${buffer.length} bytes via REST API`);

    // Return as base64-encoded response
    // ---- success return (replace your existing return {...}) ----
const contentType = guessType(key);
const isJson = contentType.startsWith('application/json');

return {
  statusCode: 200,
  headers: {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': buffer.length.toString(),
    'Content-Disposition': 'inline' // tells browser to display not download
  },
  body: isJson ? buffer.toString('utf8') : buffer.toString('base64'),
  isBase64Encoded: !isJson
};

  } catch (err) {
    console.error('[dop-file] Error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message || String(err)
      })
    };
  }
};