// functions/session-chat.js
// Task 22: LLM reply wiring (Non‑regressive; Phase‑1 UI untouched)
//
// What this does:
// 1) Accepts { sessionId, message, personaId?, meta? } via POST
// 2) Loads existing session history from Netlify Blobs (fallback: memory for local dev)
// 3) Appends the new user message
// 4) Calls OpenAI with persona + recent session messages
// 5) Appends assistant reply to the same session
// 6) Returns { sessionId, messages, reply }
//
// Config:
// - OPENAI_API_KEY (required)
// - OPENAI_MODEL (optional, defaults to 'gpt-4o-mini')
// - NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN (recommended for persistent sessions)
// - Personas: personas/<personaId>.json (optional). Include in netlify.toml `included_files`.
//
// Notes:
// - CORS headers are included for same-origin browser calls.
// - Storage gracefully falls back to ephemeral memory if Blobs aren’t available (local dev).
// - This file intentionally does not touch Phase‑1 frontend behavior.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

// --- Lightweight utils ---
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
    body: JSON.stringify(body),
  };
}

function bad(statusCode, message, extra = {}) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message, ...extra }),
  };
}

// --- Persona loader (optional) ---
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadPersona(personaId) {
  if (!personaId) return null;
  try {
    const personaPath = path.resolve(__dirname, '..', 'personas', `${personaId}.json`);
    const buf = await readFile(personaPath, 'utf-8');
    return JSON.parse(buf);
  } catch {
    // Not fatal; just fall back to generic system prompt.
    return null;
  }
}

// --- Session Storage ---
// Primary: Netlify Blobs via REST (requires SITE_ID + BLOBS_TOKEN)
// Fallback: in-memory Map (for local dev). Not for production durability.
const MEM_STORE = new Map();
const NS = 'sessions'; // namespace within Blobs

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
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  // Try Blobs first
  const key = `${sessionId}.json`;
  const fromBlobs = await blobsGet(key);
  if (fromBlobs && fromBlobs.messages) return fromBlobs;

  // Fallback: memory (handy for local)
  const mem = MEM_STORE.get(sessionId);
  if (mem) return mem;

  // Initialize new session
  const session = { sessionId, messages: [] };
  MEM_STORE.set(sessionId, session);
  return session;
}

async function saveSession(session) {
  const key = `${session.sessionId}.json`;
  const okBlobs = await blobsSet(key, session);
  if (!okBlobs) {
    // Keep memory copy as last resort
    MEM_STORE.set(session.sessionId, session);
  }
}

// --- History limiting (avoid overlong prompts) ---
function buildChatMessagesForLLM({ persona, history }) {
  // Keep last N turns for brevity
  const MAX_MESSAGES = 14; // (user+assistant pairs) ~ cautious default
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

// --- OpenAI call (chat.completions) ---
async function llmChat({ messages, model = DEFAULT_MODEL, temperature = 0.7 }) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  const json = await res.json();
  const choice = json?.choices?.[0];
  return choice?.message?.content ?? '';
}

// --- Netlify handler ---
export async function handler(event) {
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

    // 1) Load session
    const session = await getSession(sessionId);

    // 2) Append user message & persist (Task 21 behavior preserved)
    session.messages.push({
      role: 'user',
      content: userMessage,
      meta,
      ts: nowTs(),
    });
    await saveSession(session);

    // 3) Load persona (optional)
    const persona = await loadPersona(personaId);

    // 4) Build context and call LLM
    const llmMessages = buildChatMessagesForLLM({
      persona,
      history: session.messages,
    });

    let assistantText = '';
    try {
      assistantText = await llmChat({ messages: llmMessages, model: DEFAULT_MODEL, temperature: 0.8 });
    } catch (e) {
      console.error('LLM call failed:', e?.message || e);
      // We still return the user message history; frontend can handle error
      return ok({
        sessionId,
        messages: session.messages,
        reply: null,
        error: 'llm_failed',
      });
    }

    // 5) Append assistant reply & persist
    const assistantMsg = {
      role: 'assistant',
      content: assistantText,
      meta: { model: DEFAULT_MODEL, personaId: personaId || null },
      ts: nowTs(),
    };
    session.messages.push(assistantMsg);
    await saveSession(session);

    // 6) Return updated session + reply
    return ok({
      sessionId,
      messages: session.messages,
      reply: assistantText,
    });
  } catch (err) {
    console.error('session-chat unhandled error:', err);
    return bad(500, 'Internal error');
  }
}
