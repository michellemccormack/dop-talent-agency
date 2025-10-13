// functions/log_view.js — read & parse JSONL log from Netlify Blobs (CommonJS)
exports.handler = async (event) => {
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

    const key = `logs/${project}.jsonl`;
    const base = `https://api.netlify.com/api/v1/blobs/${siteId}/${key}`;
    const auth = { Authorization: `Bearer ${token}` };

    // Optional query params
    const url = new URL(event.rawUrl || "http://x");
    const limit = Math.max(
      1,
      Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 2000)
    );
    const format = (url.searchParams.get("format") || "json").toLowerCase();

    // GET blob text (404 => empty)
    let text = "";
    const getRes = await fetch(base, { headers: auth });
    if (getRes.ok) {
      text = await getRes.text();
    } else if (getRes.status !== 404) {
      const t = await getRes.text();
      return { statusCode: 500, body: `Read failed: ${getRes.status} ${t}` };
    }

    // Raw download option
    if (format === "raw") {
      return {
        statusCode: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
        body: text,
      };
    }

    // Parse JSONL → array of entries
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const parsed = [];
    for (const l of lines) {
      try {
        parsed.push(JSON.parse(l));
      } catch (_) {}
    }

    // Sort by timestamp ascending, then take the tail limited
    parsed.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    const tail = parsed.slice(-limit);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ project, count: tail.length, items: tail }),
    };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
