// functions/refresh-persona.js
// Function to manually refresh persona status for debugging

const { getStore } = require('@netlify/blobs');

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
    const store = getStore({
      name: 'dop-uploads',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
      consistency: 'strong'
    });
    
    // Get the latest DOP
    const personaKey = 'personas/dop_2b0fc8d88e6a40668054ac549222a8fb.json';
    
    console.log('[refresh-persona] Loading persona:', personaKey);
    const personaData = await store.get(personaKey);
    
    if (!personaData) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: 'Persona not found' })
      };
    }
    
    const persona = JSON.parse(personaData);
    console.log('[refresh-persona] Current persona status:', persona.status);
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        persona: {
          dopId: persona.dopId,
          status: persona.status,
          heygenImageKey: persona.heygenImageKey,
          heygenAvatarGroupId: persona.heygenAvatarGroupId,
          heygenAvatarId: persona.heygenAvatarId,
          videos: persona.videos,
          pending: persona.pending,
          created: persona.created
        }
      })
    };

  } catch (error) {
    console.error('[refresh-persona] Error:', error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
