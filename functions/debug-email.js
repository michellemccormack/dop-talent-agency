// functions/debug-email.js
// Debug email configuration

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  try {
    // Check environment variables
    const envCheck = {
      EMAIL_HOST: process.env.EMAIL_HOST,
      EMAIL_PORT: process.env.EMAIL_PORT,
      EMAIL_SECURE: process.env.EMAIL_SECURE,
      EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
      EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'NOT SET',
      EMAIL_FROM: process.env.EMAIL_FROM
    };

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Environment variables check',
        envCheck: envCheck,
        note: 'Check if EMAIL_USER and EMAIL_PASS are properly set'
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
