// functions/_blobs.js
const { getStore } = require('@netlify/blobs');

function uploadsStore() {
  const siteId =
    process.env.NETLIFY_SITE_ID ||
    process.env.BLOBS_SITE_ID;

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.BLOBS_TOKEN;

  if (!siteId || !token) {
    throw new Error('Missing NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN (or BLOBS_* fallbacks).');
  }

  // Pass both capitalizations to be safe across lib versions.
  return getStore({ name: 'dop-uploads', siteId, siteID: siteId, token });
}

module.exports = { uploadsStore };
