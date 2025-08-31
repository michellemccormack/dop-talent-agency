// functions/dop-upload.js
// Saves photo + voice to Netlify Blobs under a generated `dopId`.
// Returns { dopId } and stores minimal metadata.
// CommonJS; Node 18; add-only. No changes to existing voice/video flows.

const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function bad(status, msg) {
  return { statusCode: status, headers: cors(), body: JSON.stringify({ error: msg }) };
}

// Infer a file extension from a MIME type (basic).
function extFromMime(mime, fallback) {
  if (!mime) return fallback || "bin";
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
  };
  return map[mime] || fallback || "bin";
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors(), body: "" };
    }
    if (event.httpMethod !== "POST") {
      return bad(405, "Method Not Allowed");
    }

    if (!event.body) return bad(400, "Missing request body");
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return bad(400, "Body must be JSON");
    }

    const {
      imageBase64,
      imageType,
      imageName,
      audioBase64,
      audioType,
      audioName,
    } = payload || {};

    if (!imageBase64 || !audioBase64) {
      return bad(400, "Provide imageBase64 and audioBase64");
    }

    // Basic size guards (base64 grows ~33%); we cap raw bytes at ~6MB/8MB.
    const imgBytes = Buffer.byteLength(imageBase64, "base64");
    const audBytes = Buffer.byteLength(audioBase64, "base64");
    if (imgBytes > 6 * 1024 * 1024) return bad(413, "Image too large (max ~6MB)");
    if (audBytes > 8 * 1024 * 1024) return bad(413, "Audio too large (max ~8MB)");

    const dopId = crypto.randomUUID();

    // Use a single site-scoped store. No env needed on Netlify.
    const store = getStore("dop-uploads");

    const imgExt = extFromMime(imageType, "jpg");
    const audExt = extFromMime(audioType, "webm");

    const imgKey = `dop/${dopId}/image.${imgExt}`;
    const audKey = `dop/${dopId}/voice.${audExt}`;
    const metaKey = `dop/${dopId}/meta.json`;

    // Save binary blobs
    await store.set(imgKey, Buffer.from(imageBase64, "base64"), {
      contentType: imageType || "application/octet-stream",
    });
    await store.set(audKey, Buffer.from(audioBase64, "base64"), {
      contentType: audioType || "application/octet-stream",
    });

    // Minimal metadata
    const now = new Date().toISOString();
    const meta = {
      dopId,
      createdAt: now,
      image: { key: imgKey, type: imageType || null, name: imageName || null, size: imgBytes },
      audio: { key: audKey, type: audioType || null, name: audioName || null, size: audBytes },
      // Add more later (tier, user, persona, etc.)
    };
    await store.set(metaKey, JSON.stringify(meta, null, 2), {
      contentType: "application/json",
    });

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ dopId, metaKey }),
    };
  } catch (err) {
    return bad(500, err.message || "Unexpected error");
  }
};
