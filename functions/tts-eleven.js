// functions/tts-eleven.js
// Phase 1/2 compatibility — ElevenLabs TTS (CommonJS, CORS-safe)
// Uses a fixed voice ID (from env ELEVENLABS_VOICE_ID) so the voice never flips.

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // <-- set your real voice ID in Netlify env

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    // ensure the browser treats this as a binary stream
    "Cache-Control": "no-cache",
  };
}

function bad(statusCode, msg, origin, extra = {}) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ ok: false, error: msg, ...extra }),
  };
}

exports.handler = async (event) => {
  const origin = event.headers?.origin || "*";

  // Preflight
  if ((event.httpMethod || "").toUpperCase() === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  if ((event.httpMethod || "").toUpperCase() !== "POST") {
    return bad(405, "Method Not Allowed", origin);
  }

  if (!ELEVENLABS_API_KEY) {
    return bad(500, "ELEVENLABS_API_KEY is not set", origin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return bad(400, "Invalid JSON body", origin);
  }

  const text = (body.text || "").toString().trim();
  const voiceId = (body.voiceId || DEFAULT_VOICE_ID).trim();

  if (!text) return bad(400, "Text is required", origin);
  if (!voiceId) return bad(500, "Voice ID missing (set ELEVENLABS_VOICE_ID)", origin);

  // ElevenLabs streaming TTS endpoint
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}/stream`;

  // Sensible defaults to keep voice consistent
  const payload = {
    text,
    model_id: "eleven_monolingual_v1", // stable English model (adjust if you use a different one)
    optimize_streaming_latency: 0,     // 0 = max quality; 4 = lowest latency
    voice_settings: {
      stability: 0.55,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return bad(502, "Failed to reach ElevenLabs", origin, { detail: String(err) });
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return bad(502, "ElevenLabs error", origin, { status: resp.status, body: errText.slice(0, 500) });
  }

  const arrayBuf = await resp.arrayBuffer();

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "audio/mpeg",
      "Content-Length": String(arrayBuf.byteLength),
    },
    body: Buffer.from(arrayBuf).toString("base64"),
    isBase64Encoded: true,
  };
};
