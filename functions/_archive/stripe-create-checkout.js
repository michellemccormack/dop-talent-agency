// functions/stripe-create-checkout.js
// Creates a Stripe Checkout Session and 303-redirects to Stripe.
// Add-only. No other files touched. CommonJS + Node 18 (Netlify).

/**
 * ENV VARS (required):
 * - STRIPE_SECRET_KEY              (sk_live_... or sk_test_...)
 * AND EITHER:
 *   - STRIPE_PRICE_ID              (price_... from Stripe Dashboard)
 *   OR
 *   - STRIPE_AMOUNT_CENTS          (integer, e.g. 4900)
 *     STRIPE_CURRENCY              (e.g. "usd", "eur")
 *
 * Optional:
 * - STRIPE_PRODUCT_NAME            (fallback when using amount/currency; default: "DOP Creation – Tier 1")
 * - STRIPE_MODE                    ("payment" or "subscription"; default "payment")
 */

const qs = require("node:querystring");

// Node 18+ has global fetch, so we avoid adding the stripe SDK (no package.json change).
async function createCheckoutSession({
  secretKey,
  origin,
  priceId,
  amountCents,
  currency,
  productName,
  mode,
}) {
  const form = {};

  form.mode = mode || "payment";
  form.success_url = `${origin}/pay-success.html`; // will exist in Step 2
  form.cancel_url = `${origin}/pay-cancel.html`;   // stub ok for now

  if (priceId) {
    form["line_items[0][price]"] = priceId;
    form["line_items[0][quantity]"] = 1;
  } else {
    // Build inline price data
    const name = productName || "DOP Creation – Tier 1";
    form["line_items[0][price_data][currency]"] = currency;
    form["line_items[0][price_data][product_data][name]"] = name;
    form["line_items[0][price_data][unit_amount]"] = String(amountCents);
    form["line_items[0][quantity]"] = 1;
  }

  const body = qs.stringify(form);

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await resp.json();

  if (!resp.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : "Stripe error";
    const code = data && data.error && data.error.code ? data.error.code : "stripe_error";
    throw new Error(`[${code}] ${msg}`);
  }

  if (!data.url) {
    throw new Error("Stripe response missing session URL.");
  }

  return data.url;
}

exports.handler = async (event) => {
  try {
    // Allow GET for easy manual test; also allow POST (future use)
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST" && event.httpMethod !== "OPTIONS") {
      return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
    }

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    const {
      STRIPE_SECRET_KEY,
      STRIPE_PRICE_ID,
      STRIPE_AMOUNT_CENTS,
      STRIPE_CURRENCY,
      STRIPE_PRODUCT_NAME,
      STRIPE_MODE,
    } = process.env;

    if (!STRIPE_SECRET_KEY) {
      return err(500, "Missing STRIPE_SECRET_KEY");
    }

    const origin = getOrigin(event);
    if (!origin) {
      return err(400, "Unable to determine request origin.");
    }

    // Decide pricing approach: price ID OR (amount + currency)
    let priceId = (STRIPE_PRICE_ID || "").trim() || null;
    let amountCents = null;
    let currency = null;

    if (!priceId) {
      if (!STRIPE_AMOUNT_CENTS || !STRIPE_CURRENCY) {
        return err(500, "Provide STRIPE_PRICE_ID OR STRIPE_AMOUNT_CENTS + STRIPE_CURRENCY");
      }
      const parsed = parseInt(String(STRIPE_AMOUNT_CENTS), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return err(500, "STRIPE_AMOUNT_CENTS must be a positive integer (e.g., 4900)");
      }
      amountCents = parsed;
      currency = String(STRIPE_CURRENCY).toLowerCase();
      if (!/^[a-z]{3}$/.test(currency)) {
        return err(500, "STRIPE_CURRENCY must be a 3-letter code (e.g., usd, eur)");
      }
    }

    const checkoutUrl = await createCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      origin,
      priceId,
      amountCents,
      currency,
      productName: STRIPE_PRODUCT_NAME,
      mode: STRIPE_MODE || "payment",
    });

    // 303 redirect to Stripe Checkout
    return {
      statusCode: 303,
      headers: {
        ...corsHeaders(),
        Location: checkoutUrl,
      },
      body: "",
    };
  } catch (e) {
    return err(500, e.message || "Unexpected error");
  }
};

function getOrigin(event) {
  // Prefer the site URL that served the function (supports custom domains)
  const hdr = event.headers || {};
  const proto = (hdr["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (hdr["x-forwarded-host"] || hdr["host"] || "").split(",")[0].trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function err(code, msg) {
  return {
    statusCode: code,
    headers: corsHeaders(),
    body: JSON.stringify({ error: msg }),
  };
}
