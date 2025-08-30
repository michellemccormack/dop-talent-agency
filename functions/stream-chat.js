// functions/stream-chat.js
// Minimal SSE smoke-test using the correct Netlify signature.

const { stream } = require("@netlify/functions");

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function sse(event, payload) {
  return (event ? `event: ${event}\n` : "") + `data: ${JSON.stringify(payload)}\n\n`;
}

// ✅ Correct pattern: export the wrapped handler.
module.exports.handler = stream(async (event, context, response) => {
  // CORS preflight (note: for OPTIONS you’d normally return early via a non-stream handler,
  // but for a smoke test we just open SSE on GET/POST)
  const method = (event.httpMethod || "").toUpperCase();
  if (method === "OPTIONS") {
    response.writeHead(204, cors(event.headers?.origin));
    return response.end();
  }

  // Open SSE
  response.writeHead(200, {
    ...cors(event.headers?.origin),
    "Content-Type": "text/event-stream; charset=utf-8",
  });

  response.write(sse("open", { ok: true, test: "netlify-stream" }));
  response.write(sse("token", { content: "hello " }));
  response.write(sse("token", { content: "world" }));
  response.write(sse("done", { ok: true }));
  response.end();
});
