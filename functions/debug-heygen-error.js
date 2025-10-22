// functions/debug-heygen-error.js
// Debug function to show exact HeyGen error response

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_UPLOAD_BASE = 'https://upload.heygen.com';

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
    console.log('[debug-heygen-error] Starting HeyGen upload test...');
    
    // Create a small test image (1x1 pixel JPEG)
    const testImageData = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
      0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
      0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
      0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
      0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xFF, 0xC4,
      0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x0C,
      0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0x00, 0xFF, 0xD9
    ]);

    console.log('[debug-heygen-error] Making request to HeyGen v1/asset endpoint...');
    console.log('[debug-heygen-error] API Key present:', !!HEYGEN_API_KEY);
    console.log('[debug-heygen-error] API Key prefix:', HEYGEN_API_KEY ? HEYGEN_API_KEY.substring(0, 10) + '...' : 'NOT SET');
    
    const response = await fetch(`${HEYGEN_UPLOAD_BASE}/v1/asset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Api-Key': HEYGEN_API_KEY
      },
      body: testImageData
    });

    const responseText = await response.text();
    console.log('[debug-heygen-error] Response status:', response.status);
    console.log('[debug-heygen-error] Response headers:', Object.fromEntries(response.headers.entries()));
    console.log('[debug-heygen-error] Response body:', responseText);

    // Try to parse as JSON
    let jsonData = null;
    try {
      jsonData = JSON.parse(responseText);
    } catch (parseError) {
      console.log('[debug-heygen-error] Response is not JSON');
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: true,
        debug: {
          apiKeyPresent: !!HEYGEN_API_KEY,
          apiKeyPrefix: HEYGEN_API_KEY ? HEYGEN_API_KEY.substring(0, 10) + '...' : 'NOT SET',
          endpoint: `${HEYGEN_UPLOAD_BASE}/v1/asset`,
          requestHeaders: {
            'Content-Type': 'image/jpeg',
            'X-Api-Key': HEYGEN_API_KEY ? HEYGEN_API_KEY.substring(0, 10) + '...' : 'NOT SET'
          },
          responseStatus: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: responseText,
          responseJson: jsonData,
          imageDataSize: testImageData.length,
          imageDataPreview: testImageData.slice(0, 20).toString('hex')
        }
      })
    };

  } catch (error) {
    console.error('[debug-heygen-error] Error:', error);
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
