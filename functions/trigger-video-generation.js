// functions/trigger-video-generation.js
// Manual trigger for video generation (for testing)

const { uploadsStore } = require('./_lib/blobs');

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
    const { dopId } = JSON.parse(event.body || '{}');
    
    if (!dopId) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'dopId is required' })
      };
    }

    // Load persona
    const store = uploadsStore();
    const personaKey = `personas/${dopId}.json`;
    const rawData = await store.get(personaKey, { type: 'text' });
    
    if (!rawData) {
      return {
        statusCode: 404,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'DOP not found' })
      };
    }

    const persona = JSON.parse(rawData);
    
    // Reset status to uploaded to trigger video generation
    persona.status = 'uploaded';
    await store.set(personaKey, JSON.stringify(persona), { contentType: 'application/json' });
    
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Video generation triggered',
        dopId: dopId
      })
    };

  } catch (error) {
    console.error('[trigger-video-generation] Error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to trigger video generation',
        details: error.message 
      })
    };
  }
};
