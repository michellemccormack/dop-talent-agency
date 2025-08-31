// functions/tts-eleven.js
// CJS • Netlify Functions (Node 18+)
// Request:  POST JSON { text:string, voiceId?:string }
// Response: audio/mpeg bytes (binary; client uses res.arrayBuffer())

const ELEVEN_API = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID || 'kDIJK53VQMjfQj3fCrML'; // LLM/mic fallback

module.exports.handler = async (event) => {
  try {
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

    // honor explicit voiceId from client; otherwise use default
    const voiceId = (payload.voiceId || DEFAULT_VOICE_ID).toString();

    // ElevenLabs request body (non-stream)
    const body = {
      text,
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

    // Netlify supports base64 responses for binary; the platform decodes for the browser fetch
    const arrayBuf = await r.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuf).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store'
      },
      isBase64Encoded: true,
      body: base64Audio
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'TTS function error', message: String(err?.message || err) })
    };
  }
};
