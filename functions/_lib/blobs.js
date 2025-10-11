// functions/_lib/blobs.js
// Robust Netlify Blobs helper — supports NETLIFY_* or BLOBS_* env vars.
// Exports both the FUNCTION `uploadsStore()` and a small helper wrapper.

const { getStore } = require('@netlify/blobs');

// Resolve env with sensible fallbacks + clear diagnostics
function resolveEnv() {
  const siteID =
    process.env.NETLIFY_SITE_ID ||
    process.env.BLOBS_SITE_ID ||
    '';

  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.BLOBS_TOKEN ||
    '';

  if (!siteID || !token) {
    const msgs = [];
    if (!siteID) msgs.push('NETLIFY_SITE_ID or BLOBS_SITE_ID');
    if (!token)  msgs.push('NETLIFY_BLOBS_TOKEN or BLOBS_TOKEN');
    console.error('[blobs] Missing env:', msgs.join(', '));
  }
  return { siteID, token };
}

// Create the uploads store (callable function)
function uploadsStore() {
  const { siteID, token } = resolveEnv();
  return getStore({
    name: 'uploads',
    siteID,
    token,
    consistency: 'strong',
  });
}

// Convenience helpers (optional)
const uploadsStoreWrapper = {
  async setBlob(key, data) {
    const store = uploadsStore();
    await store.set(key, data);
    console.log(`[blobs] Stored: ${key}`);
  },

  async getBlob(key) {
    const store = uploadsStore();
    const data = await store.get(key, { type: 'text' });
    console.log(`[blobs] Retrieved ${key}: ${data ? 'found' : 'not found'}`);
    return data;
  },

  async deleteBlob(key) {
    const store = uploadsStore();
    await store.delete(key);
    console.log(`[blobs] Deleted: ${key}`);
  },

  async list(options = {}) {
    const store = uploadsStore();
    return store.list(options);
  },
};

module.exports = {
  uploadsStore,          // function — callers use uploadsStore()
  uploads: uploadsStoreWrapper,
};
