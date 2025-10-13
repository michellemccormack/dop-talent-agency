// functions/_lib/blobs.js
// Netlify Blobs helper: supports NETLIFY_* or BLOBS_* env vars.
// IMPORTANT: Store name is 'dop-uploads' to match all other functions

const { getStore } = require('@netlify/blobs');

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
    const missing = [];
    if (!siteID) missing.push('NETLIFY_SITE_ID or BLOBS_SITE_ID');
    if (!token)  missing.push('NETLIFY_BLOBS_TOKEN or BLOBS_TOKEN');
    console.error('[blobs] Missing env:', missing.join(', '));
  }
  return { siteID, token };
}

// Primary callable that returns a real store
function uploadsStore() {
  const { siteID, token } = resolveEnv();
  return getStore({
    name: 'dop-uploads',  // CHANGED: was 'uploads', now 'dop-uploads'
    siteID,
    token,
    consistency: 'strong',
  });
}

// Attach convenience methods directly to uploadsStore (back-compat)
uploadsStore.setBlob = async (key, data) => {
  const store = uploadsStore();
  await store.set(key, data);
  console.log('[blobs] Stored: ' + key);
};

uploadsStore.getBlob = async (key, opts) => {
  opts = opts || { type: 'text' };
  const store = uploadsStore();
  const data = await store.get(key, opts);
  console.log('[blobs] Retrieved ' + key + ': ' + (data ? 'found' : 'not found'));
  return data;
};

uploadsStore.deleteBlob = async (key) => {
  const store = uploadsStore();
  await store.delete(key);
  console.log('[blobs] Deleted: ' + key);
};

uploadsStore.list = async (options) => {
  options = options || {};
  const store = uploadsStore();
  return store.list(options);
};

// Optional separate wrapper export (if other files import { uploads }):
const uploads = {
  setBlob: uploadsStore.setBlob,
  getBlob: uploadsStore.getBlob,
  deleteBlob: uploadsStore.deleteBlob,
  list: uploadsStore.list,
};

module.exports = { uploadsStore, uploads };
