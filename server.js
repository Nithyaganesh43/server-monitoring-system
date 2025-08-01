//https://servermonitoringsystembyng.onrender.com


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

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: 'https://watchtower-24-7.vercel.app',
    credentials: true,
  })
);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_ID,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

const JWT_SECRET = process.env.JWT_SECRET;

// Validate critical environment variables
if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET environment variable is not set');
  process.exit(1);
}

if (!process.env.MONGO_URL) {
  console.error('FATAL ERROR: MONGO_URL environment variable is not set');
  process.exit(1);
}

if (!process.env.EMAIL_ID || !process.env.EMAIL_APP_PASSWORD) {
  console.error('FATAL ERROR: EMAIL_ID and EMAIL_APP_PASSWORD environment variables are required');
  process.exit(1);
}

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
  uptime: { type: Number, default: 0 },
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
  consecutiveFailures: { type: Number, default: 0 },
  isPaused: { type: Boolean, default: false },
  pausedAt: { type: Date },
  version: { type: Number, default: 0 },
});

serverSchema.index({ userEmail: 1, url: 1 }, { unique: true });
serverSchema.index({ userEmail: 1, isActive: 1 });
serverSchema.index({ isActive: 1, lastPingTime: 1 });
serverSchema.index({ isActive: 1, isPaused: 1 });

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
  createdAt: { type: Date, default: Date.now, expires: 2592000 },
});

const pendingAuthSchema = new mongoose.Schema({
  email: { type: String, required: true },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, default: Date.now, expires: 600 },
});

pingHistorySchema.index({ serverId: 1, pingTime: -1 });
pingHistorySchema.index({ userEmail: 1, pingTime: -1 });

const User = mongoose.model('User', userSchema);
const Server = mongoose.model('Server', serverSchema);
const PingHistory = mongoose.model('PingHistory', pingHistorySchema);
const PendingAuth = mongoose.model('PendingAuth', pendingAuthSchema);

const generateToken = (email, deviceId) => {
  return jwt.sign({ email, deviceId }, JWT_SECRET, { expiresIn: '30d' });
};

const validateUrl = (url) => {
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { valid: false, error: 'URL must start with http:// or https://' };
    }

    const parsedUrl = new URL(url);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        valid: false,
        error: 'Invalid protocol. Only HTTP and HTTPS are allowed.',
      };
    }

    if (!parsedUrl.hostname || parsedUrl.hostname.length === 0) {
      return { valid: false, error: 'Invalid hostname' };
    }

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
    const mailOptions = {
      from: process.env.EMAIL_ID,
      to,
      subject,
      html,
    };

    const result = await transporter.sendMail(mailOptions);
    return result;
  } catch (error) {
    throw error;
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

const updateServerWithRetry = async (serverId, updateData, maxRetries = 3) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const server = await Server.findById(serverId);
      if (!server) throw new Error('Server not found');

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

const maintainPingHistoryLimit = async (serverId, limit = 150000) => {
  try {
    const count = await PingHistory.countDocuments({ serverId });
    if (count > limit) {
      const excessCount = count - limit;
      
      // Use batch deletion to avoid memory issues with large datasets
      const batchSize = 1000;
      let deletedCount = 0;
      
      while (deletedCount < excessCount) {
        const currentBatchSize = Math.min(batchSize, excessCount - deletedCount);
        
        // Delete oldest records in batches to prevent memory overload
        const result = await PingHistory.deleteMany(
          { serverId },
          {
            sort: { pingTime: 1 },
            limit: currentBatchSize
          }
        );
        
        if (result.deletedCount === 0) {
          break; // No more records to delete
        }
        
        deletedCount += result.deletedCount;
        
        // Small delay between batches to prevent overwhelming the database
        if (deletedCount < excessCount) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  } catch (error) {
    // Log errors instead of silently swallowing them
    console.error(`Error maintaining ping history limit for server ${serverId}:`, error.message);
  }
};

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

app.post('/auth/request', async (req, res) => {
  try {
    const { email, deviceId } = req.body;

    if (!email || !deviceId) {
      return res.status(400).json({ error: 'Email and deviceId are required' });
    }

    const verificationToken = jwt.sign({ email, deviceId }, JWT_SECRET, {
      expiresIn: '10m',
    });

    await PendingAuth.findOneAndUpdate(
      { email, deviceId },
      { token: verificationToken, expiresAt: new Date(Date.now() + 600000) },
      { upsert: true, new: true }
    );

    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email?token=${verificationToken}`;

    const emailHtml = generateVerificationEmail(verificationUrl);

    await sendEmail(email, 'Server Monitor - Verify Your Device', emailHtml);

    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

    const decoded = jwt.verify(token, JWT_SECRET);
    const { email, deviceId } = decoded;

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

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        let user = await User.findOne({ email }).session(session);
        if (!user) {
          user = new User({ email, verifiedDevices: [] });
        }

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

        await PendingAuth.deleteOne({ _id: pendingAuth._id }).session(session);
      });
    } finally {
      await session.endSession();
    }

    const permanentToken = generateToken(email, deviceId);

    // Set authentication cookie for successful verification
    res.cookie('authToken', permanentToken, {
      httpOnly: true,
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'None',
    });

    res.send(generateSuccessPage(permanentToken));
  } catch (error) {
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

    const decoded = jwt.verify(token, JWT_SECRET);
    const { email, deviceId } = decoded;

    const pendingAuth = await PendingAuth.findOne({ email, deviceId, token });
    if (!pendingAuth) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        let user = await User.findOne({ email }).session(session);
        if (!user) {
          user = new User({ email, verifiedDevices: [] });
        }

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

        await PendingAuth.deleteOne({ _id: pendingAuth._id }).session(session);
      });
    } finally {
      await session.endSession();
    }

    const permanentToken = generateToken(email, deviceId);

    res.cookie('authToken', permanentToken, {
      httpOnly: true,
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'None',
    });

    res.json({ message: 'Device verified successfully', verified: true });
  } catch (error) {
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/auth/logout', authenticateToken, async (req, res) => {
  try {
    res.clearCookie('authToken');

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/server/new', authenticateToken, async (req, res) => {
  try {
    const { url, alert = false } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }

    const normalizedUrl = urlValidation.normalizedUrl;

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

    const serverCount = await Server.countDocuments({
      userEmail: req.user.email,
      isActive: true,
    });

    if (serverCount >= req.user.maxServerCount) {
      return res.status(400).json({
        error: `Maximum server limit (${req.user.maxServerCount}) reached`,
      });
    }

    const lastServer = await Server.findOne({
      userEmail: req.user.email,
    }).sort({ index: -1 });

    const nextIndex = lastServer ? lastServer.index + 1 : 0;

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

    const pingResult = await pingServer(normalizedUrl);

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

    const serverIds = servers.map((s) => s._id);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentPings = await PingHistory.find({
      serverId: { $in: serverIds },
      pingTime: { $gte: oneDayAgo },
    })
      .select('serverId responseTime isSuccess pingTime')
      .sort({ pingTime: -1 });

    const pingsByServer = recentPings.reduce((acc, ping) => {
      const serverId = ping.serverId.toString();
      if (!acc[serverId]) acc[serverId] = [];
      acc[serverId].push(ping);
      return acc;
    }, {});

    const serversWithPings = servers.map((server) => ({
      ...server.toObject(),
      recentPings: pingsByServer[server._id.toString()] || [],
    }));

    res.json({
      servers: serversWithPings,
      maxServerCount: req.user.maxServerCount,
    });
  } catch (error) {
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

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }

    const normalizedUrl = urlValidation.normalizedUrl;

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
    if (error.code === 11000) {
      return res.status(400).json({
        error: 'This URL is already being monitored by you.',
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/server/delete/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid server ID format' });
    }

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

        const deleteResult = await PingHistory.deleteMany({
          serverId: id,
        }).session(session);
      });

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
    if (error.message === 'Server not found or access denied') {
      return res
        .status(404)
        .json({ error: 'Server not found or access denied' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

    res.json({ message: 'Server monitoring restarted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const connectToDb = () => {
  return mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
};

const startServerMonitoring = () => {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const servers = await Server.find({
        isActive: true,
        isPaused: false,
      }).lean();

      if (servers.length === 0) {
        return;
      }

      const batchSize = 50;
      const batches = [];
      for (let i = 0; i < servers.length; i += batchSize) {
        batches.push(servers.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const pingPromises = batch.map(async (server) => {
          const pingResult = await pingServer(server.url);
          return {
            serverId: server._id,
            server,
            pingResult,
          };
        });

        const results = await Promise.allSettled(pingPromises);

        const serverUpdates = [];
        const pingHistories = [];
        const emailAlerts = [];

        for (const result of results) {
          if (result.status === 'rejected') {
            continue;
          }

          const { serverId, server, pingResult } = result.value;

          const newTotalPings = (server.totalPings || 0) + 1;
          const newSuccessfulPings =
            (server.successfulPings || 0) + (pingResult.success ? 1 : 0);
          const newUptime =
            newTotalPings > 0 ? (newSuccessfulPings / newTotalPings) * 100 : 0;

          let newConsecutiveFailures = server.consecutiveFailures || 0;
          let shouldPause = false;
          let shouldSendAlert = false;

          if (pingResult.success) {
            newConsecutiveFailures = 0;
          } else {
            newConsecutiveFailures += 1;

            if (newConsecutiveFailures >= 3 && !server.isPaused) {
              shouldPause = true;
              shouldSendAlert =
                server.alert === true && server.alertSent !== true;
            }
          }

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
            if (server.alertSent) {
              updateData.alertSent = false;
            }
          }

          if (shouldSendAlert) {
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

          pingHistories.push({
            serverId: serverId,
            userEmail: server.userEmail,
            responseTime: pingResult.responseTime,
            isSuccess: pingResult.success,
            statusCode: pingResult.statusCode,
            errorMessage: pingResult.errorMessage,
          });
        }

        if (serverUpdates.length > 0) {
          try {
            const bulkResult = await Server.bulkWrite(serverUpdates, {
              ordered: false,
            });
          } catch (error) {
            if (error.writeErrors) {
              error.writeErrors.forEach((writeError) => {});
            }
          }
        }

        if (pingHistories.length > 0) {
          try {
            await PingHistory.insertMany(pingHistories, { ordered: false });
          } catch (error) {}
        }

        for (const alertData of emailAlerts) {
          try {
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
          } catch (error) {
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
            } catch (resetError) {}
          }
        }

        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      setTimeout(async () => {
        try {
          const serverIds = servers.map((s) => s._id);
          for (const serverId of serverIds) {
            await maintainPingHistoryLimit(serverId, 150000);
          }
        } catch (error) {}
      }, 5000);
    } catch (error) {}
  });
};

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

app.get('/server/history/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100, page = 1, timeRange = '24h' } = req.query;

    const server = await Server.findOne({
      _id: id,
      userEmail: req.user.email,
      isActive: true,
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/server/stats', authenticateToken, async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;

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

    const servers = await Server.find({
      userEmail: req.user.email,
      isActive: true,
    }).select('_id url index status uptime consecutiveFailures isPaused');

    const serverIds = servers.map((s) => s._id);

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((error, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

connectToDb()
  .then(() => {
    Server.createIndexes();
    PingHistory.createIndexes();
    User.createIndexes();
    PendingAuth.createIndexes();

    startServerMonitoring();

    app.listen(PORT, () => {});
  })
  .catch((error) => {
    process.exit(1);
  });

const gracefulShutdown = (signal) => {
  setTimeout(() => {
    process.exit(1);
  }, 10000);
};

process.on('uncaughtException', (error) => {});

process.on('unhandledRejection', (reason, promise) => {});

module.exports = app;
