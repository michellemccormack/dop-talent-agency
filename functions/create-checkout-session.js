// functions/create-checkout-session.js
// Creates a Stripe Checkout Session for one-time product "Alter Ego".
// Returns JSON { url } so the frontend can redirect. No API keys hardcoded.

/**
 * ENV: STRIPE_SECRET_KEY (required)
 * ENV: STRIPE_PRICE_ID (optional) OR STRIPE_AMOUNT_CENTS + STRIPE_CURRENCY
 * Optional: STRIPE_PRODUCT_NAME (default: "Alter Ego")
 */

const qs = require('node:querystring');

async function createCheckoutSession({
  secretKey,
  origin,
  priceId,
  amountCents,
  currency,
  productName,
  dopId,
}) {
  const form = {};
  form.mode = 'payment';
  form.success_url = dopId
    ? `${origin}/chat.html?id=${encodeURIComponent(dopId)}&session_id={CHECKOUT_SESSION_ID}`
    : `${origin}/pay-success.html?session_id={CHECKOUT_SESSION_ID}`;
  form.cancel_url = dopId ? `${origin}/chat.html?id=${encodeURIComponent(dopId)}` : `${origin}/upload.html`;

  if (priceId) {
    form['line_items[0][price]'] = priceId;
    form['line_items[0][quantity]'] = 1;
  } else {
    const name = productName || 'Alter Ego';
    form['line_items[0][price_data][currency]'] = currency;
    form['line_items[0][price_data][product_data][name]'] = name;
    form['line_items[0][price_data][unit_amount]'] = String(amountCents);
    form['line_items[0][quantity]'] = 1;
  }

  const body = qs.stringify(form);
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await resp.json();
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : 'Stripe error';
    const code = (data && data.error && data.error.code) ? data.error.code : 'stripe_error';
    throw new Error(`[${code}] ${msg}`);
  }
  if (!data.url) throw new Error('Stripe response missing session URL.');
  return data.url;
}

function getOrigin(event) {
  const hdr = event.headers || {};
  const proto = (hdr['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (hdr['x-forwarded-host'] || hdr['host'] || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : null;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function err(code, msg) {
  return {
    statusCode: code,
    headers: corsHeaders(),
    body: JSON.stringify({ error: msg }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  let dopId = event.queryStringParameters?.dopId || event.queryStringParameters?.id || null;
  if (event.httpMethod === 'POST' && event.body) {
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      dopId = dopId || body.dopId || body.dop_id || null;
    } catch (_) {}
  }

  try {
    const {
      STRIPE_SECRET_KEY,
      STRIPE_PRICE_ID,
      STRIPE_AMOUNT_CENTS,
      STRIPE_CURRENCY,
      STRIPE_PRODUCT_NAME,
    } = process.env;

    if (!STRIPE_SECRET_KEY) {
      return { statusCode: 500, headers: { ...corsHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' }) };
    }

    const origin = getOrigin(event);
    if (!origin) {
      return { statusCode: 400, headers: { ...corsHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Unable to determine request origin' }) };
    }

    let priceId = (STRIPE_PRICE_ID || '').trim() || null;
    let amountCents = null;
    let currency = null;

    if (!priceId) {
      if (!STRIPE_AMOUNT_CENTS || !STRIPE_CURRENCY) {
        return { statusCode: 500, headers: { ...corsHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Provide STRIPE_PRICE_ID OR STRIPE_AMOUNT_CENTS + STRIPE_CURRENCY' }) };
      }
      const parsed = parseInt(String(STRIPE_AMOUNT_CENTS), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { statusCode: 500, headers: { ...corsHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ error: 'STRIPE_AMOUNT_CENTS must be a positive integer' }) };
      }
      amountCents = parsed;
      currency = String(STRIPE_CURRENCY).toLowerCase();
      if (!/^[a-z]{3}$/.test(currency)) {
        return { statusCode: 500, headers: { ...corsHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ error: 'STRIPE_CURRENCY must be a 3-letter code (e.g. usd)' }) };
    }

    const url = await createCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      origin,
      priceId,
      amountCents,
      currency,
      productName: STRIPE_PRODUCT_NAME || 'Alter Ego',
      dopId: dopId && typeof dopId === 'string' ? dopId.trim() : null,
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    };
  } catch (e) {
    return err(500, e.message || 'Unexpected error');
  }
};
