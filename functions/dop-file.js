// functions/dop-file.js
// Streams a blob (image or audio) from the dop-uploads store.
// Returns base64 with isBase64Encoded=true so <img> / <audio> can load it.

const { uploadsStore } = require('./_lib/blobs');

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
    if (!key) return { statusCode: 400, body: 'Missing key' };

    const store = uploadsStore();

    // Get raw bytes. If the key doesn't exist, this returns null/undefined.
    const raw = await store.get(key, { type: 'buffer' });
    if (!raw) return { statusCode: 404, body: 'Not found' };

    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    return {
      statusCode: 200,
      headers: {
        'content-type': guessType(key),
        'cache-control': 'public, max-age=31536000, immutable',
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
