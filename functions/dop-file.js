// functions/dop-file.js
const { uploadsStore } = require('./_lib/blobs');

exports.handler = async (event) => {
  try {
    const key = event.queryStringParameters?.key;
    if (!key) {
      return { statusCode: 400, body: 'Missing key' };
    }

    const store = uploadsStore();
    const file = await store.get(key, { type: 'arrayBuffer' });

    if (!file) {
      return { statusCode: 404, body: 'Not found' };
    }

    const buf = Buffer.from(file.body);
    return {
      statusCode: 200,
      headers: { 'content-type': file.contentType || 'application/octet-stream' },
      isBase64Encoded: true,
      body: buf.toString('base64'),
    };
  } catch (err) {
    return { statusCode: 500, body: String(err?.message || err) };
  }
};
