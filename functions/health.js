// functions/health.js (CJS)
exports.handler = async () => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ok: true, fn: "health", ts: Date.now() })
});
