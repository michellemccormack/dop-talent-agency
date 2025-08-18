// functions/heygen-proxy.js
// Proxy for HeyGen avatar sync (Task 19). Desktop-only.
// Safe by default: if HEYGEN_API_KEY isn't set, this returns {enabled:false} gracefully.

exports.handler = async (event) => {
  // CORS (Netlify Functions)
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || "";
  const enabled = !!HEYGEN_API_KEY;

  // Basic router
  if (event.httpMethod === "GET") {
    // Health / feature-flag probe
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ enabled }),
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Parse body
  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    /* noop */
  }
  const { text = "", sessionId = "" } = payload;

  // If not configured, reply gracefully so the UI falls back to placeholder video
  if (!enabled) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({
        enabled: false,
        reason: "HEYGEN_API_KEY not set",
      }),
    };
  }

  // --- NOTE ---
  // Real HeyGen Streaming Avatar requires WebRTC/WS session setup.
  // This proxy is intentionally minimal: it returns a temporary "ticket"
  // for the front-end to know HeyGen is available and to flip into "live" mode.
  // You can expand this to negotiate a stream or call a text->talk session
  // once you finalize the exact HeyGen streaming method you want to use.
  // -----------------

  // Example placeholder response to signal "live avatar mode" to the front-end.
  // If/when you wire a real stream URL, return it here as `streamUrl`.
  const ticket = {
    enabled: true,
    ok: true,
    // streamUrl: "wss://example-heygen-session-url", // <- fill when you finalize streaming
    // For now we just return ok:true so the UI shows a subtle "syncing" indicator.
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify(ticket),
  };
};
