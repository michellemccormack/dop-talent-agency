// functions/tts-eleven.js
// Returns audio/mpeg bytes from ElevenLabs for the given text.
// Requires env var ELEVENLABS_API_KEY. Optional ELEVENLABS_VOICE_ID.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { text, voiceId } = JSON.parse(event.body || '{}');
    if (!text || !text.trim()) {
      return { statusCode: 400, body: 'Missing text' };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: 'Missing ELEVENLABS_API_KEY' };
    }

    const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('ElevenLabs error:', errText);
      return { statusCode: resp.status, body: errText };
    }

    const arrayBuffer = await resp.arrayBuffer();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store'
      },
      body: Buffer.from(arrayBuffer).toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: 'Server error' };
  }
};
