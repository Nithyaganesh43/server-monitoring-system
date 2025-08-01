const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const {
  generateVerificationEmail,
  generateServerDownAlert,
  generateSuccessPage,
  generateErrorPage,
} = require('./emails');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: 'https://watchtower-24-7.vercel.app',
    credentials: true,
  })
);

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_ID,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET; 

// Database Models
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  maxServerCount: { type: Number, default: 10 },
  verifiedDevices: [
    {
      deviceId: String,
      verifiedAt: { type: Date, default: Date.now },
      isActive: { type: Boolean, default: true },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

const serverSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, index: true },
  url: { type: String, required: true },
  index: { type: Number, required: true },
  pingCount: { type: Number, default: 0 },
  lastPingTime: { type: Date },
  responseTime: { type: Number },
  uptime: { type: Number, default: 0 }, // Percentage uptime
  totalPings: { type: Number, default: 0 },
  successfulPings: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['online', 'offline', 'checking', 'paused'],
    default: 'checking',
  },
  alert: { type: Boolean, default: false },
  alertSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastFailureTime: { type: Date },
  isActive: { type: Boolean, default: true },
  // NEW FIELDS FOR 3-STRIKE SYSTEM
  consecutiveFailures: { type: Number, default: 0 },
  isPaused: { type: Boolean, default: false },
  pausedAt: { type: Date },
  // Optimistic locking for race conditions
  version: { type: Number, default: 0 },
});

// FIXED: Add compound unique index for per-user unique URLs
serverSchema.index({ userEmail: 1, url: 1 }, { unique: true });
serverSchema.index({ userEmail: 1, isActive: 1 });
serverSchema.index({ isActive: 1, lastPingTime: 1 });
serverSchema.index({ isActive: 1, isPaused: 1 });

// Ping history schema for detailed tracking
const pingHistorySchema = new mongoose.Schema({
  serverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Server',
    required: true,
    index: true,
  },
  userEmail: { type: String, required: true, index: true },
  pingTime: { type: Date, default: Date.now, index: true },
  responseTime: { type: Number, required: true },
  isSuccess: { type: Boolean, required: true },
  statusCode: { type: Number },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now, expires: 2592000 }, // 30 days TTL
});

const pendingAuthSchema = new mongoose.Schema({
  email: { type: String, required: true },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, default: Date.now, expires: 600 }, // 10 minutes
});

// Create additional indexes for optimization
pingHistorySchema.index({ serverId: 1, pingTime: -1 });
pingHistorySchema.index({ userEmail: 1, pingTime: -1 });

const User = mongoose.model('User', userSchema);
const Server = mongoose.model('Server', serverSchema);
const PingHistory = mongoose.model('PingHistory', pingHistorySchema);
const PendingAuth = mongoose.model('PendingAuth', pendingAuthSchema);

// Utility Functions
const generateToken = (email, deviceId) => {
  return jwt.sign({ email, deviceId }, JWT_SECRET, { expiresIn: '30d' });
};

// FIXED: Enhanced URL validation function
const validateUrl = (url) => {
  try {
    // Check if URL starts with http:// or https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { valid: false, error: 'URL must start with http:// or https://' };
    }

    // Parse URL to validate structure
    const parsedUrl = new URL(url);

    // Check for valid protocol
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        valid: false,
        error: 'Invalid protocol. Only HTTP and HTTPS are allowed.',
      };
    }

    // Check for valid hostname
    if (!parsedUrl.hostname || parsedUrl.hostname.length === 0) {
      return { valid: false, error: 'Invalid hostname' };
    }

    // Additional validation rules
    if (
      parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname.startsWith('127.')
    ) {
      return { valid: false, error: 'Localhost URLs are not allowed' };
    }

    return { valid: true, normalizedUrl: url.trim() };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
};

const sendEmail = async (to, subject, html) => {
  try {
    console.log(`Attempting to send email to: ${to}`);
    console.log(`Email subject: ${subject}`);

    const mailOptions = {
      from: process.env.EMAIL_ID,
      to,
      subject,
      html,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(
      `✅ Email sent successfully to ${to}, MessageId: ${result.messageId}`
    );
    return result;
  } catch (error) {
    console.error(`❌ Email sending failed to ${to}:`, error);

    // Log specific error details
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    if (error.response) {
      console.error(`SMTP Response: ${error.response}`);
    }

    throw error; // Re-throw to handle in calling function
  }
};

const pingServer = async (serverUrl) => {
  const startTime = Date.now();
  try {
    const response = await axios.get(serverUrl, {
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });
    const responseTime = Date.now() - startTime;
    return {
      success: true,
      responseTime,
      statusCode: response.status,
      errorMessage: null,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      success: false,
      responseTime,
      statusCode: error.response?.status || null,
      errorMessage: error.message,
    };
  }
};

// Optimized function to update server with race condition handling
const updateServerWithRetry = async (serverId, updateData, maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const server = await Server.findById(serverId);
      if (!server) throw new Error('Server not found');

      // Optimistic locking - check version
      const result = await Server.findOneAndUpdate(
        { _id: serverId, version: server.version },
        {
          ...updateData,
          version: server.version + 1,
        },
        { new: true }
      );

      if (result) {
        return result;
      }

      // Version mismatch, retry
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 100)
        );
        continue;
      }
      throw new Error('Unable to update server after retries');
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
    }
  }
};

// Function to maintain ping history limit per server
const maintainPingHistoryLimit = async (serverId, limit = 150000) => {
  try {
    const count = await PingHistory.countDocuments({ serverId });
    if (count > limit) {
      const excessCount = count - limit;
      const oldestPings = await PingHistory.find({ serverId })
        .sort({ pingTime: 1 })
        .limit(excessCount)
        .select('_id');

      const idsToDelete = oldestPings.map((ping) => ping._id);
      await PingHistory.deleteMany({ _id: { $in: idsToDelete } });
      console.log(
        `Cleaned up ${excessCount} old ping records for server ${serverId}`
      );
    }
  } catch (error) {
    console.error('Error maintaining ping history limit:', error);
  }
};

// Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies.authToken;
    if (!token) {
      return res
        .status(401)
        .json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ email: decoded.email });

    if (!user) {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    const deviceExists = user.verifiedDevices.some(
      (device) => device.deviceId === decoded.deviceId && device.isActive
    );

    if (!deviceExists) {
      return res.status(401).json({ error: 'Device not verified.' });
    }

    req.user = {
      email: decoded.email,
      deviceId: decoded.deviceId,
      maxServerCount: user.maxServerCount,
    };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// Routes

// 1. Authentication Routes
app.post('/auth/request', async (req, res) => {
  try {
    const { email, deviceId } = req.body;

    if (!email || !deviceId) {
      return res.status(400).json({ error: 'Email and deviceId are required' });
    }

    // Generate verification token
    const verificationToken = jwt.sign({ email, deviceId }, JWT_SECRET, {
      expiresIn: '10m',
    });

    // Save pending auth with upsert to handle race conditions
    await PendingAuth.findOneAndUpdate(
      { email, deviceId },
      { token: verificationToken, expiresAt: new Date(Date.now() + 600000) },
      { upsert: true, new: true }
    );

    // FIXED: Send verification email with API endpoint instead of frontend redirect
    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email?token=${verificationToken}`;

    const emailHtml = generateVerificationEmail(verificationUrl);

    await sendEmail(email, 'Server Monitor - Verify Your Device', emailHtml);

    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    console.error('Auth request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// FIXED: New email verification endpoint that shows success page instead of redirecting
app.get('/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res
        .status(400)
        .send(
          generateErrorPage(
            'Verification Failed',
            'No verification token provided. Please try requesting verification again.'
          )
        );
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    const { email, deviceId } = decoded;

    // Check if pending auth exists
    const pendingAuth = await PendingAuth.findOne({ email, deviceId, token });
    if (!pendingAuth) {
      return res
        .status(400)
        .send(
          generateErrorPage(
            'Verification Failed',
            'Invalid or expired verification token. Please try requesting verification again.'
          )
        );
    }

    // Use session for transaction to handle race conditions
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Create or update user
        let user = await User.findOne({ email }).session(session);
        if (!user) {
          user = new User({ email, verifiedDevices: [] });
        }

        // Add or update device
        const existingDeviceIndex = user.verifiedDevices.findIndex(
          (device) => device.deviceId === deviceId
        );

        if (existingDeviceIndex >= 0) {
          user.verifiedDevices[existingDeviceIndex].isActive = true;
          user.verifiedDevices[existingDeviceIndex].verifiedAt = new Date();
        } else {
          user.verifiedDevices.push({ deviceId, verifiedAt: new Date() });
        }

        await user.save({ session });

        // Remove pending auth
        await PendingAuth.deleteOne({ _id: pendingAuth._id }).session(session);
      });
    } finally {
      await session.endSession();
    }

    // Generate permanent token
    const permanentToken = generateToken(email, deviceId);

    // FIXED: Show success page instead of redirecting
    res.send(generateSuccessPage(permanentToken));
  } catch (error) {
    console.error('Email verification error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res
        .status(400)
        .send(
          generateErrorPage(
            'Verification Failed',
            'Invalid verification token. Please try requesting verification again.'
          )
        );
    }
    res
      .status(500)
      .send(
        generateErrorPage(
          'Verification Error',
          'An error occurred during verification. Please try again later.'
        )
      );
  }
});

app.post('/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    const { email, deviceId } = decoded;

    // Check if pending auth exists
    const pendingAuth = await PendingAuth.findOne({ email, deviceId, token });
    if (!pendingAuth) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // Use session for transaction to handle race conditions
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Create or update user
        let user = await User.findOne({ email }).session(session);
        if (!user) {
          user = new User({ email, verifiedDevices: [] });
        }

        // Add or update device
        const existingDeviceIndex = user.verifiedDevices.findIndex(
          (device) => device.deviceId === deviceId
        );

        if (existingDeviceIndex >= 0) {
          user.verifiedDevices[existingDeviceIndex].isActive = true;
          user.verifiedDevices[existingDeviceIndex].verifiedAt = new Date();
        } else {
          user.verifiedDevices.push({ deviceId, verifiedAt: new Date() });
        }

        await user.save({ session });

        // Remove pending auth
        await PendingAuth.deleteOne({ _id: pendingAuth._id }).session(session);
      });
    } finally {
      await session.endSession();
    }

    // Generate permanent token
    const permanentToken = generateToken(email, deviceId);

    // Set cookie
    res.cookie('authToken', permanentToken, {
      httpOnly: true,
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'None',
    });

    res.json({ message: 'Device verified successfully', verified: true });
  } catch (error) {
    console.error('Verification error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Invalid token' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/auth/isVerified', async (req, res) => {
  try {
    const { deviceId, email } = req.query;

    if (!deviceId || !email) {
      return res.status(400).json({ error: 'DeviceId and email are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ verified: false });
    }

    const device = user.verifiedDevices.find(
      (device) => device.deviceId === deviceId && device.isActive
    );

    if (device) {
      // Generate and set permanent token
      const permanentToken = generateToken(email, deviceId);
      res.cookie('authToken', permanentToken, {
        httpOnly: true,
        secure: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: 'None',
      });
      return res.json({ verified: true });
    }

    res.json({ verified: false });
  } catch (error) {
    console.error('IsVerified error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    // Clear cookie
    res.clearCookie('authToken');

    // Optionally deactivate device
    await User.findOneAndUpdate(
      {
        email: req.user.email,
        'verifiedDevices.deviceId': req.user.deviceId,
      },
      {
        $set: { 'verifiedDevices.$.isActive': false },
      }
    );

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Server Management Routes
app.post('/server/new', authenticateToken, async (req, res) => {
  try {
    const { url, alert = false } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // FIXED: Validate URL format and protocol
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }

    const normalizedUrl = urlValidation.normalizedUrl;

    // FIXED: Check for duplicate URL for this user
    const existingServer = await Server.findOne({
      userEmail: req.user.email,
      url: normalizedUrl,
      isActive: true,
    });

    if (existingServer) {
      return res.status(400).json({
        error:
          'This URL is already being monitored by you. Each user can only monitor unique URLs.',
      });
    }

    // Check server count limit using user's maxServerCount
    const serverCount = await Server.countDocuments({
      userEmail: req.user.email,
      isActive: true,
    });

    if (serverCount >= req.user.maxServerCount) {
      return res.status(400).json({
        error: `Maximum server limit (${req.user.maxServerCount}) reached`,
      });
    }

    // Get next index
    const lastServer = await Server.findOne({
      userEmail: req.user.email,
    }).sort({ index: -1 });

    const nextIndex = lastServer ? lastServer.index + 1 : 0;

    // Create new server
    const server = new Server({
      userEmail: req.user.email,
      url: normalizedUrl,
      index: nextIndex,
      alert,
      consecutiveFailures: 0,
      isPaused: false,
    });

    try {
      await server.save();
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          error: 'This URL is already being monitored by you.',
        });
      }
      throw error;
    }

    // Initial ping
    const pingResult = await pingServer(normalizedUrl);
    console.log(
      `Initial ping for ${normalizedUrl}: Success=${pingResult.success}, ResponseTime=${pingResult.responseTime}ms`
    );

    // Update server with ping result
    const updateData = {
      pingCount: 1,
      totalPings: 1,
      successfulPings: pingResult.success ? 1 : 0,
      lastPingTime: new Date(),
      responseTime: pingResult.responseTime,
      status: pingResult.success ? 'online' : 'offline',
      uptime: pingResult.success ? 100 : 0,
      consecutiveFailures: pingResult.success ? 0 : 1,
    };

    if (!pingResult.success) {
      updateData.lastFailureTime = new Date();
    }

    const updatedServer = await updateServerWithRetry(server._id, updateData);
    console.log(
      `Server ${normalizedUrl} status updated to: ${updateData.status}`
    );

    // Create ping history record
    await PingHistory.create({
      serverId: server._id,
      userEmail: req.user.email,
      responseTime: pingResult.responseTime,
      isSuccess: pingResult.success,
      statusCode: pingResult.statusCode,
      errorMessage: pingResult.errorMessage,
    });

    const finalServer = await Server.findById(server._id).select(
      'url index status responseTime uptime pingCount totalPings successfulPings alert consecutiveFailures isPaused'
    );

    res.json({
      message: 'Server added successfully',
      server: finalServer,
    });
  } catch (error) {
    console.error('Add server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/server/data', authenticateToken, async (req, res) => {
  try {
    const servers = await Server.find({
      userEmail: req.user.email,
      isActive: true,
    }).select(
      'url index status responseTime uptime pingCount totalPings successfulPings lastPingTime createdAt lastFailureTime alert alertSent consecutiveFailures isPaused pausedAt'
    );

    // Get recent ping history for each server (last 24 hours)
    const serverIds = servers.map((s) => s._id);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentPings = await PingHistory.find({
      serverId: { $in: serverIds },
      pingTime: { $gte: oneDayAgo },
    })
      .select('serverId responseTime isSuccess pingTime')
      .sort({ pingTime: -1 });

    // Group ping history by server
    const pingsByServer = recentPings.reduce((acc, ping) => {
      const serverId = ping.serverId.toString();
      if (!acc[serverId]) acc[serverId] = [];
      acc[serverId].push(ping);
      return acc;
    }, {});

    // Add ping history to server data
    const serversWithPings = servers.map((server) => ({
      ...server.toObject(),
      recentPings: pingsByServer[server._id.toString()] || [],
    }));

    res.json({
      servers: serversWithPings,
      maxServerCount: req.user.maxServerCount,
    });
  } catch (error) {
    console.error('Get servers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/server/edit/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { url, alert } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // FIXED: Validate URL format and protocol
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }

    const normalizedUrl = urlValidation.normalizedUrl;

    // FIXED: Check for duplicate URL for this user (excluding current server)
    const existingServer = await Server.findOne({
      userEmail: req.user.email,
      url: normalizedUrl,
      isActive: true,
      _id: { $ne: id },
    });

    if (existingServer) {
      return res.status(400).json({
        error: 'This URL is already being monitored by you.',
      });
    }

    const updateData = {
      url: normalizedUrl,
      status: 'checking',
      alertSent: false,
      consecutiveFailures: 0,
      isPaused: false,
      pausedAt: null,
    };

    if (typeof alert !== 'undefined') {
      updateData.alert = alert;
    }

    const server = await Server.findOneAndUpdate(
      { _id: id, userEmail: req.user.email, isActive: true },
      updateData,
      { new: true }
    ).select(
      'url index status responseTime uptime alert consecutiveFailures isPaused'
    );

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json({ message: 'Server updated successfully', server });
  } catch (error) {
    console.error('Edit server error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        error: 'This URL is already being monitored by you.',
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Server deletion route (unchanged)
app.delete('/server/delete/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid server ID format' });
    }

    // First, verify the server exists and belongs to the user
    const serverToDelete = await Server.findOne({
      _id: id,
      userEmail: req.user.email,
      isActive: true,
    });

    if (!serverToDelete) {
      return res
        .status(404)
        .json({ error: 'Server not found or access denied' });
    }

    const session = await mongoose.startSession();

    try {
      let deletedServer = null;

      await session.withTransaction(async () => {
        // Soft delete the server with proper ownership check
        deletedServer = await Server.findOneAndUpdate(
          {
            _id: id,
            userEmail: req.user.email,
            isActive: true,
          },
          {
            isActive: false,
            $inc: { version: 1 },
          },
          {
            new: true,
            session,
          }
        );

        if (!deletedServer) {
          throw new Error('Server not found or access denied');
        }

        // Delete associated ping history to save space
        const deleteResult = await PingHistory.deleteMany({
          serverId: id,
        }).session(session);

        console.log(
          `Deleted ${deleteResult.deletedCount} ping history records for server ${id}`
        );
      });

      console.log(
        `Successfully deleted server: ${deletedServer.url} (ID: ${id}) for user: ${req.user.email}`
      );

      res.json({
        message: 'Server deleted successfully',
        deletedServer: {
          id: deletedServer._id,
          url: deletedServer.url,
          index: deletedServer.index,
        },
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.error('Delete server error:', error);
    if (error.message === 'Server not found or access denied') {
      return res
        .status(404)
        .json({ error: 'Server not found or access denied' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MODIFIED: Restart route now resets the 3-strike system
app.post('/server/restart/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const server = await updateServerWithRetry(id, {
      alertSent: false,
      status: 'checking',
      consecutiveFailures: 0,
      isPaused: false,
      pausedAt: null,
    });

    if (!server || server.userEmail !== req.user.email || !server.isActive) {
      return res.status(404).json({ error: 'Server not found' });
    }

    console.log(
      `Server monitoring restarted for: ${server.url} - Reset 3-strike counter`
    );

    res.json({ message: 'Server monitoring restarted successfully' });
  } catch (error) {
    console.error('Restart server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Database connection and server monitoring
const connectToDb = () => {
  return mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
};

// NEW: Enhanced server monitoring with 3-strike system
const startServerMonitoring = () => {
  cron.schedule('*/5 * * * *', async () => {
    console.log('Running server monitoring check...');

    try {
      // Only monitor servers that are active AND not paused
      const servers = await Server.find({
        isActive: true,
        isPaused: false,
      }).lean();

      if (servers.length === 0) {
        console.log('No active servers to monitor');
        return;
      }

      console.log(`Monitoring ${servers.length} servers...`);

      // Process servers in batches to avoid overwhelming
      const batchSize = 50;
      const batches = [];
      for (let i = 0; i < servers.length; i += batchSize) {
        batches.push(servers.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        // Ping servers in parallel within batch
        const pingPromises = batch.map(async (server) => {
          const pingResult = await pingServer(server.url);
          return {
            serverId: server._id,
            server,
            pingResult,
          };
        });

        const results = await Promise.allSettled(pingPromises);

        // Prepare bulk operations
        const serverUpdates = [];
        const pingHistories = [];
        const emailAlerts = [];

        for (const result of results) {
          if (result.status === 'rejected') {
            console.error('Ping failed:', result.reason);
            continue;
          }

          const { serverId, server, pingResult } = result.value;

          // Calculate new uptime
          const newTotalPings = (server.totalPings || 0) + 1;
          const newSuccessfulPings =
            (server.successfulPings || 0) + (pingResult.success ? 1 : 0);
          const newUptime =
            newTotalPings > 0 ? (newSuccessfulPings / newTotalPings) * 100 : 0;

          // Calculate consecutive failures
          let newConsecutiveFailures = server.consecutiveFailures || 0;
          let shouldPause = false;
          let shouldSendAlert = false;

          if (pingResult.success) {
            // Reset consecutive failures on success
            newConsecutiveFailures = 0;
          } else {
            // Increment consecutive failures on failure
            newConsecutiveFailures += 1;

            // Check if we should pause after 3 failures
            if (newConsecutiveFailures >= 3 && !server.isPaused) {
              shouldPause = true;
              shouldSendAlert =
                server.alert === true && server.alertSent !== true;
              console.log(
                `🚨 Server ${server.url} failed 3 times - PAUSING monitoring`
              );
            }
          }

          // Prepare server update
          const updateData = {
            pingCount: (server.pingCount || 0) + 1,
            totalPings: newTotalPings,
            successfulPings: newSuccessfulPings,
            lastPingTime: new Date(),
            responseTime: pingResult.responseTime,
            uptime: parseFloat(newUptime.toFixed(2)),
            status: pingResult.success ? 'online' : 'offline',
            consecutiveFailures: newConsecutiveFailures,
          };

          if (shouldPause) {
            updateData.isPaused = true;
            updateData.pausedAt = new Date();
            updateData.status = 'paused';
            updateData.alertSent = true;
          }

          if (!pingResult.success) {
            updateData.lastFailureTime = new Date();
          } else {
            // Reset alert when server comes back online
            if (server.alertSent) {
              updateData.alertSent = false;
              console.log(
                `Server ${server.url} is back online - resetting alert flag`
              );
            }
          }

          // Send alert only when pausing (after 3rd failure)
          if (shouldSendAlert) {
            console.log(`Preparing 3-strike alert for server ${server.url}`);
            emailAlerts.push({
              userEmail: server.userEmail,
              server: server,
              pingResult: pingResult,
              serverId: serverId,
              failureCount: newConsecutiveFailures,
            });
          }

          serverUpdates.push({
            updateOne: {
              filter: { _id: serverId, version: server.version },
              update: {
                $set: updateData,
                $inc: { version: 1 },
              },
            },
          });

          // Prepare ping history
          pingHistories.push({
            serverId: serverId,
            userEmail: server.userEmail,
            responseTime: pingResult.responseTime,
            isSuccess: pingResult.success,
            statusCode: pingResult.statusCode,
            errorMessage: pingResult.errorMessage,
          });
        }

        // Execute bulk operations
        if (serverUpdates.length > 0) {
          try {
            const bulkResult = await Server.bulkWrite(serverUpdates, {
              ordered: false,
            });
            console.log(
              `Bulk server updates: ${bulkResult.modifiedCount} modified, ${bulkResult.upsertedCount} upserted`
            );
          } catch (error) {
            console.error('Bulk server update error:', error);
            // Log individual update failures
            if (error.writeErrors) {
              error.writeErrors.forEach((writeError) => {
                console.error(`Failed to update server: ${writeError.err}`);
              });
            }
          }
        }

        if (pingHistories.length > 0) {
          try {
            await PingHistory.insertMany(pingHistories, { ordered: false });
          } catch (error) {
            console.error('Bulk ping history insert error:', error);
          }
        }

        // NEW: Send 3-strike alerts
        for (const alertData of emailAlerts) {
          try {
            console.log(
              `🚨 Sending 3-strike alert email for server: ${alertData.server.url} to ${alertData.userEmail}`
            );
            const restartUrl = `https://watchtower-24-7.vercel.app/restart/${alertData.serverId}`;

            const alertHtml = generateServerDownAlert(
              alertData.server,
              alertData.pingResult,
              restartUrl,
              alertData.failureCount
            );

            await sendEmail(
              alertData.userEmail,
              `🚨 Server Down Alert: ${alertData.server.url} (Failed ${alertData.failureCount} times)`,
              alertHtml
            );

            console.log(
              `✅ 3-strike alert email sent successfully for server: ${alertData.server.url} to ${alertData.userEmail}`
            );
          } catch (error) {
            console.error(
              `❌ CRITICAL: Failed to send 3-strike alert email for ${alertData.server.url} to ${alertData.userEmail}:`,
              error
            );

            // If email sending fails, reset alertSent and isPaused so we can try again
            try {
              await Server.findByIdAndUpdate(
                alertData.serverId,
                {
                  alertSent: false,
                  isPaused: false,
                  pausedAt: null,
                },
                { new: true }
              );
              console.log(
                `Reset alert flags for server ${alertData.server.url} due to email failure`
              );
            } catch (resetError) {
              console.error(
                `Failed to reset alert flags for server ${alertData.serverId}:`,
                resetError
              );
            }
          }
        }

        console.log(
          `Processed batch: ${emailAlerts.length} 3-strike alerts sent`
        );

        // Small delay between batches
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      console.log(
        `✅ Monitoring check completed for ${servers.length} servers`
      );

      // Clean up old ping histories in background
      setTimeout(async () => {
        try {
          const serverIds = servers.map((s) => s._id);
          for (const serverId of serverIds) {
            await maintainPingHistoryLimit(serverId, 150000);
          }
        } catch (error) {
          console.error('Error in ping history cleanup:', error);
        }
      }, 5000);
    } catch (error) {
      console.error('❌ Server monitoring error:', error);
    }
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Get ping history for a specific server
app.get('/server/history/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100, page = 1, timeRange = '24h' } = req.query;

    // Verify server ownership
    const server = await Server.findOne({
      _id: id,
      userEmail: req.user.email,
      isActive: true,
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Calculate time range
    let startTime;
    const now = new Date();
    switch (timeRange) {
      case '1h':
        startTime = new Date(now - 60 * 60 * 1000);
        break;
      case '6h':
        startTime = new Date(now - 6 * 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now - 24 * 60 * 60 * 1000);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const pingHistory = await PingHistory.find({
      serverId: id,
      pingTime: { $gte: startTime },
    })
      .select('pingTime responseTime isSuccess statusCode errorMessage')
      .sort({ pingTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await PingHistory.countDocuments({
      serverId: id,
      pingTime: { $gte: startTime },
    });

    // Calculate statistics
    const stats = await PingHistory.aggregate([
      {
        $match: {
          serverId: new mongoose.Types.ObjectId(id),
          pingTime: { $gte: startTime },
        },
      },
      {
        $group: {
          _id: null,
          totalPings: { $sum: 1 },
          successfulPings: { $sum: { $cond: ['$isSuccess', 1, 0] } },
          avgResponseTime: { $avg: '$responseTime' },
          minResponseTime: { $min: '$responseTime' },
          maxResponseTime: { $max: '$responseTime' },
        },
      },
    ]);

    const statistics = stats[0] || {
      totalPings: 0,
      successfulPings: 0,
      avgResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
    };

    statistics.uptime =
      statistics.totalPings > 0
        ? (statistics.successfulPings / statistics.totalPings) * 100
        : 0;

    res.json({
      server: {
        _id: server._id,
        url: server.url,
        index: server.index,
      },
      history: pingHistory,
      statistics,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit)),
      },
      timeRange,
    });
  } catch (error) {
    console.error('Get ping history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get aggregated statistics for all user servers
app.get('/server/stats', authenticateToken, async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;

    // Calculate time range
    let startTime;
    const now = new Date();
    switch (timeRange) {
      case '1h':
        startTime = new Date(now - 60 * 60 * 1000);
        break;
      case '6h':
        startTime = new Date(now - 6 * 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now - 24 * 60 * 60 * 1000);
    }

    // Get user's servers
    const servers = await Server.find({
      userEmail: req.user.email,
      isActive: true,
    }).select('_id url index status uptime consecutiveFailures isPaused');

    const serverIds = servers.map((s) => s._id);

    // Get aggregated statistics
    const stats = await PingHistory.aggregate([
      {
        $match: {
          serverId: { $in: serverIds },
          pingTime: { $gte: startTime },
        },
      },
      {
        $group: {
          _id: '$serverId',
          totalPings: { $sum: 1 },
          successfulPings: { $sum: { $cond: ['$isSuccess', 1, 0] } },
          avgResponseTime: { $avg: '$responseTime' },
          minResponseTime: { $min: '$responseTime' },
          maxResponseTime: { $max: '$responseTime' },
          lastPing: { $max: '$pingTime' },
        },
      },
    ]);

    // Combine server info with statistics
    const serverStats = servers.map((server) => {
      const stat = stats.find(
        (s) => s._id.toString() === server._id.toString()
      ) || {
        totalPings: 0,
        successfulPings: 0,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        lastPing: null,
      };

      return {
        ...server.toObject(),
        statistics: {
          ...stat,
          uptime:
            stat.totalPings > 0
              ? (stat.successfulPings / stat.totalPings) * 100
              : 0,
        },
      };
    });

    // Calculate overall statistics
    const overallStats = stats.reduce(
      (acc, stat) => {
        acc.totalPings += stat.totalPings;
        acc.successfulPings += stat.successfulPings;
        acc.totalResponseTime += stat.avgResponseTime * stat.totalPings;
        return acc;
      },
      { totalPings: 0, successfulPings: 0, totalResponseTime: 0 }
    );

    const overall = {
      totalServers: servers.length,
      activeServers: servers.filter((s) => s.status === 'online').length,
      pausedServers: servers.filter((s) => s.isPaused === true).length,
      totalPings: overallStats.totalPings,
      overallUptime:
        overallStats.totalPings > 0
          ? (overallStats.successfulPings / overallStats.totalPings) * 100
          : 0,
      avgResponseTime:
        overallStats.totalPings > 0
          ? overallStats.totalResponseTime / overallStats.totalPings
          : 0,
    };

    res.json({
      servers: serverStats,
      overall,
      timeRange,
      maxServerCount: req.user.maxServerCount,
    });
  } catch (error) {
    console.error('Get server stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
connectToDb()
  .then(() => {
    console.log('Connected to MongoDB successfully');

    // Create indexes for better performance
    Server.createIndexes();
    PingHistory.createIndexes();
    User.createIndexes();
    PendingAuth.createIndexes();

    // Start monitoring
    startServerMonitoring();
    console.log('Server monitoring cron job started (every 5 minutes)');

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log('📊 Available routes:');
      console.log('🔐 Authentication:');
      console.log('  POST /auth/request - Request device verification');
      console.log('  GET /auth/verify-email - Email verification endpoint');
      console.log('  POST /auth/verify - Verify device with token');
      console.log('  GET /auth/isVerified - Check if device is verified');
      console.log('  POST /auth/logout - Logout and deactivate device');
      console.log('🖥️  Server Management:');
      console.log('  POST /server/new - Add new server to monitor');
      console.log('  GET /server/data - Get all user servers');
      console.log(
        '  PUT /server/edit/:id - Edit server URL and alert settings'
      );
      console.log('  DELETE /server/delete/:id - Delete server');
      console.log(
        '  POST /server/restart/:id - Restart server monitoring (resets 3-strike system)'
      );
      console.log('  GET /server/history/:id - Get server ping history');
      console.log('  GET /server/stats - Get aggregated server statistics');
      console.log('💚 Health:');
      console.log('  GET /health - Health check');
      console.log('\n✅ NEW 3-STRIKE SYSTEM IMPLEMENTED:');
      console.log('  • Server monitoring pauses after 3 consecutive failures');
      console.log('  • Single alert email sent when server reaches 3 strikes');
      console.log('  • No more monitoring until user manually restarts');
      console.log('  • Enhanced email templates with modern styling');
      console.log('  • Restart button resets consecutive failure counter');
      console.log(
        '  • Added consecutiveFailures and isPaused fields to server schema'
      );
      console.log('  • Paused servers excluded from monitoring loop');
      console.log('  • Alert sent only once when threshold is reached');
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  setTimeout(() => {
    console.error(
      'Could not close connections in time, forcefully shutting down'
    );
    process.exit(1);
  }, 10000);
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
