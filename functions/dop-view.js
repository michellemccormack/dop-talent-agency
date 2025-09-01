// functions/dop-view.js
// Renders a simple viewer for /dop/:dopId by reading files from Netlify Blobs.

const { getStore } = require('@netlify/blobs');

// infer MIME from extension
function mimeFromKey(key = "") {
  const ext = (key.split(".").pop() || "").toLowerCase();
  if (["png"].includes(ext)) return "image/png";
  if (["jpg","jpeg"].includes(ext)) return "image/jpeg";
  if (["webp"].includes(ext)) return "image/webp";
  if (["gif"].includes(ext)) return "image/gif";
  if (["mp3","mpeg"].includes(ext)) return "audio/mpeg";
  if (["wav"].includes(ext)) return "audio/wav";
  if (["webm"].includes(ext)) return "audio/webm";
  if (["m4a","mp4"].includes(ext)) return "audio/mp4";
  return "application/octet-stream";
}

exports.handler = async (event) => {
  try {
    // Accept id from query (?id=) or redirect param
    const qs = event.queryStringParameters || {};
    const dopId = qs.id || qs.dopId;
    if (!dopId) {
      return { statusCode: 400, body: "Missing dopId" };
    }

    // Use your env vars already configured in Netlify
    const siteId = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_BLOBS_TOKEN;
    if (!siteId || !token) {
      return { statusCode: 500, body: "Blobs credentials missing (NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN)" };
    }

    const store = getStore({ name: "dop-uploads", siteId, token });

    // Find the first image and first voice under this dopId
    const imgList   = await store.list({ prefix: `images/${dopId}/` });
    const voiceList = await store.list({ prefix: `voices/${dopId}/` });
    const imgKey    = imgList?.blobs?.[0]?.key;
    const voiceKey  = voiceList?.blobs?.[0]?.key;

    // Pull bytes and embed as data URLs (keeps this demo simple/public)
    let imgDataUrl = "", voiceDataUrl = "";
    if (imgKey) {
      const imgBuf  = await store.get(imgKey, { type: "buffer" });
      const imgMime = mimeFromKey(imgKey);
      imgDataUrl = `data:${imgMime};base64,${Buffer.from(imgBuf).toString("base64")}`;
    }
    if (voiceKey) {
      const vBuf  = await store.get(voiceKey, { type: "buffer" });
      const vMime = mimeFromKey(voiceKey);
      voiceDataUrl = `data:${vMime};base64,${Buffer.from(vBuf).toString("base64")}`;
    }

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DOP ${dopId}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}
  .wrap{max-width:720px;margin:0 auto}
  img{max-width:100%;height:auto;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.08)}
  .box{border:1px solid #eee;border-radius:12px;padding:16px;margin-top:16px}
  code{background:#f4f4f4;padding:2px 6px;border-radius:6px}
  a{color:#111}
</style>
</head>
<body>
  <div class="wrap">
    <h1>DOP <code>${dopId}</code></h1>

    ${imgDataUrl ? `<div class="box"><img src="${imgDataUrl}" alt="Photo for ${dopId}"/></div>` : `<p class="box">No image found.</p>`}

    ${voiceDataUrl ? `<div class="box"><audio controls src="${voiceDataUrl}"></audio></div>` : `<p class="box">No voice sample found.</p>`}

    <p class="box"><a href="/admin.html">← Admin</a></p>
  </div>
</body>
</html>`;

    return { statusCode: 200, headers: { "content-type": "text/html" }, body: html };
  } catch (err) {
    return { statusCode: 500, body: String(err && err.message || err) };
  }
};
