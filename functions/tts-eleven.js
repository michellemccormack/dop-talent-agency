// functions/tts-eleven.js
// Non-streaming TTS endpoint for ElevenLabs (returns audio/mpeg)
// Uses per-prompt voices when a clip hint is provided; otherwise uses a default.

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;

// === YOUR VOICE MAP (from your message) ===
// p_fun     → WEyBkfNR4P8pL1cFo2jV
// p_from    → DqdcNywG9XLHBlbqaZYM
// p_relax   → IcsVrJwpE5wPKqWalifC
// default   → kDIJK53VQMjfQj3fCrML
const VOICES = {
  default: "kDIJK53VQMjfQj3fCrML",
  p_fun:   "WEyBkfNR4P8pL1cFo2jV",
  p_from:  "DqdcNywG9XLHBlbqaZYM",
  p_relax: "IcsVrJwpE5wPKqWalifC",
};

// Basic CORS for the browser
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

exports.handler = async (event) => {
  const method = (event.httpMethod || "").toUpperCase();
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(event.headers?.origin), body: "" };
  }
  if (method !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  if (!ELEVEN_API_KEY) {
    return {
      statusCode: 500,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "Missing ELEVENLABS_API_KEY" }),
    };
  }

  let text = "";
  let clip = "";
  try {
    const body = JSON.parse(event.body || "{}");
    text = (body.text || "").toString();
    clip = (body.clip || "").toString(); // optional hint like "p_fun", "p_from", "p_relax"
  } catch {
    // ignore
  }

  if (!text) {
    return {
      statusCode: 400,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "text is required" }),
    };
  }

  // figure voiceId from clip hint
  const clipKey = clip.replace(/^assets\//, "").replace(/\.mp4$/i, ""); // assets/p_fun.mp4 -> p_fun
  const voiceId = VOICES[clipKey] || VOICES.default;

  // Build ElevenLabs request
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const payload = {
    text,
    model_id: "eleven_multilingual_v2", // safe default; change if you use another
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "elevenlabs fetch failed", detail: String(e) }),
    };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return {
      statusCode: 502,
      headers: corsHeaders(event.headers?.origin),
      body: JSON.stringify({ error: "elevenlabs error", status: resp.status, body: errText.slice(0, 400) }),
    };
  }

  const audio = Buffer.from(await resp.arrayBuffer());

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(event.headers?.origin),
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
    body: audio.toString("base64"),
    isBase64Encoded: true,
  };
};
