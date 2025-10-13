// functions/log.js — Append JSONL using GET→PUT (portable + reliable)
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

    const key = `logs/${project}.jsonl`;
    const base = `https://api.netlify.com/api/v1/blobs/${siteId}/${key}`;
    const auth = { Authorization: `Bearer ${token}` };

    // 1) GET existing blob (ok → text; 404 → empty)
    let existing = "";
    const getRes = await fetch(base, { headers: auth });
    if (getRes.ok) {
      existing = await getRes.text();
    } else if (getRes.status !== 404) {
      const txt = await getRes.text();
      throw new Error(`Read failed: ${getRes.status} ${txt}`);
    }

    // 2) Append the new line and PUT full content back
    const line = JSON.stringify(entry) + "\n";
    const putRes = await fetch(base, {
      method: "PUT",
      headers: { ...auth, "content-type": "text/plain" },
      body: existing + line,
    });

    if (!putRes.ok) {
      const txt = await putRes.text();
      throw new Error(`Write failed: ${putRes.status} ${txt}`);
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, id: entry.id }),
    };
  } catch (err) {
    return { statusCode: 400, body: `Bad Request: ${err.message}` };
  }
};
