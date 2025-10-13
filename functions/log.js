// functions/log.js — JSONL logger to Netlify Blobs (CommonJS, CORS enabled)
exports.handler = async (event) => {
  // --- CORS preflight ---
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
      body: "",
    };
  }

  // --- Only POST allowed ---
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "text/plain; charset=utf-8",
      },
      body: "Method Not Allowed",
    };
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
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "text/plain; charset=utf-8",
        },
        body: "Missing NETLIFY_SITE_ID and/or NETLIFY_BLOBS_TOKEN",
      };
    }

    // Parse body
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "text/plain; charset=utf-8",
        },
        body: "Bad Request: invalid JSON",
      };
    }

    // Enrich entry and serialize as JSONL line
    const entry = {
      ts: new Date().toISOString(),
      project,
      ...body,
    };
    const line = JSON.stringify(entry) + "\n";

    // Blobs REST
    const key = `logs/${project}.jsonl`;
    const base = `https://api.netlify.com/api/v1/blobs/${siteId}/${key}`;
    const auth = { Authorization: `Bearer ${token}` };

    // GET current (404 → empty), then PUT concatenated (browser-safe; PATCH append isn’t allowed cross-origin)
    let current = "";
    const getRes = await fetch(base, { headers: auth });
    if (getRes.ok) {
      current = await getRes.text();
    } else if (getRes.status !== 404) {
      const t = await getRes.text();
      return {
        statusCode: 502,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "text/plain; charset=utf-8",
        },
        body: `Read failed: ${getRes.status} ${t}`,
      };
    }

    const putRes = await fetch(base, {
      method: "PUT",
      headers: {
        ...auth,
        "content-type": "text/plain; charset=utf-8",
      },
      body: current + line,
    });

    if (!putRes.ok) {
      const t = await putRes.text();
      return {
        statusCode: 502,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "text/plain; charset=utf-8",
        },
        body: `Write failed: ${putRes.status} ${t}`,
      };
    }

    const id = (await putRes.json()).id || null;

    return {
      statusCode: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "text/plain; charset=utf-8",
      },
      body: `Error: ${err.message}`,
    };
  }
};
