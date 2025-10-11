// functions/dop-persona.js
// Load persona configuration for a DOP ID

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
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const dopId = event.queryStringParameters?.id || event.queryStringParameters?.dopId;
    
    if (!dopId) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing dopId parameter' })
      };
    }

    // Try to load the persona config using our wrapper
    const personaKey = `personas/${dopId}.json`;
    
    console.log(`[dop-persona] Loading persona: ${personaKey}`);
    
    let personaData;
    try {
      const rawData = await uploadsStore.getBlob(personaKey);
      
      if (!rawData) {
        console.log(`[dop-persona] Persona not found: ${personaKey}`);
        return {
          statusCode: 404,
          headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Persona not found' })
        };
      }
      
      // Parse the JSON
      personaData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      console.log(`[dop-persona] Successfully loaded persona: ${dopId}`);
      
    } catch (parseError) {
      console.error(`[dop-persona] Failed to load persona ${dopId}:`, parseError);
      return {
        statusCode: 404,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Persona configuration not found or invalid',
          details: parseError.message
        })
      };
    }

    // Return the persona config
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(personaData)
    };

  } catch (err) {
    console.error('[dop-persona] Error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: err.message
      })
    };
  }
};