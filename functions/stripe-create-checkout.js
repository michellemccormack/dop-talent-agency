// functions/stripe-create-checkout.js
// Create Stripe checkout session for DOP upgrades

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { dopId, tier = 'basic' } = body;
    
    if (!dopId) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'dopId is required' })
      };
    }

    // Define pricing tiers
    const pricing = {
      basic: {
        price: 9.99,
        name: 'Basic DOP',
        description: 'Full conversation access for your DOP'
      },
      pro: {
        price: 19.99,
        name: 'Pro DOP',
        description: 'Advanced features and priority processing'
      },
      premium: {
        price: 49.99,
        name: 'Premium DOP',
        description: 'All features plus custom voice training'
      }
    };

    const selectedTier = pricing[tier] || pricing.basic;
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: selectedTier.name,
            description: selectedTier.description,
          },
          unit_amount: Math.round(selectedTier.price * 100), // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.URL || 'https://dopple-talent-demo.netlify.app'}/pay-success.html?dopId=${dopId}&tier=${tier}`,
      cancel_url: `${process.env.URL || 'https://dopple-talent-demo.netlify.app'}/chat.html?id=${dopId}`,
      metadata: {
        dopId: dopId,
        tier: tier
      }
    });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id
      })
    };

  } catch (error) {
    console.error('[stripe-create-checkout] Error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Payment processing failed',
        details: error.message 
      })
    };
  }
};