// functions/test-avatar-group.js
// Test function to debug avatar group creation issue

const heygenProxy = require('./heygen-proxy');

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
    console.log('[test-avatar-group] Testing avatar group creation...');
    
    // Use the image key from the successful photo upload
    const imageKey = 'cd32aa66a7c542b6ab5713c4645d66a1'; // From the successful photo upload
    
    console.log('[test-avatar-group] Creating avatar group with image key:', imageKey);
    
    const avatarEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({
        action: 'create_avatar_group',
        imageKey: imageKey,
        name: 'Test Avatar'
      })
    };
    
    const avatarResult = await heygenProxy.handler(avatarEvent);
    console.log('[test-avatar-group] Avatar group result:', avatarResult);
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        imageKey: imageKey,
        avatarResult: avatarResult
      })
    };

  } catch (error) {
    console.error('[test-avatar-group] Error:', error);
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
