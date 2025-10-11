// functions/_lib/blobs.js
// Fixed to explicitly use environment variables

const { getStore } = require('@netlify/blobs');

// Create the uploads store with explicit credentials
function uploadsStore() {
  return getStore({
    name: 'uploads',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
    consistency: 'strong'
  });
}

// Export wrapper with helper methods
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
  },
  
  async list(options = {}) {
    const store = uploadsStore();
    return await store.list(options);
  }
};

module.exports = {
  uploadsStore: uploadsStoreWrapper
};