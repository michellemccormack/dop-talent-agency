// functions/dop-uploads.js
// Saves an image + voice file into Netlify Blobs. Compatible with multiple payload shapes.

const { getStore } = require('@netlify/blobs');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function safeJSONParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

function decodeBody(event) {
  // Netlify sometimes sets isBase64Encoded for bodies.
  if (event && event.isBase64Encoded && typeof event.body === 'string') {
    try { return Buffer.from(event.body, 'base64').toString('utf8'); } catch { /* fallthrough */ }
  }
  return event.body || '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const raw = decodeBody(event);
    const body = safeJSONParse(raw);

    // Build data URLs from any of the common shapes.
    const imageDataUrl =
      // Full data URL already
      (typeof body.image === 'string' && body.image.startsWith('data:')) ? body.image :
      (typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:')) ? body.imageDataUrl :
      // Split fields (current page)
      (body.imageBase64 && (body.imageType || body.imageMime)) ? `data:${body.imageType || body.imageMime};base64,${body.imageBase64}` :
      // Older alt names
      (body.image_base64 && body.image_mime) ? `data:${body.image_mime};base64,${body.image_base64}` :
      null;

    const voiceDataUrl =
      (typeof body.voice === 'string' && body.voice.startsWith('data:')) ? body.voice :
      (typeof body.voiceDataUrl === 'string' && body.voiceDataUrl.startsWith('data:')) ? body.voiceDataUrl :
      (body.audioBase64 && (body.audioType || body.voiceType)) ? `data:${body.audioType || body.voiceType};base64,${body.audioBase64}` :
      (body.voiceBase64 && body.voiceType) ? `data:${body.voiceType};base64,${body.voiceBase64}` :
      (body.audio_base64 && body.audio_mime) ? `data:${body.audio_mime};base64,${body.audio_base64}` :
      null;

    if (!imageDataUrl || !voiceDataUrl) {
      // Log what we received to Netlify Function logs for quick inspection.
      console.log('Upload payload keys:', Object.keys(body));
      return {
        statusCode: 400,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing image or voice in request body' }),
      };
    }

    const siteId = process.env.BLOBS_SITE_ID || 'e70ba1fd-64fe-41a4-bba5-dbc18fe30fc8';
    const token  = process.env.BLOBS_TOKEN   || 'nfp_BdZF6oCWf9H2scBdEpfjgimeR11FRnXf0e24';
    const store  = getStore({ name: 'dop-uploads', siteId, token });

    const parseDataUrl = (s) => {
      const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
      if (!m) throw new Error('Bad data URL');
      return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
    };
    const extFromMime = (mime) => (mime.split('/')[1] || 'bin').toLowerCase();
    const safe = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'file';

    const dopId = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID() : String(Date.now());

    const { mime: imgMime, buffer: imgBuf }  = parseDataUrl(imageDataUrl);
    const { mime: audMime, buffer: audBuf }  = parseDataUrl(voiceDataUrl);

    const imgName   = safe(body.imageName || body.image_filename || 'face');
    const voiceName = safe(body.voiceName || body.audioName || body.voice_filename || 'voice');

    const imgKey   = `images/${dopId}/${imgName}.${extFromMime(imgMime)}`;
    const voiceKey = `voices/${dopId}/${voiceName}.${extFromMime(audMime)}`;

    await store.set(imgKey,   imgBuf, { contentType: imgMime });
    await store.set(voiceKey, audBuf, { contentType: audMime });

    return {
      statusCode: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, dopId, files: { image: imgKey, voice: voiceKey } }),
    };
  } catch (err) {
    console.error('dop-uploads error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
