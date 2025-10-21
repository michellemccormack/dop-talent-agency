// functions/dop-deploy.js
// Auto-deploy system for unique DOP URLs

const { uploadsStore } = require('./_lib/blobs');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function jsonResponse(statusCode, data) {
  return {
    statusCode: statusCode,
    headers: Object.assign({}, CORS_HEADERS, { 'content-type': 'application/json' }),
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const dopId = event.queryStringParameters?.id;
    
    if (!dopId) {
      return jsonResponse(400, { error: 'Missing dopId parameter' });
    }

    // Load the DOP data
    const store = uploadsStore();
    const personaKey = `personas/${dopId}.json`;
    const rawData = await store.get(personaKey, { type: 'text' });
    
    if (!rawData) {
      return jsonResponse(404, { error: 'DOP not found' });
    }
    
    const persona = JSON.parse(rawData);
    
    // Generate unique URL for this DOP
    const uniqueUrl = `${process.env.URL}/dop/${dopId}`;
    
    // Return DOP deployment info
    return jsonResponse(200, {
      success: true,
      dopId: dopId,
      uniqueUrl: uniqueUrl,
      status: persona.status,
      name: persona.name,
      created: persona.created,
      videos: persona.videos?.length || 0,
      totalVideos: persona.prompts?.length || 0,
      isReady: persona.status === 'ready'
    });

  } catch (error) {
    console.error('[dop-deploy] Error:', error);
    return jsonResponse(500, { 
      error: 'Internal server error',
      details: error.message 
    });
  }
};
