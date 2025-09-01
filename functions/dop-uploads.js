// functions/dop-uploads.js
// Saves an image + voice file (base64 fields OR data: URLs) into Netlify Blobs (CommonJS).
// Also writes a tiny meta JSON at metas/<dopId>.json for the admin QA page.

const { uploadsStore } = require('./_blobs'); // centralizes siteId/token

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // Accept either:
    //   A) imageBase64 + imageType + imageName, audioBase64 + audioType + audioName
    //   B) image (data URL), voice (data URL)
    const hasBase64Pair = body.imageBase64 && body.audioBase64;
    const hasDataUrls   = body.image && body.voice;

    if (!hasBase64Pair && !hasDataUrls) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing image/audio (expected imageBase64+audioBase64 OR data URLs)' }),
      };
    }

    // Store (already configured with siteId + token inside _blobs.js)
    const store = uploadsStore();

    // ID per upload
    const dopId = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : String(Date.now());

    const safe = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'file';
    const stripExt = (s) => String(s || '').replace(/\.[^./\\]+$/i, '');
    const extFromMime = (mime) => (mime.split('/')[1] || 'bin').toLowerCase();

    const parseDataUrl = (dataUrl) => {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) throw new Error('Bad data URL');
      return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
    };

    // Normalize inputs -> buffers + mimes + names
    let imgBuf, imgMime, imgName;
    let audBuf, audMime, audName;

    if (hasBase64Pair) {
      imgBuf  = Buffer.from(body.imageBase64, 'base64');
      imgMime = body.imageType || 'image/png';
      imgName = safe(stripExt(body.imageName) || 'photo');

      audBuf  = Buffer.from(body.audioBase64, 'base64');
      audMime = body.audioType || 'audio/mpeg';
      audName = safe(stripExt(body.audioName) || 'voice');
    } else {
      const i = parseDataUrl(body.image);
      const a = parseDataUrl(body.voice);
      imgBuf  = i.buffer;
      imgMime = i.mime;
      imgName = safe(stripExt(body.imageName) || 'photo');

      audBuf  = a.buffer;
      audMime = a.mime;
      audName = safe(stripExt(body.voiceName) || 'voice');
    }

    // Keys (ensure single extension)
    const imgKey   = `images/${dopId}/${imgName}.${extFromMime(imgMime)}`;
    const voiceKey = `voices/${dopId}/${audName}.${extFromMime(audMime)}`;

    // Write blobs
    await store.set(imgKey,   imgBuf, { contentType: imgMime });
    await store.set(voiceKey, audBuf, { contentType: audMime });

    // Write meta JSON for Admin QA page
    const meta = {
      dopId,
      createdAt: new Date().toISOString(),
      image: { key: imgKey, contentType: imgMime, bytes: imgBuf.length },
      voice: { key: voiceKey, contentType: audMime, bytes: audBuf.length },
    };
    const metaKey = `metas/${dopId}.json`;
    await store.set(metaKey, JSON.stringify(meta, null, 2), { contentType: 'application/json' });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, dopId, files: { image: imgKey, voice: voiceKey } }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
