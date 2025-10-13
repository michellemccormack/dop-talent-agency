// functions/dop-file.js
// Using Blobs SDK to properly retrieve file contents

const { getStore } = require('@netlify/blobs');

// MIME type helper
const guessType = (key = '') => {
  const k = key.toLowerCase();
  if (k.endsWith('.json')) return 'application/json; charset=utf-8';
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

    console.log('[dop-file] Fetching key:', key);

    // Use Blobs SDK
    const store = getStore({
      name: 'dop-uploads',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
      consistency: 'strong'
    });

    // Get the blob as arrayBuffer
    const data = await store.get(key, { type: 'arrayBuffer' });

    if (!data) {
      console.log('[dop-file] File not found:', key);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File not found' })
      };
    }

    // Convert to Buffer
    const buffer = Buffer.from(data);
    console.log('[dop-file] Successfully retrieved:', buffer.length, 'bytes');

    // Determine content type
    const contentType = guessType(key);
    const isJson = contentType.startsWith('application/json');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': 'inline'
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
