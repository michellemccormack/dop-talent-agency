// functions/dop-uploads.js
// Saves an image + voice file (sent as data: URLs) into Netlify Blobs.

import { getStore } from '@netlify/blobs';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { image, imageName, voice, voiceName } = JSON.parse(event.body || '{}');
    if (!image || !voice) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing image or voice in request body' }),
      };
    }

    // --- Netlify Blobs auth (env first, fallback to provided values) ---
    const siteId =
      process.env.BLOBS_SITE_ID || 'e70ba1fd-64fe-41a4-bba5-dbc18fe30fc8';
    const token =
      process.env.BLOBS_TOKEN || 'nfp_BdZF6oCWf9H2scBdEpfjgimeR11FRnXf0e24';

    // Correct way: get a store *with* siteId + token
    const store = getStore({ name: 'dop-uploads', siteId, token });
    // -------------------------------------------------------------------

    // Simple ID for this upload
    const dopId =
      (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now());

    // helpers
    const parseDataUrl = (dataUrl) => {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) throw new Error('Bad data URL');
      return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
    };
    const extFromMime = (mime) => (mime.split('/')[1] || 'bin').toLowerCase();

    const { mime: imgMime, buffer: imgBuf } = parseDataUrl(image);
    const { mime: voiceMime, buffer: voiceBuf } = parseDataUrl(voice);

    const safe = (s) => String(s || '').replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
    const imgKey = `images/${dopId}/${safe(imageName || 'face')}.${extFromMime(imgMime)}`;
    const voiceKey = `voices/${dopId}/${safe(voiceName || 'voice')}.${extFromMime(voiceMime)}`;

    await store.set(imgKey, imgBuf, { contentType: imgMime });
    await store.set(voiceKey, voiceBuf, { contentType: voiceMime });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        dopId,
        files: { image: imgKey, voice: voiceKey },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
}
