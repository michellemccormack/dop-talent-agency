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

    const store = uploadsStore();
    
    // Try to load the persona config
    const personaKey = `personas/${dopId}.json`;
    
    let personaData;
    try {
      const rawData = await store.get(personaKey, { type: 'text' });
      if (!rawData) {
        return {
          statusCode: 404,
          headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Persona not found' })
        };
      }
      
      personaData = JSON.parse(rawData);
    } catch (parseError) {
      console.error(`Failed to load persona ${dopId}:`, parseError);
      return {
        statusCode: 404,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Persona configuration not found or invalid' })
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
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};