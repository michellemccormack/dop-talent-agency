// functions/log.js  — Append-only JSONL logger to Netlify Blobs (CommonJS, Node 18+)
const crypto = require("crypto");

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const siteId =
      process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || "";
    const token =
      process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN || "";
    const project = (process.env.PROJECT_NAME || "dopple").toLowerCase();

    if (!siteId || !token) {
      return {
        statusCode: 500,
        body: "Missing NETLIFY_SITE_ID and/or NETLIFY_BLOBS_TOKEN",
      };
    }

    // Parse incoming body (allow empty -> {})
    const body = event.body ? JSON.parse(event.body) : {};

    // Minimal, portable entry schema (extend freely)
    const entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      project,
      llm: body.llm || "unknown",
      session: body.session || null,
      phase: body.phase || null,
      step: body.step || null,
      files: Array.isArray(body.files) ? body.files : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      summary: body.summary || "",
      details: body.details || "",
      raw: body.raw || null,
    };

    // Append to JSONL blob: logs/<project>.jsonl
    const key = `logs/${project}.jsonl`;
    const url = `https://api.netlify.com/api/v1/blobs/${siteId}/${encodeURIComponent(
      key
    )}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/jsonl",
        "x-ntlb-append": "true",
      },
      body: JSON.stringify(entry) + "\n",
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Blobs append failed: ${res.status} ${txt}`);
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, id: entry.id }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      body: `Bad Request: ${err.message}`,
    };
  }
};
