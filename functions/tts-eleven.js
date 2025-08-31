// functions/tts-eleven.js
// CJS • Netlify Functions (Node 18+)
// POST  { text:string, clip?:string, voiceId?:string } -> audio/mpeg (base64)
// GET/OPTIONS -> 204 (pre-warm/health)

const ELEVEN_API = 'https://api.elevenlabs.io/v1/text-to-speech';

// Deterministic voice map
const VOICES = {
  fun:   'WEyBkfNR4P8pL1cFo2jV',
  from:  'DqdcNywG9XLHBlbqaZYM',
  relax: 'IcsVrJwpE5wPKqWalifC',
  fallback: process.env.DEFAULT_VOICE_ID || 'kDIJK53VQMjfQj3fCrML'
};

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
    'Access-Control-Allow-Headers': 'content-type',
    ...extra,
  };
}

// Infer intent strictly from the clip hint (NO text guessing)
function intentFromClip(clip) {
  if (!clip) return null;
  const s = String(clip).toLowerCase();
  // accepts: "assets/p_fun.mp4", "p_fun", "fun"
  let m = s.match(/(?:^|[/_])p?_(fun|from|relax)(?:\.|$)/);
  if (!m) m = s.match(/(?:^|[/_])(fun|from|relax)(?:\.|$)/);
  return m ? m[1] : null;
}

function pickVoiceId(payload) {
  if (payload.voiceId) return String(payload.voiceId); // explicit wins
  const guessed = intentFromClip(payload.clip);
  return guessed ? VOICES[guessed] : VOICES.fallback;
}

function clampText(s, max = 220) {
  const str = String(s || '').trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastPunct = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  return (lastPunct > 120 ? cut.slice(0, lastPunct + 1) : cut) + '…';
}

module.exports.handler = async (event) => {
  try {
    // Pre-warm / health
    if (event.httpMethod === 'OPTIONS' || event.httpMethod === 'GET') {
      return { statusCode: 204, headers: cors({ 'Cache-Control': 'no-store' }), body: '' };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[tts-eleven] ELEVENLABS_API_KEY is not set.');
      return {
        statusCode: 401,
        headers: cors({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          error: 'ELEVENLABS_API_KEY missing',
          hint: 'Set ELEVENLABS_API_KEY in Netlify → Site settings → Environment variables, then redeploy.'
        })
      };
    }

    let payload = {};
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const text = clampText(payload.text || '');
    if (!text) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Missing "text"' }) };
    }

    const voiceId = pickVoiceId(payload);

    // Faster model for lower latency
    const body = {
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.8 }
    };

    // Hard timeout to avoid hangs
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const r = await fetch(`${ELEVEN_API}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'audio/mpeg'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }).catch((e) => {
      throw new Error('TTS request aborted/failed: ' + (e?.message || e));
    });

    clearTimeout(timeout);

    if (!r || !r.ok) {
      const details = r ? (await r.text().catch(() => '')) : '';
      return {
        statusCode: r?.status || 502,
        headers: cors({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ error: 'ElevenLabs TTS failed', details: details.slice(0, 600) })
      };
    }

    const arrayBuf = await r.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuf).toString('base64');

    return {
      statusCode: 200,
      headers: cors({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }),
      isBase64Encoded: true,
      body: base64Audio
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'TTS function error', message: String(err?.message || err) })
    };
  }
};
