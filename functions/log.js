// functions/log.js — Append-only JSONL logger to Netlify Blobs (CommonJS)
const crypto = require("crypto");

exports.handler = async (event) => {
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

    const body = event.body ? JSON.parse(event.body) : {};

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

    // Use a path-like key. IMPORTANT: do NOT encode slashes.
    const key = `logs/${project}.jsonl`;
    const base = `https://api.netlify.com/api/v1/blobs/${siteId}/${key}`;

    // Try to append (PATCH). If 404, create the blob (PUT) then append.
    const line = JSON.stringify(entry) + "\n";

    let res = await fetch(base, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "text/plain",
        "x-ntlb-append": "true",
      },
      body: line,
    });

    if (res.status === 404) {
      // Create the file with first line
      const create = await fetch(base, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "text/plain",
        },
        body: line,
      });
      if (!create.ok) {
        const txt = await create.text();
        throw new Error(`Create failed: ${create.status} ${txt}`);
      }
      // Success on first write
      return ok(entry.id);
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Append failed: ${res.status} ${txt}`);
    }

    return ok(entry.id);
  } catch (err) {
    return { statusCode: 400, body: `Bad Request: ${err.message}` };
  }
};

function ok(id) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, id }),
  };
}
