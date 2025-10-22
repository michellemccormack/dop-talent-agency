// functions/list-personas.js
// Function to list all personas for debugging

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
    
    console.log('[list-personas] Listing all personas...');
    
    // List all personas
    const personas = [];
    const list = await store.list({ prefix: 'personas/' });
    
    for (const item of list.blobs) {
      try {
        const personaData = await store.get(item.key);
        if (personaData) {
          const persona = JSON.parse(personaData);
          personas.push({
            key: item.key,
            dopId: persona.dopId,
            status: persona.status,
            created: persona.created,
            heygenImageKey: persona.heygenImageKey,
            heygenAvatarGroupId: persona.heygenAvatarGroupId,
            heygenAvatarId: persona.heygenAvatarId,
            videos: persona.videos?.length || 0,
            pending: persona.pending?.videoRequests?.length || 0
          });
        }
      } catch (error) {
        console.error('[list-personas] Error reading persona:', item.key, error);
      }
    }
    
    console.log('[list-personas] Found', personas.length, 'personas');
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        count: personas.length,
        personas: personas.sort((a, b) => new Date(b.created) - new Date(a.created))
      })
    };

  } catch (error) {
    console.error('[list-personas] Error:', error);
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
