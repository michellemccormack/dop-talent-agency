// functions/session-chat.js
// CommonJS — Session memory with Netlify Blobs (prod) + file fallback (local dev)

const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

let blobsStore = null;

// Try Netlify Blobs first. If not configured, fall back to a local file store.
// In production we explicitly pass siteID + token from env so it never 401s.
function getBlobsStoreOrNull() {
  try {
    const { getStore } = require('@netlify/blobs');

    const siteID = process.env.NETLIFY_SITE_ID;           // set in Netlify env
    const token  = process.env.NETLIFY_BLOBS_TOKEN;       // personal access token in Netlify env

    // Prefer automatic injection when available; otherwise pass env explicitly.
    const opts =
      siteID && token
        ? { name: 'sessions', consistency: 'strong', siteID, token }
        : { name: 'sessions', consistency: 'strong' };

    return getStore(opts);
  } catch {
    return null;
  }
}

// Simple file-based store for local dev (no env/tokens)
function createFileStore() {
  const baseDir = path.join(process.cwd(), '.netlify', 'blobs-serve', 'sessions');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return {
    async get(key) {
      const p = path.join(baseDir, `${key}.json`);
      if (!fs.existsSync(p)) return null;
      return fsp.readFile(p, 'utf8');
    },
    async set(key, value) {
      const p = path.join(baseDir, `${key}.json`);
      await fsp.writeFile(p, value, 'utf8');
    }
  };
}

function store() {
  if (!blobsStore) {
    const maybe = getBlobsStoreOrNull();
    blobsStore = maybe || createFileStore();
  }
  return blobsStore;
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  const kv = store();

  // GET → start a new session
  if (event.httpMethod === 'GET') {
    const sessionId = nanoid();
    await kv.set(sessionId, JSON.stringify({ messages: [] }));
    return json(200, { sessionId, messages: [] });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { sessionId: incomingId, message, meta } = payload;
  if (!message || typeof message !== 'string') return json(400, { error: 'Missing "message"' });

  const sessionId = incomingId || nanoid();
  let state = { messages: [] };

  const existing = await kv.get(sessionId);
  if (existing) {
    try { state = JSON.parse(existing); } catch { /* ignore parse error */ }
  }

  // Append user message
  state.messages.push({ role: 'user', content: message, meta: meta || {}, ts: Date.now() });

  // TODO: Plug in your LLM call here and push assistant reply
  // const assistantReply = await callLLM(state.messages);
  // state.messages.push({ role: 'assistant', content: assistantReply, ts: Date.now() });

  await kv.set(sessionId, JSON.stringify(state));

  return json(200, {
    sessionId,
    messages: state.messages.slice(-30)
  });
};
