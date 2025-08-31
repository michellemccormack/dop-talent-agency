// functions/tts-eleven.js
// CJS • Netlify Functions (Node 18+)
// Request:  POST JSON { text:string, voiceId?:string } -> audio/mpeg (base64)
//          OPTIONS      (pre-warm; returns 204 quickly)

const ELEVEN_API = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID || 'kDIJK53VQMjfQj3fCrML'; // LLM/mic fallback

module.exports.handler = async (event) => {
  try {
    // Fast path: pre-warm / health check
    if (event.httpMethod === 'OPTIONS' || event.httpMethod === 'GET') {
      return {
        statusCode: 204,
        headers: {
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
          'Access-Control-Allow-Headers': 'content-type'
        },
        body: ''
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing ELEVENLABS_API_KEY' }) };
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const text = (payload.text || '').toString();
    if (!text) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing "text"' }) };
    }

    const voiceId = (payload.voiceId || DEFAULT_VOICE_ID).toString();

    const body = {
      text,
      // keep non-stream for stability; change only when migrating SSE later
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8
      }
    };

    const r = await fetch(`${ELEVEN_API}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'audio/mpeg'
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: 'ElevenLabs TTS failed', details: details.slice(0, 600) })
      };
    }

    const arrayBuf = await r.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuf).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      },
      isBase64Encoded: true,
      body: base64Audio
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'TTS function error', message: String(err?.message || err) })
    };
  }
};
