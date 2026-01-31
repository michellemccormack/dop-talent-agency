// functions/verify-checkout-session.js
// Verifies a Stripe Checkout Session; if paid, stores payment in Blobs and returns { paid: true }.
// No API keys hardcoded. Uses STRIPE_SECRET_KEY from env.

const { uploadsStore } = require('./_lib/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(obj) {
  return { statusCode: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) };
}

function err(code, msg) {
  return { statusCode: code, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: msg }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  let sessionId = event.queryStringParameters?.session_id || null;
  let dopId = event.queryStringParameters?.dopId || event.queryStringParameters?.id || null;
  if (event.httpMethod === 'POST' && event.body) {
    try {
      const body = JSON.parse(event.body);
      sessionId = sessionId || body.session_id || null;
      dopId = dopId || body.dopId || body.dop_id || null;
    } catch (_) {}
  }

  if (!sessionId) {
    return err(400, 'Missing session_id');
  }

  // Optional: test without paying (only when ALLOW_TEST_CHECKOUT=1 in env)
  if (process.env.ALLOW_TEST_CHECKOUT === '1' && sessionId.startsWith('test_bypass_')) {
    const store = uploadsStore();
    await store.set(`payments/${sessionId}`, JSON.stringify({ paid: true }), { contentType: 'application/json' });
    return ok({ paid: true });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return err(500, 'Missing STRIPE_SECRET_KEY');
  }

  try {
    const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : 'Stripe error';
      return err(400, msg);
    }

    const paymentStatus = (data.payment_status || '').toLowerCase();
    if (paymentStatus !== 'paid') {
      return err(400, 'Payment not completed');
    }

    const store = uploadsStore();
    await store.set(`payments/${sessionId}`, JSON.stringify({ paid: true }), { contentType: 'application/json' });

    if (dopId && typeof dopId === 'string' && dopId.trim()) {
      const personaKey = `personas/${dopId.trim()}.json`;
      try {
        const raw = await store.get(personaKey, { type: 'text' });
        if (raw) {
          const persona = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const updated = { ...persona, paid: true };
          await store.set(personaKey, JSON.stringify(updated), { contentType: 'application/json; charset=utf-8' });
        }
      } catch (e) {
        console.warn('[verify-checkout-session] Could not set paid on persona:', e.message);
      }
    }

    return ok({ paid: true });
  } catch (e) {
    console.error('[verify-checkout-session]', e);
    return err(500, e.message || 'Verification failed');
  }
};
