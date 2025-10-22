// functions/test-sorting.js
// Test function to check persona sorting

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
    
    console.log('[test-sorting] Testing persona sorting...');
    
    // List all personas
    const list = await store.list({ prefix: 'personas/' });
    const items = (list?.blobs || list || []).filter(x => 
      String(x.key || x).endsWith('.json')
    );
    
    console.log(`Found ${items.length} personas`);
    
    // Sort by creation time (newest first)
    const sortedKeys = await Promise.all(items.map(async (item) => {
      const key = item.key || item;
      try {
        const data = await store.get(key);
        if (data) {
          const persona = JSON.parse(data);
          return { 
            key, 
            dopId: persona.dopId,
            created: new Date(persona.created || '1970-01-01'),
            status: persona.status
          };
        }
      } catch (error) {
        console.warn(`Failed to read persona ${key}:`, error.message);
      }
      return { 
        key, 
        dopId: 'unknown',
        created: new Date('1970-01-01'),
        status: 'unknown'
      };
    }));
    
    // Sort by creation date (newest first)
    sortedKeys.sort((a, b) => b.created - a.created);
    
    console.log('Top 5 personas (newest first):');
    sortedKeys.slice(0, 5).forEach((item, index) => {
      console.log(`${index + 1}. ${item.dopId} - ${item.created.toISOString()} - ${item.status}`);
    });
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        total: sortedKeys.length,
        top5: sortedKeys.slice(0, 5).map(item => ({
          dopId: item.dopId,
          created: item.created.toISOString(),
          status: item.status
        }))
      })
    };

  } catch (error) {
    console.error('[test-sorting] Error:', error);
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
