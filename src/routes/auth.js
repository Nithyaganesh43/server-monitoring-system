const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PendingAuth = require('../models/PendingAuth');
const { sendEmail, generateVerificationEmail } = require('../utils/email');
const { validateEmail, validateDeviceId } = require('../utils/validation');
const { generateToken, generateVerificationToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Request verification email
router.post('/request', async (req, res) => {
  try {
    const { email, deviceId } = req.body;

    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error });
    }

    // Validate deviceId
    const deviceValidation = validateDeviceId(deviceId);
    if (!deviceValidation.valid) {
      return res.status(400).json({ error: deviceValidation.error });
    }

    const normalizedEmail = emailValidation.normalizedEmail;
    const normalizedDeviceId = deviceValidation.normalizedDeviceId;

    // Generate verification token
    const verificationToken = generateVerificationToken(
      normalizedEmail,
      normalizedDeviceId
    );

    // Store or update pending auth request
    await PendingAuth.findOneAndUpdate(
      { email: normalizedEmail, deviceId: normalizedDeviceId },
      {
        token: verificationToken,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
      },
      { upsert: true, new: true }
    );

    // Send verification email
    const emailSent = await sendEmail(
      normalizedEmail,
      'Watchtower 24/7 - Verify Your Device',
      generateVerificationEmail(verificationToken, normalizedEmail)
    );

    if (!emailSent) {
      return res
        .status(500)
        .json({ error: 'Failed to send verification email' });
    }

    // Success response
    res.status(200).json({
      message: 'Verification email sent successfully',
      expiresIn: 600,
      token: verificationToken,
    });
  } catch (error) {
    console.error('Auth request error:', error);
    res.status(500).json({
      error: 'Internal server error. Please try again later.',
    });
  }
});


// Verify token
router.post('/verify', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { email, deviceId } = decoded;

    const pendingAuth = await PendingAuth.findOneAndDelete({
      email, deviceId, token
    });

    if (!pendingAuth) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    await User.findOneAndUpdate(
      { email, deviceId },
      { 
        email, 
        deviceId, 
        verified: true 
      },
      { upsert: true, new: true }
    );

    const permanentToken = generateToken(email, deviceId);

    const cookieOptions = {
      httpOnly: true,
      secure: 'true',
      maxAge: 365 * 24 * 60 * 60 * 1000, // 365 days
      sameSite:'none'  
    };

    res.cookie('authToken', permanentToken, cookieOptions);
    res.json({ message: 'Device verified successfully', verified: true });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// Check if device is verified
router.get('/check', async (req, res) => {
  try {
    const { deviceId, email } = req.query;

    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error });
    }

    const deviceValidation = validateDeviceId(deviceId);
    if (!deviceValidation.valid) {
      return res.status(400).json({ error: deviceValidation.error });
    }

    const user = await User.findOne({
      email: emailValidation.normalizedEmail,
      deviceId: deviceValidation.normalizedDeviceId,
      verified: true
    });

    if (user) {
      const permanentToken = generateToken(user.email, user.deviceId);
      
      const cookieOptions = {
        httpOnly: true,
        secure: 'true',
        maxAge: 365 * 24 * 60 * 60 * 1000,
        sameSite: 'none',
      };

      res.cookie('authToken', permanentToken, cookieOptions);
      return res.json({ verified: true });
    }

    res.json({ verified: false });
  } catch (error) {
    console.error('Verification check error:', error);
    res.status(500).json({ error: 'Verification check failed' });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const cookieOptions = {
      httpOnly: true,
      secure: 'true',
      sameSite: 'none',
    };

    res.clearCookie('authToken', cookieOptions);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;