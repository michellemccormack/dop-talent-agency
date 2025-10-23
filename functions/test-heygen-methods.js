// functions/test-heygen-methods.js
// Test function to try different HTTP methods for HeyGen API endpoints

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const HEYGEN_API_BASE = 'https://api.heygen.com';
    const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
    const imageKey = '4dec45df16bf489dad02071e0141476e';
    
    console.log('[test-heygen-methods] Testing different HTTP methods for HeyGen API endpoints...');
    
    const results = [];
    
    // Test different methods for /v2/talking_photo/create
    const methods = ['GET', 'POST', 'PUT', 'PATCH'];
    const endpoints = [
      '/v2/talking_photo/create',
      '/v2/talking_photo',
      '/v2/photo_avatar/create',
      '/v2/photo_avatar',
      '/v2/talking_photo/list',
      '/v2/photo_avatar/list'
    ];
    
    for (const endpoint of endpoints) {
      for (const method of methods) {
        console.log(`[test-heygen-methods] Testing ${method} ${endpoint}...`);
        try {
          const requestBody = method === 'GET' ? undefined : JSON.stringify({
            image_key: imageKey,
            name: 'Test'
          });
          
          const response = await fetch(`${HEYGEN_API_BASE}${endpoint}`, {
            method: method,
            headers: {
              'X-Api-Key': HEYGEN_API_KEY,
              'Content-Type': 'application/json'
            },
            body: requestBody
          });
          
          const responseText = await response.text();
          results.push({
            endpoint: endpoint,
            method: method,
            status: response.status,
            response: responseText.substring(0, 200) // Truncate long responses
          });
          
          // If we get a successful response, log it
          if (response.ok) {
            console.log(`[test-heygen-methods] SUCCESS: ${method} ${endpoint} returned ${response.status}`);
          }
          
        } catch (error) {
          results.push({
            endpoint: endpoint,
            method: method,
            error: error.message
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        imageKey: imageKey,
        results: results
      })
    };

  } catch (error) {
    console.error('[test-heygen-methods] Error:', error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
};
