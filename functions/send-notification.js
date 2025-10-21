// functions/send-notification.js
// Send email notifications when DOP is ready

const nodemailer = require('nodemailer');

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

    if (!email) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Recipient email is required' })
      };
    }

    // Configure Nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true', // Use 'true' for 465, 'false' for 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `🎉 Your DOP "${name || 'Avatar'}" is Ready!`,
      html: `
        <p>Hello,</p>
        <p>Good news! Your AI doppelgänger, <strong>${name || 'your DOP'}</strong>, is now fully generated and ready to chat!</p>
        <p>You can view and share your DOP here:</p>
        <p><a href="${process.env.URL}/chat.html?id=${dopId}">${process.env.URL}/chat.html?id=${dopId}</a></p>
        <p>Start interacting and sharing your unique AI persona!</p>
        <p>Best regards,<br>The DOP Talent Agency Team</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    console.log(`[send-notification] Email sent to ${email} for DOP ${dopId}`);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Notification email sent',
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
