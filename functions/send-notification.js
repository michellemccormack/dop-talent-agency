// functions/send-notification.js
// Send email notifications when DOP is ready

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { dopId, email, name } = body;
    
    if (!dopId) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'dopId is required' })
      };
    }

    // For now, just log the notification
    // In production, you'd integrate with SendGrid, Mailgun, etc.
    console.log(`[send-notification] DOP ${dopId} is ready for ${email || 'user'}`);
    console.log(`[send-notification] Chat URL: ${process.env.URL || 'https://dopple-talent-demo.netlify.app'}/chat.html?id=${dopId}`);
    
    // TODO: Implement actual email sending
    // const emailData = {
    //   to: email,
    //   subject: `Your DOP "${name || 'AI Doppelgänger'}" is ready!`,
    //   html: `
    //     <h2>Your AI Doppelgänger is ready!</h2>
    //     <p>Hi there!</p>
    //     <p>Your DOP "${name || 'AI Doppelgänger'}" has been created and is ready for conversations.</p>
    //     <p><a href="${process.env.URL || 'https://dopple-talent-demo.netlify.app'}/chat.html?id=${dopId}">Start chatting with your DOP</a></p>
    //     <p>Share this link with others so they can interact with your AI doppelgänger!</p>
    //   `
    // };

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Notification sent (logged)',
        chatUrl: `${process.env.URL || 'https://dopple-talent-demo.netlify.app'}/chat.html?id=${dopId}`
      })
    };

  } catch (error) {
    console.error('[send-notification] Error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to send notification',
        details: error.message 
      })
    };
  }
};
