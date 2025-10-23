// functions/test-heygen-endpoints.js
// Test function to try different HeyGen API endpoints for creating talking photos

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
    
    console.log('[test-heygen-endpoints] Testing different HeyGen API endpoints...');
    
    const results = [];
    
    // Test 1: Try to create a talking photo from image
    console.log('[test-heygen-endpoints] Test 1: Creating talking photo from image...');
    try {
      const response = await fetch(`${HEYGEN_API_BASE}/v2/talking_photo/create`, {
        method: 'POST',
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_key: imageKey,
          name: 'Test Talking Photo'
        })
      });
      
      const responseText = await response.text();
      results.push({
        endpoint: '/v2/talking_photo/create',
        status: response.status,
        response: responseText
      });
    } catch (error) {
      results.push({
        endpoint: '/v2/talking_photo/create',
        error: error.message
      });
    }
    
    // Test 2: Try to create a talking photo using different endpoint
    console.log('[test-heygen-endpoints] Test 2: Creating talking photo with different endpoint...');
    try {
      const response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/create`, {
        method: 'POST',
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_key: imageKey,
          name: 'Test Photo Avatar'
        })
      });
      
      const responseText = await response.text();
      results.push({
        endpoint: '/v2/photo_avatar/create',
        status: response.status,
        response: responseText
      });
    } catch (error) {
      results.push({
        endpoint: '/v2/photo_avatar/create',
        error: error.message
      });
    }
    
    // Test 3: Try to create a talking photo using v1 endpoint
    console.log('[test-heygen-endpoints] Test 3: Creating talking photo with v1 endpoint...');
    try {
      const response = await fetch(`${HEYGEN_API_BASE}/v1/talking_photo/create`, {
        method: 'POST',
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_key: imageKey,
          name: 'Test Talking Photo V1'
        })
      });
      
      const responseText = await response.text();
      results.push({
        endpoint: '/v1/talking_photo/create',
        status: response.status,
        response: responseText
      });
    } catch (error) {
      results.push({
        endpoint: '/v1/talking_photo/create',
        error: error.message
      });
    }
    
    // Test 4: Try to list existing talking photos to see what's available
    console.log('[test-heygen-endpoints] Test 4: Listing existing talking photos...');
    try {
      const response = await fetch(`${HEYGEN_API_BASE}/v2/talking_photo/list`, {
        method: 'GET',
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          'Content-Type': 'application/json'
        }
      });
      
      const responseText = await response.text();
      results.push({
        endpoint: '/v2/talking_photo/list',
        status: response.status,
        response: responseText
      });
    } catch (error) {
      results.push({
        endpoint: '/v2/talking_photo/list',
        error: error.message
      });
    }
    
    // Test 5: Try to list existing photo avatars
    console.log('[test-heygen-endpoints] Test 5: Listing existing photo avatars...');
    try {
      const response = await fetch(`${HEYGEN_API_BASE}/v2/photo_avatar/list`, {
        method: 'GET',
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          'Content-Type': 'application/json'
        }
      });
      
      const responseText = await response.text();
      results.push({
        endpoint: '/v2/photo_avatar/list',
        status: response.status,
        response: responseText
      });
    } catch (error) {
      results.push({
        endpoint: '/v2/photo_avatar/list',
        error: error.message
      });
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
    console.error('[test-heygen-endpoints] Error:', error);
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
