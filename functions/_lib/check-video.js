// functions/check-video.js
// GET  /.netlify/functions/check-video?recordId=recXXXX&prompt=1
// → { status: "processing" } or { status:"ready", url:"..." }

const { airtable } = require("./_lib/airtable");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS")
      return { statusCode: 204, headers: cors(), body: "" };

    const { recordId, prompt } = event.queryStringParameters || {};
    if (!recordId || !prompt) {
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({ error: "recordId and prompt are required" }),
      };
    }

    const p = String(prompt).trim(); // "1" | "2" | "3"
    const vidField = `prompt${p}_video_id`;
    const urlField = `prompt${p}_url`;

    // Load record
    const rec = await airtable.get(recordId);
    const video_id = rec?.fields?.[vidField];
    if (!video_id) {
      return {
        statusCode: 404,
        headers: cors(),
        body: JSON.stringify({ error: "video_id not found for this prompt" }),
      };
    }

    // Check status via your existing proxy
    const res = await fetch(
      `/.netlify/functions/heygen-proxy?action=check_video&video_id=${encodeURIComponent(
        video_id
      )}`
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: cors(),
        body: JSON.stringify({ error: "heygen check failed", details: data }),
      };
    }

    if (data.status === "completed" && data.video_url) {
      // Write URL back to Airtable & possibly mark ready
      await airtable.update(recordId, {
        [urlField]: data.video_url,
      });

      // If all three URLs are present, flip status to ready
      const fresh = await airtable.get(recordId);
      const f = fresh.fields || {};
      const all =
        f.prompt1_url && f.prompt2_url && f.prompt3_url ? "ready" : "processing";
      if (all === "ready" && f.status !== "ready") {
        await airtable.update(recordId, { status: "ready" });
      }

      return {
        statusCode: 200,
        headers: cors(),
        body: JSON.stringify({ status: "ready", url: data.video_url }),
      };
    }

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ status: "processing" }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: String(e?.message || e) }),
    };
  }
};
