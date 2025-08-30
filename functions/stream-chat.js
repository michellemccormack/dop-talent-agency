// functions/stream-chat.js
// Phase 2.5 — Task 24a (Step 1)
// CommonJS Netlify Function that streams GPT tokens via SSE (with WS detection -> SSE fallback)
// - Accepts { sessionId, message, persona? } via POST JSON or query params
// - Streams tokens as Server-Sent Events (text/event-stream)
// - Appends final assistant message to the same session store used by session-chat.js (Netlify Blobs Map: "sessions")
// - Includes CORS + heartbeat keep-alive
// - Loads persona from /personas (defaults to sasha.json, or first available)

const path = require("path");
const fs = require("fs/promises");
const { getMap } = require("@netlify/blobs");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL =
  process.env.OPENAI_CHAT_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini-2024-07-18"; // keep lightweight + streaming
const MAX_HISTORY_MESSAGES = 20; // ~ last 10 turns (~20 role messages)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Basic CORS headers (SSE-safe) */
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering
  };
}

/** Format SSE event */
function sse(event, data) {
  let out = "";
  if (event) out += `event: ${event}\n`;
  // data must be a single line; JSON-stringify ensures no newlines
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}

/** Trim history to last N messages */
function trimHistory(messages, max = MAX_HISTORY_MESSAGES) {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= max) return messages;
  return messages.slice(messages.length - max);
}

/** Load a persona JSON from /personas, with sensible fallbacks */
async function loadPersona(requestedName) {
  const personasDir = path.join(__dirname, "..", "personas");

  // sanitize + normalize
  const base =
    (requestedName || "sasha")
      .toString()
      .replace(/[^a-z0-9_\-\.]/gi, "")
      .replace(/\.json$/i, "") + ".json";

  // try requested
  try {
    const reqPath = path.join(personasDir, base);
    const raw = await fs.readFile(reqPath, "utf8");
    const persona = JSON.parse(raw);
    persona.__file = base;
    persona.name = persona.name || base.replace(/\.json$/i, "");
    persona.displayName = persona.displayName || persona.title || persona.name;
    return persona;
  } catch (_) {
    // ignore and try first available persona
  }

  // fallback: first .json in /personas
  try {
    const files = await fs.readdir(personasDir);
    const candidate = files.find((f) => f.toLowerCase().endsWith(".json"));
    if (candidate) {
      const raw = await fs.readFile(path.join(personasDir, candidate), "utf8");
      const persona = JSON.parse(raw);
      persona.__file = candidate;
      persona.name = persona.name || candidate.replace(/\.json$/i, "");
      persona.displayName = persona.displayName || persona.title || persona.name;
      return persona;
    }
  } catch (_) {
    // ignore
  }

  // ultimate fallback
  return {
    name: "default",
    displayName: "Assistant",
    system:
      "You are a helpful, concise, and friendly assistant. Keep replies tight and conversational.",
  };
}

/** Build OpenAI chat messages with persona/system + history */
function buildOpenAIMessages(persona, history) {
  const sys =
    persona.system ||
    persona.instructions ||
    persona.prompt ||
    `You are ${persona.displayName || "an assistant"}. Reply concisely.`;

  const systemMsg = { role: "system", content: sys };
  const safeHistory = Array.isArray(history) ? history : [];

  return [systemMsg, ...safeHistory.map(({ role, content }) => ({ role, content }))];
}

/** Parse incoming request body for sessionId/message/persona */
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
    } catch (_) {
      // noop; handled below
    }
  }

  return { sessionId, message, persona };
}

/** Detect attempted WebSocket upgrade (not supported here) */
function isWSAttempt(event) {
  const hdrs = event.headers || {};
  return (hdrs.upgrade || "").toLowerCase() === "websocket";
}

/** Main handler */
exports.handler = async (event, context) => {
  // CORS preflight
  if ((event.httpMethod || "").toUpperCase() === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(event.headers?.origin),
        "Content-Length": "0",
      },
      body: "",
    };
  }

  // WS detection -> explicit SSE fallback
  if (isWSAttempt(event)) {
    return {
      statusCode: 426, // Upgrade Required
      headers: {
        ...corsHeaders(event.headers?.origin),
        "Content-Type": "application/json",
        "X-DTA-Stream": "sse-fallback",
      },
      body: JSON.stringify({
        error:
          "WebSocket upgrade not available on this endpoint. Use SSE (text/event-stream).",
      }),
    };
  }

  const { sessionId, message, persona: personaName } = parseInput(event);

  const baseHeaders = {
    ...corsHeaders(event.headers?.origin),
    "Content-Type": "text/event-stream; charset=utf-8",
  };

  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: sse("error", { error: "Missing OPENAI_API_KEY" }),
    };
  }

  if (!sessionId || !message) {
    return {
      statusCode: 400,
      headers: baseHeaders,
      body: sse("error", {
        error: "Missing required fields: sessionId and message",
      }),
    };
  }

  // Session store: same map used by session-chat.js
  const sessions = getMap({ name: "sessions" });

  // load or init session
  let session =
    (await sessions.get(sessionId, { type: "json" }).catch(() => null)) || null;
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

  // push user message and pre-save (so parallel consumers see state)
  session.messages = trimHistory(
    [...(session.messages || []), { role: "user", content: message, ts: Date.now() }],
    MAX_HISTORY_MESSAGES
  );
  await sessions.set(sessionId, session).catch(() => {});

  // Build OpenAI request
  const messages = buildOpenAIMessages(persona, session.messages);
  const openaiBody = {
    model: DEFAULT_MODEL,
    stream: true,
    messages,
    temperature: 0.7,
  };

  // Create a ReadableStream for SSE
  const readable = new ReadableStream({
    start: async (controller) => {
      // open event to confirm stream start
      controller.enqueue(
        encoder.encode(
          sse("open", {
            ok: true,
            model: DEFAULT_MODEL,
            persona: session.persona,
            sessionId,
          })
        )
      );

      // heartbeat every 15s
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch (_) {
          // ignore
        }
      }, 15000);

      let fullText = "";

      // Helper to finalize: emit done, save assistant, close stream
      const finish = async () => {
        clearInterval(ping);
        // Emit final message event (optional summary length)
        controller.enqueue(
          encoder.encode(
            sse("done", { bytes: Buffer.byteLength(fullText, "utf8"), chars: fullText.length })
          )
        );

        // Append assistant message to session + persist
        try {
          session.messages = trimHistory(
            [...(session.messages || []), { role: "assistant", content: fullText, ts: Date.now() }],
            MAX_HISTORY_MESSAGES
          );
          session.updatedAt = Date.now();
          await sessions.set(sessionId, session);
        } catch (_) {
          // ignore save failure
        }

        controller.close();
      };

      // Call OpenAI with fetch() and stream chunks
      let openaiResp;
      try {
        openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(openaiBody),
        });
      } catch (err) {
        controller.enqueue(encoder.encode(sse("error", { error: String(err || "fetch failed") })));
        await finish();
        return;
      }

      if (!openaiResp.ok || !openaiResp.body) {
        controller.enqueue(
          encoder.encode(
            sse("error", {
              error: "OpenAI request failed",
              status: openaiResp.status,
              statusText: openaiResp.statusText,
            })
          )
        );
        await finish();
        return;
      }

      // Stream parse OpenAI SSE and forward token deltas
      const reader = openaiResp.body.getReader();

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            // OpenAI streams as SSE: lines beginning with "data: "
            const lines = chunk.split("\n");

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              if (!line.startsWith("data:")) continue;

              const data = line.slice(5).trim(); // after 'data:'
              if (data === "[DONE]") {
                // OpenAI stream end marker
                continue;
              }

              try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta || {};
                const piece = delta?.content || "";

                if (piece) {
                  fullText += piece;
                  controller.enqueue(encoder.encode(sse("token", { content: piece })));
                }
              } catch (e) {
                // If a non-JSON line sneaks in, ship it as-is for debugging
                controller.enqueue(encoder.encode(sse("meta", { raw: data })));
              }
            }
          }
        } catch (err) {
          controller.enqueue(encoder.encode(sse("error", { error: String(err) })));
        } finally {
          await finish();
        }
      };

      pump();
    },
  });

  // Return the streaming Response
  return new Response(readable, {
    status: 200,
    headers: {
      ...baseHeaders,
      "X-DTA-Stream": "v1-sse",
    },
  });
};
