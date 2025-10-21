// functions/test-email.js
// Test email functionality

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
    const { to } = JSON.parse(event.body || '{}');
    
    if (!to) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Missing email address' })
      };
    }

    // Test email configuration
    const transporter = nodemailer.createTransporter({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Send test email
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'no-reply@doppletalent.agency',
      to,
      subject: '🎉 DOP Talent Agency - Email Test',
      html: `
        <h2>Email Test Successful!</h2>
        <p>Your DOP Talent Agency email notifications are working correctly.</p>
        <p>You'll receive an email when your DOP videos are ready!</p>
        <hr>
        <p><small>Sent from DOP Talent Agency</small></p>
      `,
      text: 'Email Test Successful! Your DOP Talent Agency email notifications are working correctly.'
    };

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        success: true, 
        message: 'Test email sent successfully!',
        to: to
      })
    };

  } catch (error) {
    console.error('[test-email] Error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ 
        success: false,
        error: error.message,
        details: 'Check your email environment variables'
      })
    };
  }
};
