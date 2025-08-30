// functions/stream-chat.js
// Minimal SSE smoke-test to rule out syntax/paste issues.

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

function line(event, payload) {
  return (event ? `event: ${event}\n` : "") + `data: ${JSON.stringify(payload)}\n\n`;
}

module.exports.handler = async (event) => {
  // CORS preflight
  if ((event.httpMethod || "").toUpperCase() === "OPTIONS") {
    return { statusCode: 204, headers: cors(event.headers?.origin), body: "" };
  }

  // Correct Netlify streaming signature
  return stream(event, (res) => {
    // SSE headers
    res.writeHead(200, {
      ...cors(event.headers?.origin),
      "Content-Type": "text/event-stream; charset=utf-8",
    });

    // Emit a few test events
    res.write(line("open", { ok: true, test: "sse-smoke" }));
    res.write(line("token", { content: "hello " }));
    res.write(line("token", { content: "world" }));
    res.write(line("done", { ok: true }));

    // Close
    res.end();
  });
};
