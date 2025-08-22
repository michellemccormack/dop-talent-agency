// functions/session-chat.js
// Minimal stub to prove the route works (returns JSON 200)
exports.handler = async (event) => {
  try {
    const req = JSON.parse(event.body || "{}");
    const text = (req.text || "").toLowerCase();

    // simple routing to your three clips for smoke test
    const matchedClip =
      text.includes("fun")   ? "assets/p_fun.mp4"   :
      text.includes("from")  ? "assets/p_from.mp4"  :
      text.includes("relax") ? "assets/p_relax.mp4" : null;

    if (matchedClip) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchedClip })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fallbackResponse: "Session stub is alive." })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fallbackResponse: "Stub error; still alive." })
    };
  }
};
