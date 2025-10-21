// functions/check-video.js
// Check video generation status for a DOP

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
    
    // Calculate progress
    const totalVideos = persona.prompts?.length || 3;
    const completedVideos = persona.videos?.length || 0;
    const pendingRequests = persona.pending?.videoRequests?.length || 0;
    
    let status = persona.status || 'unknown';
    let progressPercent = 0;
    let estimatedTimeRemaining = 'A few minutes';

    if (totalVideos > 0) {
      progressPercent = Math.floor((completedVideos / totalVideos) * 100);
      if (status === 'processing') {
        estimatedTimeRemaining = `Estimated ${Math.max(1, (totalVideos - completedVideos) * 2)} minutes remaining`;
      } else if (status === 'ready') {
        estimatedTimeRemaining = 'Ready!';
      }
    }
    
    const progress = {
      dopId: dopId,
      status: status,
      totalVideos: totalVideos,
      completedVideos: completedVideos,
      pendingRequests: pendingRequests,
      progressPercent: progressPercent,
      estimatedTimeRemaining: estimatedTimeRemaining,
      lastUpdated: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(progress)
    };

  } catch (error) {
    console.error('[check-video] Error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to check video status',
        details: error.message 
      })
    };
  }
};
