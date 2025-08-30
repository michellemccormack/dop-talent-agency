// functions/stream-chat.js
// Phase 2.5 — Task 24a (SSE, Netlify-native) with Blobs compatibility
// Streams GPT tokens via SSE and saves turns to a "sessions" store.
// Works with either @netlify/blobs getMap() (new) or getStore() (older).

const path = require("path");
const fs = require("fs/promises");
const blobsPkg = require("@netlify/blobs");
const { stream } = require("@netlify/functions");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL =
  process.env.OPENAI_CHAT_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini-2024-07-18";

const MAX_HISTORY_MESSAGES = 20;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function sseLine(event, payload) {
  let out = "";
  if (event) out += `event: ${event}\n`;
  out += `data: ${JSON.stringify(payload)}\n\n`;
  return out;
}

function trimHistory(messages, max = MAX_HISTORY_MESSAGES) {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= max) return messages;
  return messages.slice(messages.length - max);
}

async function loadPersona(requestedName) {
  const personasDir = path.join(__dirname, "..", "personas");
  const safe =
    (requestedName || "sasha")
      .toString()
      .replace(/[^a-z0-9_\-\.]/gi, "")
      .replace(/\.json$/i, "") + ".json";

  try {
    const raw = await fs.readFile(path.join(personasDir, safe), "utf8");
    const persona = JSON.parse(raw);
    persona.__file = safe;
    persona.name = persona.name || safe.replace(/\.json$/i, "");
    persona.displayName = persona.displayName || persona.title || persona.name;
    return persona;
  } catch (_) {}

  try {
    const files = await fs.readdir(personasDir);
    const any = files.find((f) => f.toLowerCase().endsWith(".json"));
    if (any) {
      const raw = await fs.readFile(path.join(personasDir, any), "utf8");
      const persona = JSON.parse(raw);
      persona.__file = any;
      persona.name = persona.name || any.replace(/\.json$/i, "");
      persona.displayName = persona.displayName || persona.title || persona.name;
      return persona;
    }
  } catch (_) {}

  return {
    name: "default",
    displayName: "Assistant",
    system:
      "You are a helpful, concise, friendly assistant. Keep replies tight and conversational.",
  };
}

function buildMessages(persona, history) {
  const sys =
    persona.system ||
    persona.instructions ||
    persona.prompt ||
    `You are ${persona.displayName || "an assistant"}. Reply concisely.`;

  const systemMsg = { role: "system", content: sys };
  const safeHistory = Array.isArray(history) ? history : [];
  return [systemMsg, ...safeHistory.map(({ role, content }) => ({ role, content }))];
}

function parseInput(event) {
  const method = (event.httpMethod || "").toUpperCase();
  let sessionId, message, persona;

  if (method === "GET") {
    const qs = event.queryStringParameters || {};
    sessionId = qs.sessionId || qs.sid || "";
    message = qs.message || qs.q || "";
    persona = qs.persona || qs.p || "";
  } else if (method === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      sessionId = body.sessionId || body.sid || "";
      message = body.message || body.q || "";
      persona = body.persona || body.p || "";
    } catch (_) {}
  }

  return { sessionId, message, persona };
}

/** Get a sessions store compatible with both Blobs APIs */
function getSessionsStore() {
  // Newer API
  if (typeof blobsPkg.getMap === "function") {
    const map = blobsPkg.getMap({ name: "sessions" });
    return {
      async get(id) {
        return map.get(id, { type: "json" });
      },
      async set(id, val) {
        return map.set(id, val);
      },
    };
  }
  // Older API
  if (typeof blobsPkg.getStore === "function") {
    const store = blobsPkg.getStore({ name: "sessions" });
    return {
      async get(id) {
        const text = await store.get(id);
        return text ? JSON.parse(text) : null;
      },
      async set(id, val) {
        return store.set(id, JSON.stringify(val), {
          contentType: "application/json",
        });
      },
    };
  }
  // Very old/no API available – fall back to ephemeral (no persistence between invocations)
  const mem = new Map();
  return {
    async get(id) {
      return mem.get(id) || null;
    },
    async set(id, val) {
      mem.set(id, val);
    },
  };
}

exports.handler = stream(async (event, context, res) => {
  // CORS preflight
  if ((event.httpMethod || "").toUpperCase() === "OPTIONS") {
    res.writeHead(204, { ...corsHeaders(event.headers?.origin) });
    return res.end();
  }

  // SSE headers
  res.writeHead(200, {
    ...corsHeaders(event.headers?.origin),
    "Content-Type": "text/event-stream; charset=utf-8",
  });

  const send = (eventName, payload) => {
    try {
      res.write(sseLine(eventName, payload));
    } catch (_) {
      // ignore broken pipe
    }
  };

  const { sessionId, message, persona: personaName } = parseInput(event);

  if (!OPENAI_API_KEY) {
    send("error", { error: "Missing OPENAI_API_KEY" });
    return res.end();
  }
  if (!sessionId || !message) {
    send("error", { error: "Missing required fields: sessionId and message" });
    return res.end();
  }

  // Sessions store (compat)
  const sessions = getSessionsStore();

  // Load or init session
  let session = (await sessions.get(sessionId).catch(() => null)) || null;
  if (!session) {
    session = {
      id: sessionId,
      messages: [],
      persona: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const persona = await loadPersona(session.persona || personaName || "sasha");
  session.persona = persona.name;
  session.updatedAt = Date.now();

  // Append user message (pre-save)
  session.messages = trimHistory(
    [...(session.messages || []), { role: "user", content: message, ts: Date.now() }],
    MAX_HISTORY_MESSAGES
  );
  await sessions.set(sessionId, session).catch(() => {});

  // Announce open + heartbeat
  send("open", { ok: true, model: DEFAULT_MODEL, persona: session.persona, sessionId });
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch (_) {}
  }, 15000);

  let fullText = "";

  // OpenAI request
  const messages = buildMessages(persona, session.messages);
  const body = {
    model: DEFAULT_MODEL,
    stream: true,
    messages,
    temperature: 0.7,
  };

  let openaiResp;
  try {
    openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearInterval(ping);
    send("error", { error: String(err || "fetch failed") });
    return res.end();
  }

  if (!openaiResp.ok || !openaiResp.body) {
    clearInterval(ping);
    send("error", {
      error: "OpenAI request failed",
      status: openaiResp.status,
      statusText: openaiResp.statusText,
    });
    return res.end();
  }

  // Stream parse OpenAI SSE and forward tokens
  const reader = openaiResp.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta || {};
          const piece = delta?.content || "";
          if (piece) {
            fullText += piece;
            send("token", { content: piece });
          }
        } catch {
          send("meta", { raw: data });
        }
      }
    }
  } catch (err) {
    send("error", { error: String(err) });
  } finally {
    clearInterval(ping);
  }

  // Persist assistant turn & close
  try {
    session.messages = trimHistory(
      [...(session.messages || []), { role: "assistant", content: fullText, ts: Date.now() }],
      MAX_HISTORY_MESSAGES
    );
    session.updatedAt = Date.now();
    await sessions.set(sessionId, session);
  } catch (_) {}

  send("done", { bytes: Buffer.byteLength(fullText, "utf8"), chars: fullText.length });
  return res.end();
});
