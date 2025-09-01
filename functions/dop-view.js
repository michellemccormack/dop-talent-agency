// functions/dop-view.js
// Returns files for a given dopId. Works for both:
//  - /dop/:id  (via redirect in netlify.toml)
//  - /.netlify/functions/dop-view?id=:id

const { uploadsStore } = require('./_blobs');

const H = { 'content-type': 'application/json' };

exports.handler = async (event) => {
  try {
    // 1) Get dopId from query or from the /dop/:id path
    let dopId =
      (event.queryStringParameters && (event.queryStringParameters.id || event.queryStringParameters.dopId)) ||
      null;

    if (!dopId) {
      const raw = String(event.rawUrl || event.path || '');
      const m = /\/dop\/([^/?#]+)/i.exec(raw);
      if (m) dopId = decodeURIComponent(m[1]);
    }
    if (!dopId) {
      return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'Missing dopId' }) };
    }

    // 2) Open the dop-uploads store and list files
    const store = uploadsStore();

    const [imgList, voiceList] = await Promise.all([
      store.list({ prefix: `images/${dopId}/` }),
      store.list({ prefix: `voices/${dopId}/` }),
    ]);

    const images = (imgList.blobs || []).map(({ key, size, uploadedAt }) => ({ key, size, uploadedAt }));
    const voices = (voiceList.blobs || []).map(({ key, size, uploadedAt }) => ({ key, size, uploadedAt }));

    return { statusCode: 200, headers: H, body: JSON.stringify({ dopId, images, voices }) };
  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
