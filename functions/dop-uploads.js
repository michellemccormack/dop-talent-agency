// functions/dop-uploads.js
// Saves an image + voice file into Netlify Blobs. CommonJS, resilient to payload shape.

const { getStore } = require('@netlify/blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // Accept either:
    //   A) { image: "data:<mime>;base64,...", voice: "data:<mime>;base64,...", imageName?, voiceName? }
    //   B) { imageBase64, imageType, imageName, audioBase64, audioType, audioName }
    const imageDataUrl =
      typeof body.image === 'string' && body.image.startsWith('data:')
        ? body.image
        : (body.imageBase64 && (body.imageType || body.imageMime))
            ? `data:${body.imageType || body.imageMime};base64,${body.imageBase64}`
            : null;

    const voiceDataUrl =
      typeof body.voice === 'string' && body.voice.startsWith('data:')
        ? body.voice
        : (body.audioBase64 && (body.audioType || body.voiceType))
            ? `data:${body.audioType || body.voiceType};base64,${body.audioBase64}`
            : null;

    if (!imageDataUrl || !voiceDataUrl) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing image or voice in request body' }),
      };
    }

    const siteId = process.env.BLOBS_SITE_ID || 'e70ba1fd-64fe-41a4-bba5-dbc18fe30fc8';
    const token  = process.env.BLOBS_TOKEN   || 'nfp_BdZF6oCWf9H2scBdEpfjgimeR11FRnXf0e24';

    // Explicit credentials so we never hit “environment not configured…”
    const store = getStore({ name: 'dop-uploads', siteId, token });

    // Basic helpers
    const parseDataUrl = (s) => {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
      if (!m) throw new Error('Bad data URL');
      return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
    };
    const extFromMime = (mime) => (mime.split('/')[1] || 'bin').toLowerCase();
    const safe = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'file';

    const dopId = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : String(Date.now());

    const { mime: imgMime,  buffer: imgBuf }  = parseDataUrl(imageDataUrl);
    const { mime: audMime,  buffer: audBuf }  = parseDataUrl(voiceDataUrl);

    const imgKey   = `images/${dopId}/${safe(body.imageName || 'face')}.${extFromMime(imgMime)}`;
    const voiceKey = `voices/${dopId}/${safe(body.voiceName || body.audioName || 'voice')}.${extFromMime(audMime)}`;

    await store.set(imgKey,   imgBuf, { contentType: imgMime });
    await store.set(voiceKey, audBuf, { contentType: audMime });

    return {
      statusCode: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, dopId, files: { image: imgKey, voice: voiceKey } }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
