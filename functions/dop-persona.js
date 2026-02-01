// functions/dop-persona.js
// Get persona data for a DOP

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const dopId = event.queryStringParameters?.id;
    console.log('[dop-persona] Request received. dopId:', dopId);

    if (!dopId) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing id parameter' })
      };
    }

    // FIX 2: Use uploadsStore() directly — exactly the same way dop-uploads.js writes.
    // Previously this used uploadsStore.getBlob() which is a convenience wrapper,
    // but the key point is that both read and write must go through the same
    // getStore({ name: 'dop-uploads', siteID, token }) call.
    console.log('[dop-persona] Initializing blob store...');
    const store = uploadsStore();
    console.log('[dop-persona] Store initialized successfully');

    const personaKey = `personas/${dopId}.json`;
    console.log('[dop-persona] Looking up key:', personaKey);

    // Use store.get() directly — same interface dop-uploads uses for store.set()
    const rawData = await store.get(personaKey, { type: 'text' });
    console.log('[dop-persona] Raw data result:', rawData ? `found (${rawData.length} chars)` : 'null/undefined');

    if (!rawData) {
      // Extra debug: list what IS in the store so we can see if the key is just different
      try {
        const listing = await store.list({ prefix: 'personas/' });
        console.log('[dop-persona] Personas in store:', JSON.stringify(listing));
      } catch (listErr) {
        console.log('[dop-persona] Could not list store contents:', listErr.message);
      }

      return {
        statusCode: 404,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Persona not found', dopId, key: personaKey })
      };
    }

    const persona = JSON.parse(rawData);
    console.log('[dop-persona] Parsed persona successfully. Name:', persona.name, 'Status:', persona.status);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        persona: persona
      })
    };

  } catch (error) {
    console.error('[dop-persona] Error:', error.message);
    console.error('[dop-persona] Stack:', error.stack);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
