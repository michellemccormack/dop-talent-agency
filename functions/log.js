// functions/log.js — JSONL logger to Netlify Blobs (CommonJS)
// Adds: CORS + GET beacon mode (?e=<base64(json)>)

exports.handler = async (event) => {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
  };

  // --- Preflight ---
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // --- Env ---
  const siteId = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || "";
  const token =
    process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN || "";
  const project = (process.env.PROJECT_NAME || "dopple").toLowerCase();

  if (!siteId || !token) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
      body: "Missing NETLIFY_SITE_ID and/or NETLIFY_BLOBS_TOKEN",
    };
  }

  // --- Parse entry from POST JSON or GET ?e=base64(json) ---
  let entryPayload = null;

  try {
    if (event.httpMethod === "POST") {
      entryPayload = JSON.parse(event.body || "{}");
    } else if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || event.queryString || event.queryStringParameters);
      const raw = (params.get ? params.get("e") : (event.queryStringParameters?.e || "")) || "";
      if (!raw) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
          body: "Bad Request: missing ?e",
        };
      }
      const json = Buffer.from(raw, "base64").toString("utf8");
      entryPayload = JSON.parse(json);
    } else {
      return {
        statusCode: 405,
        headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
        body: "Method Not Allowed",
      };
    }
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
      body: "Bad Request: invalid JSON",
    };
  }

  // --- Build JSONL line ---
  const entry = { ts: new Date().toISOString(), project, ...entryPayload };
  const line = JSON.stringify(entry) + "\n";

  // --- Blobs REST (safe GET→PUT append) ---
  const key = `logs/${project}.jsonl`;
  const base = `https://api.netlify.com/api/v1/blobs/${siteId}/${key}`;
  const auth = { Authorization: `Bearer ${token}` };

  // Read
  let current = "";
  const r = await fetch(base, { headers: auth });
  if (r.ok) current = await r.text();
  else if (r.status !== 404) {
    const t = await r.text();
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
      body: `Read failed: ${r.status} ${t}`,
    };
  }

  // Write
  const w = await fetch(base, {
    method: "PUT",
    headers: { ...auth, "content-type": "text/plain; charset=utf-8" },
    body: current + line,
  });

  if (!w.ok) {
    const t = await w.text();
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
      body: `Write failed: ${w.status} ${t}`,
    };
  }

  let id = null;
  try { id = (await w.json()).id || null; } catch {}

  // Use tiny-body so GET beacons succeed on strict browsers
  return {
    statusCode: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
    body: JSON.stringify({ ok: true, id }),
  };
};
