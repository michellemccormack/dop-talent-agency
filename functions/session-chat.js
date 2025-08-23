// functions/session-chat.js
// Task 22: LLM reply wiring (Phase‑1 UI untouched) — v22.0.2 (CommonJS)

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

const VERSION = '22.0.2';
console.info(`[session-chat] boot v${VERSION} — blobs:${!!SITE_ID && !!BLOBS_TOKEN}, model=${DEFAULT_MODEL}`);

const { readFile } = require('fs/promises');
const path = require('path');

// --- utils ---
const nowTs = () => Date.now();

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
function ok(body) {
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ version: VERSION, ...body }),
  };
}
function bad(statusCode, message, extra = {}) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ version: VERSION, error: message, ...extra }),
  };
}

// --- Persona loader (optional) ---
async function loadPersona(personaId) {
  if (!personaId) return null;
  try {
    const personaPath = path.join(__dirname, '..', 'personas', `${personaId}.json`);
    const buf = await readFile(personaPath, 'utf-8');
    return JSON.parse(buf);
  } catch {
    return null; // fall back to generic system prompt
  }
}

// --- Session Storage ---
const MEM_STORE = new Map();
const NS = 'sessions';

async function blobsGet(key) {
  if (!SITE_ID || !BLOBS_TOKEN) return null;
  const url = `https://api.netlify.com/api/v1/sites/${encodeURIComponent(SITE_ID)}/blobs/${encodeURIComponent(NS)}/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${BLOBS_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error('Blobs GET failed', res.status, await res.text());
    return null;
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function blobsSet(key, value) {
  if (!SITE_ID || !BLOBS_TOKEN) return false;
  const url = `https://api.netlify.com/api/v1/sites/${encodeURIComponent(SITE_ID)}/blobs/${encodeURIComponent(NS)}/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${BLOBS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    console.error('Blobs PUT failed', res.status, await res.text());
    return false;
  }
  return true;
}

async function getSession(sessionId) {
  const key = `${sessionId}.json`;
  const fromBlobs = await blobsGet(key);
  if (fromBlobs && fromBlobs.messages) return fromBlobs;

  const mem = MEM_STORE.get(sessionId);
  if (mem) return mem;

  const session = { sessionId, messages: [] };
  MEM_STORE.set(sessionId, session);
  return session;
}

async function saveSession(session) {
  const key = `${session.sessionId}.json`;
  const ok = await blobsSet(key, session);
  if (!ok) MEM_STORE.set(session.sessionId, session);
}

// --- History limiting ---
function buildChatMessagesForLLM({ persona, history }) {
  const MAX_MESSAGES = 14;
  const recent = history.slice(-MAX_MESSAGES);

  const system = (() => {
    if (persona && (persona.system || persona.description || persona.instructions)) {
      const name = persona.name ? `You are ${persona.name}. ` : '';
      const instr = persona.system || persona.instructions || persona.description || '';
      return `${name}${instr}`.trim();
    }
    return 'You are an engaging, concise assistant. Stay in character for the selected persona if provided.';
  })();

  const msgs = [{ role: 'system', content: system }];
  for (const m of recent) {
    if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
      msgs.push({ role: m.role, content: String(m.content ?? '') });
    }
  }
  return msgs;
}

// --- OpenAI call ---
async function llmChat({ messages, model = DEFAULT_MODEL, temperature = 0.7 }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  const json = await res.json();
  const choice = json?.choices?.[0];
  return choice?.message?.content ?? '';
}

// --- Netlify handler (CommonJS export) ---
module.exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders(), body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return bad(405, 'Method Not Allowed');
    }

    const body = JSON.parse(event.body || '{}');
    const sessionId = body.sessionId || body.id || null;
    const userMessage = (body.message ?? '').toString();
    const personaId = body.personaId || body.persona || null;
    const meta = body.meta || {};

    if (!sessionId) return bad(400, 'sessionId is required');
    if (!userMessage) return bad(400, 'message is required');

    const session = await getSession(sessionId);

    session.messages.push({
      role: 'user',
      content: userMessage,
      meta,
      ts: nowTs(),
    });
    await saveSession(session);

    const persona = await loadPersona(personaId);
    const llmMessages = buildChatMessagesForLLM({ persona, history: session.messages });

    let assistantText = '';
    try {
      assistantText = await llmChat({ messages: llmMessages, model: DEFAULT_MODEL, temperature: 0.8 });
    } catch (e) {
      console.error('LLM call failed:', e?.message || e);
      return ok({ sessionId, messages: session.messages, reply: null, error: 'llm_failed' });
    }

    const assistantMsg = {
      role: 'assistant',
      content: assistantText,
      meta: { model: DEFAULT_MODEL, personaId: personaId || null },
      ts: nowTs(),
    };
    session.messages.push(assistantMsg);
    await saveSession(session);

    return ok({ sessionId, messages: session.messages, reply: assistantText });
  } catch (err) {
    console.error('session-chat unhandled error:', err);
    return bad(500, 'Internal error');
  }
};
