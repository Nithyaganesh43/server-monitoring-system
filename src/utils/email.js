const nodemailer = require('nodemailer');

const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_ID,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });
};

const transporter = createTransporter();

const sendEmail = async (to, subject, html) => {
  try {
    const mailOptions = {
      from: {
        name: 'Watchtower 24/7',
        address: process.env.EMAIL_ID
      },
      to: to.toLowerCase().trim(),
      subject,
      html
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

const generateVerificationEmail = (token, email) => {
  const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify?token=${token}`;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Verify Your Device - Watchtower 24/7</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Verify Your Device</h2>
            <p>Hello,</p>
            <p>Please click the link below to verify your device for Watchtower 24/7:</p>
            <div style="margin: 20px 0;">
                <a href="${verificationUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Verify Device</a>
            </div>
            <p>Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
            <p><strong>This link will expire in 10 minutes.</strong></p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">
                If you didn't request this verification, please ignore this email.
            </p>
        </div>
    </body>
    </html>
  `;
};

const generateServerDownAlert = (server, errorMessage) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Server Down Alert - Watchtower 24/7</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626;">🚨 Server Down Alert</h2>
            <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0;">
                <p><strong>Server:</strong> ${server.url}</p>
                <p><strong>Status:</strong> Offline</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Consecutive Failures:</strong> ${server.consecutiveFailures}</p>
                ${errorMessage ? `<p><strong>Error:</strong> ${errorMessage}</p>` : ''}
            </div>
            <p>Your server is currently unreachable. Please check your server and network configuration.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 14px;">
                This is an automated alert from Watchtower 24/7.
            </p>
        </div>
    </body>
    </html>
  `;
};

module.exports = {
  sendEmail,
  generateVerificationEmail,
  generateServerDownAlert
};