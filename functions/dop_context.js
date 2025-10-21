// functions/dop_context.js
// Netlify Function: returns a compact "Project Capsule" built from the tail of your JSONL blob log.
// Runtime: Netlify Functions (Node 18+, CommonJS)
// Env required: NETLIFY_BLOBS_TOKEN (aka BLOBS_TOKEN), NETLIFY_SITE_ID (or BLOBS_SITE_ID)
// Route: /.netlify/functions/dop_context?n=30&session=dopple

const https = require("https");

const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
const SITE_ID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
const BUCKET = "dop-logs";
const KEY = "logs/dopple.jsonl"; // you can change "dopple" to another project name if you ever need multiple

// --- simple HTTPS GET wrapper
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        reject(new Error(`GET ${url} -> ${res.statusCode}: ${data}`));
      });
    });
    req.on("error", reject);
  });
}

// Tail the blob (we'll request the whole file once; logs are small day-to-day; adjust if needed)
async function fetchLogText() {
  if (!BLOB_TOKEN || !SITE_ID) throw new Error("Missing NETLIFY_BLOBS_TOKEN or NETLIFY_SITE_ID");
  const url = `https://api.netlify.com/api/v1/sites/${SITE_ID}/blobs/bucket/${encodeURIComponent(
    BUCKET
  )}/${encodeURIComponent(KEY)}?ts=${Date.now()}`;

  const txt = await httpGet(url, {
    Authorization: `Bearer ${BLOB_TOKEN}`,
    Accept: "text/plain",
  });
  return txt || "";
}

function parseLastN(jsonl, n, sessionFilter) {
  const lines = jsonl.trim().split(/\r?\n/).filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (sessionFilter && obj.session && obj.session !== sessionFilter) continue;
      out.push(obj);
    } catch (_) {}
  }
  return out.reverse();
}

function summarize(rows) {
  // Collapse to a capsule the LLM can consume quickly
  const recent = rows.slice(-10).map((r) => {
    const t = Array.isArray(r.tags) ? r.tags.join(",") : "";
    return `- [${r.step || "step"}] ${r.summary || "(no summary)"}${t ? `  #${t}` : ""}`;
  });

  const last = rows[rows.length - 1] || {};
  const nextHint = last.next || ""; // if you ever log "next" hints

  return (
`PROJECT: Dopple Talent Agency — DOP

GOAL: Users upload photo + voice + 5 bio facts → HeyGen avatar + ElevenLabs voice → shareable DOP URL (tiered pricing). Keep voice baseline. Netlify Functions (Node 18+, CJS); single index.html.

STACK: Netlify Functions, OpenAI (LLM), ElevenLabs (voice), HeyGen (avatar). Env: OPENAI_API_KEY, ELEVENLABS_API_KEY, HEYGEN_API_KEY, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN.

CURRENT STEP: ${last.phase || "MVP"} / ${last.step || "unknown"}

RECENT WORK (latest 10):
${recent.join("\n") || "- (no recent rows)"}

NEXT ACTION (hint): ${nextHint || "Continue the next subtask of Step 27 (HeyGen avatar creation flow in-app)."}

RULES:
- One step at a time, mapping to roadmap.
- Return FULL FILES for any code change (no snippets).
- Add-only unless I explicitly approve deletions.
- Include exact file paths + env vars if needed.
`
  );
}

exports.handler = async (event) => {
  try {
    const n = Math.min(parseInt(event.queryStringParameters?.n || "30", 10) || 30, 200);
    const session = event.queryStringParameters?.session || "dopple";

    const text = await fetchLogText();
    if (!text) {
      return {
        statusCode: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: "No logs yet.\n",
      };
    }

    const rows = parseLastN(text, n, session);
    const capsule = summarize(rows);
    return {
      statusCode: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: capsule,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: `dop_context error: ${err.message}`,
    };
  }
};
