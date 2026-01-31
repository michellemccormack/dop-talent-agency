// functions/create-checkout-session.js
// Creates a Stripe Checkout Session for one-time product "Alter Ego".
// Returns JSON { url } so the frontend can redirect.

/**
 * ENV: STRIPE_SECRET_KEY (required)
 * ENV: STRIPE_PRICE_ID (optional) OR STRIPE_AMOUNT_CENTS + STRIPE_CURRENCY
 * Optional: STRIPE_PRODUCT_NAME (default: "Alter Ego")
 */

const qs = require("querystring");

async function createCheckoutSession(opt) {
  var form = {};
  form.mode = "payment";
  form.success_url = opt.dopId
    ? opt.origin + "/chat.html?id=" + encodeURIComponent(opt.dopId) + "&session_id={CHECKOUT_SESSION_ID}"
    : opt.origin + "/pay-success.html?session_id={CHECKOUT_SESSION_ID}";
  form.cancel_url = opt.dopId
    ? opt.origin + "/chat.html?id=" + encodeURIComponent(opt.dopId)
    : opt.origin + "/alter-ego";

  if (opt.priceId) {
    form["line_items[0][price]"] = opt.priceId;
    form["line_items[0][quantity]"] = 1;
  } else {
    form["line_items[0][price_data][currency]"] = opt.currency;
    form["line_items[0][price_data][product_data][name]"] = opt.productName || "Alter Ego";
    form["line_items[0][price_data][unit_amount]"] = String(opt.amountCents);
    form["line_items[0][quantity]"] = 1;
  }

  var body = qs.stringify(form);
  var resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + opt.secretKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body,
  });

  var data = await resp.json();
  if (!resp.ok) {
    var msg = data && data.error && data.error.message ? data.error.message : "Stripe error";
    var code = data && data.error && data.error.code ? data.error.code : "stripe_error";
    throw new Error("[" + code + "] " + msg);
  }
  if (!data.url) throw new Error("Stripe response missing session URL.");
  return data.url;
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST" && event.httpMethod !== "OPTIONS") {
      return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    var dopId = null;
    var qsParams = event.queryStringParameters || {};
    dopId = qsParams.dopId || qsParams.id || null;
    if (event.httpMethod === "POST" && event.body) {
      try {
        var parsed = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        dopId = dopId || parsed.dopId || parsed.dop_id || null;
      } catch (ignore) {}
    }

    var STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    var STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
    var STRIPE_AMOUNT_CENTS = process.env.STRIPE_AMOUNT_CENTS;
    var STRIPE_CURRENCY = process.env.STRIPE_CURRENCY;
    var STRIPE_PRODUCT_NAME = process.env.STRIPE_PRODUCT_NAME;

    if (!STRIPE_SECRET_KEY) {
      return err(500, "Missing STRIPE_SECRET_KEY");
    }

    var origin = getOrigin(event);
    if (!origin) {
      return err(400, "Unable to determine request origin");
    }

    var priceId = (STRIPE_PRICE_ID || "").trim() || null;
    var amountCents = null;
    var currency = null;

    if (!priceId) {
      if (!STRIPE_AMOUNT_CENTS || !STRIPE_CURRENCY) {
        return err(500, "Provide STRIPE_PRICE_ID OR STRIPE_AMOUNT_CENTS + STRIPE_CURRENCY");
      }
      var parsedAmount = parseInt(String(STRIPE_AMOUNT_CENTS), 10);
      if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
        return err(500, "STRIPE_AMOUNT_CENTS must be a positive integer");
      }
      amountCents = parsedAmount;
      currency = String(STRIPE_CURRENCY).toLowerCase();
      if (!/^[a-z]{3}$/.test(currency)) {
        return err(500, "STRIPE_CURRENCY must be a 3-letter code (e.g. usd)");
      }
    }

    var url = await createCheckoutSession({
      secretKey: STRIPE_SECRET_KEY,
      origin: origin,
      priceId: priceId,
      amountCents: amountCents,
      currency: currency,
      productName: STRIPE_PRODUCT_NAME || "Alter Ego",
      dopId: typeof dopId === "string" ? dopId.trim() : null,
    });

    return {
      statusCode: 200,
      headers: Object.assign(corsHeaders(), { "content-type": "application/json" }),
      body: JSON.stringify({ url: url }),
    };
  } catch (e) {
    return err(500, e.message || "Unexpected error");
  }
};

function getOrigin(event) {
  var hdr = event.headers || {};
  var proto = (hdr["x-forwarded-proto"] || "https").split(",")[0].trim();
  var host = (hdr["x-forwarded-host"] || hdr["host"] || "").split(",")[0].trim();
  return host ? proto + "://" + host : null;
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
