// functions/stt-whisper.js
// POST { audioBase64, mime } -> { text }
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        body: '',
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Method Not Allowed' }),
      };
    }

    const { audioBase64, mime } = JSON.parse(event.body || '{}');
    if (!audioBase64) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing audioBase64' }),
      };
    }

    const bytes = Buffer.from(audioBase64, 'base64');
    const fileMime = mime || 'audio/mp4'; // iOS prefers mp4; webm also ok
    const filename = fileMime.includes('webm') ? 'audio.webm' : 'audio.mp4';

    // Node 18 (Netlify) has fetch/FormData/Blob globals
    const form = new FormData();
    const blob = new Blob([bytes], { type: fileMime });
    form.append('file', blob, filename);
    form.append('model', 'whisper-1');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Whisper error:', data);
      return {
        statusCode: resp.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data || 'Whisper request failed' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ text: data.text || '' }),
    };
  } catch (err) {
    console.error('stt-whisper fatal:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
