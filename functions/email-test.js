// functions/email-test.js
// Simple email test function

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' } };
  }
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    
    if (!email) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email required' })
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
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'no-reply@doppletalent.agency',
      to: email,
      subject: '🎉 DOP Talent Agency - Email Test',
      html: `
        <h2>Email Test Successful!</h2>
        <p>Your DOP Talent Agency email notifications are working correctly.</p>
        <p>You'll receive an email when your DOP videos are ready!</p>
      `,
      text: 'Email Test Successful! Your DOP Talent Agency email notifications are working correctly.'
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: true, 
        message: 'Test email sent successfully!',
        email: email
      })
    };

  } catch (error) {
    console.error('[email-test] Error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false,
        error: error.message,
        details: 'Check your email environment variables'
      })
    };
  }
};
