// Netlify Function: save photo + voice to Netlify Blobs under a generated dopId.
// Runtime: Node 18+, CommonJS (matches your repo). No voice behavior touched.

const { getStore } = require("@netlify/blobs");
const { randomUUID } = require("crypto");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ error: "POST only" }),
    };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  const { imageBase64, imageType, audioBase64, audioType } = body;
  if (!imageBase64 || !audioBase64 || !imageType || !audioType) {
    return {
      statusCode: 400,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({
        error: "Missing fields. Required: imageBase64, imageType, audioBase64, audioType",
      }),
    };
  }

  try {
    const dopId = randomUUID();
    const store = getStore("dopples"); // store name for all DOP assets

    const imageKey = `dop/${dopId}/image`;
    const audioKey = `dop/${dopId}/audio`;
    const metaKey  = `dop/${dopId}/meta.json`;

    // Save binaries
    await store.set(imageKey, Buffer.from(imageBase64, "base64"), {
      dataType: "binary",
      contentType: imageType,
    });
    await store.set(audioKey, Buffer.from(audioBase64, "base64"), {
      dataType: "binary",
      contentType: audioType,
    });

    // Save minimal metadata
    const createdAt = new Date().toISOString();
    const meta = {
      dopId,
      createdAt,
      image: { key: imageKey, contentType: imageType },
      audio: { key: audioKey, contentType: audioType },
      // Public URLs will be attached when we add the /dop/:dopId viewer.
    };
    await store.setJSON(metaKey, meta);

    return {
      statusCode: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ dopId }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ error: "Server error saving files." }),
    };
  }
};
