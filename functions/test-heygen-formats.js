// functions/test-heygen-formats.js
// Test function to try different request formats for HeyGen video generation

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
    
    console.log('[test-heygen-formats] Testing different request formats for HeyGen video generation...');
    
    const results = [];
    
    // Test different request formats for video generation
    const formats = [
      {
        name: 'Original format with talking_photo_id',
        requestBody: {
          video_inputs: [{
            character: {
              type: 'talking_photo',
              talking_photo_id: imageKey,
              scale: 1.0
            },
            voice: {
              type: 'text',
              input_text: 'What do you like to do for fun?',
              voice_id: 'default'
            }
          }],
          dimension: {
            width: 1080,
            height: 1920
          },
          aspect_ratio: '9:16',
          test: false
        }
      },
      {
        name: 'Format with image_key instead of talking_photo_id',
        requestBody: {
          video_inputs: [{
            character: {
              type: 'talking_photo',
              image_key: imageKey,
              scale: 1.0
            },
            voice: {
              type: 'text',
              input_text: 'What do you like to do for fun?',
              voice_id: 'default'
            }
          }],
          dimension: {
            width: 1080,
            height: 1920
          },
          aspect_ratio: '9:16',
          test: false
        }
      },
      {
        name: 'Format with avatar_id instead of talking_photo_id',
        requestBody: {
          video_inputs: [{
            character: {
              type: 'talking_photo',
              avatar_id: imageKey,
              scale: 1.0
            },
            voice: {
              type: 'text',
              input_text: 'What do you like to do for fun?',
              voice_id: 'default'
            }
          }],
          dimension: {
            width: 1080,
            height: 1920
          },
          aspect_ratio: '9:16',
          test: false
        }
      },
      {
        name: 'Simplified format without dimension',
        requestBody: {
          video_inputs: [{
            character: {
              type: 'talking_photo',
              talking_photo_id: imageKey
            },
            voice: {
              type: 'text',
              input_text: 'What do you like to do for fun?',
              voice_id: 'default'
            }
          }],
          aspect_ratio: '9:16'
        }
      },
      {
        name: 'Format with different character type',
        requestBody: {
          video_inputs: [{
            character: {
              type: 'avatar',
              avatar_id: imageKey
            },
            voice: {
              type: 'text',
              input_text: 'What do you like to do for fun?',
              voice_id: 'default'
            }
          }],
          aspect_ratio: '9:16'
        }
      }
    ];
    
    for (const format of formats) {
      console.log(`[test-heygen-formats] Testing format: ${format.name}`);
      try {
        const response = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
          method: 'POST',
          headers: {
            'X-Api-Key': HEYGEN_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(format.requestBody)
        });
        
        const responseText = await response.text();
        results.push({
          format: format.name,
          status: response.status,
          response: responseText.substring(0, 500) // Truncate long responses
        });
        
        // If we get a successful response, log it
        if (response.ok) {
          console.log(`[test-heygen-formats] SUCCESS: ${format.name} returned ${response.status}`);
        }
        
      } catch (error) {
        results.push({
          format: format.name,
          error: error.message
        });
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
    console.error('[test-heygen-formats] Error:', error);
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
