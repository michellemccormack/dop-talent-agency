// functions/_lib/blobs.js
// Complete blob storage implementation for Netlify

const { getStore } = require('@netlify/blobs');

// Create the uploads store
function uploadsStore() {
  return getStore({
    name: 'uploads',
    consistency: 'strong'
  });
}

// Export wrapper with setBlob method
const uploadsStoreWrapper = {
  async setBlob(key, data) {
    const store = uploadsStore();
    await store.set(key, data);
    console.log(`[blobs] Stored: ${key}`);
  },
  
  async getBlob(key) {
    const store = uploadsStore();
    return await store.get(key);
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
