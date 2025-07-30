const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// Email transporter setup
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_ID,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ADMIN_ACCESS_KEY = process.env.ADMIN_ACCESS_KEY;

// Database Models
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
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
  userEmail: { type: String, required: true },
  url: { type: String, required: true },
  index: { type: Number, required: true },
  pingCount: { type: Number, default: 0 },
  lastPingTime: { type: Date },
  responseTime: { type: Number },
  status: {
    type: String,
    enum: ['online', 'offline', 'checking'],
    default: 'checking',
  },
  alertSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastFailureTime: { type: Date },
  isActive: { type: Boolean, default: true },
});

const pendingAuthSchema = new mongoose.Schema({
  email: { type: String, required: true },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, default: Date.now, expires: 600 }, // 10 minutes
});

const User = mongoose.model('User', userSchema);
const Server = mongoose.model('Server', serverSchema);
const PendingAuth = mongoose.model('PendingAuth', pendingAuthSchema);

// Utility Functions
const generateToken = (email, deviceId) => {
  return jwt.sign({ email, deviceId }, JWT_SECRET, { expiresIn: '30d' });
};

const sendEmail = async (to, subject, html) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_ID,
      to,
      subject,
      html,
    });
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error('Email sending failed:', error);
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
    return { success: true, responseTime, status: response.status };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return { success: false, responseTime, error: error.message };
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

    req.user = { email: decoded.email, deviceId: decoded.deviceId };
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

    // Save pending auth
    await PendingAuth.findOneAndUpdate(
      { email, deviceId },
      { token: verificationToken },
      { upsert: true, new: true }
    );

    // Send verification email
    const verificationUrl = `${
      process.env.FRONTEND_URL || 'http://localhost:3000'
    }/verify?token=${verificationToken}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Server Monitor - Device Verification</h2>
        <p>Click the button below to verify your device and access the server monitoring dashboard:</p>
        <a href="${verificationUrl}" 
           style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 4px; margin: 20px 0;">
          Verify Device
        </a>
        <p>This link will expire in 10 minutes.</p>
        <p>If you didn't request this verification, please ignore this email.</p>
      </div>
    `;

    await sendEmail(email, 'Server Monitor - Verify Your Device', emailHtml);

    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    console.error('Auth request error:', error);
    res.status(500).json({ error: 'Internal server error' });
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

    // Create or update user
    let user = await User.findOne({ email });
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

    await user.save();

    // Remove pending auth
    await PendingAuth.deleteOne({ _id: pendingAuth._id });

    // Generate permanent token
    const permanentToken = generateToken(email, deviceId);

    // Set cookie
    res.cookie('authToken', permanentToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'strict',
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
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: 'strict',
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
    const user = await User.findOne({ email: req.user.email });
    if (user) {
      const device = user.verifiedDevices.find(
        (device) => device.deviceId === req.user.deviceId
      );
      if (device) {
        device.isActive = false;
        await user.save();
      }
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Server Management Routes
app.post('/server/new', authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Check server count limit
    const serverCount = await Server.countDocuments({
      userEmail: req.user.email,
      isActive: true,
    });

    if (serverCount >= 100) {
      return res
        .status(400)
        .json({ error: 'Maximum server limit (100) reached' });
    }

    // Get next index
    const lastServer = await Server.findOne({
      userEmail: req.user.email,
    }).sort({ index: -1 });

    const nextIndex = lastServer ? lastServer.index + 1 : 0;

    // Create new server
    const server = new Server({
      userEmail: req.user.email,
      url,
      index: nextIndex,
    });

    await server.save();

    // Initial ping
    const pingResult = await pingServer(url);
    server.pingCount = 1;
    server.lastPingTime = new Date();
    server.responseTime = pingResult.responseTime;
    server.status = pingResult.success ? 'online' : 'offline';

    if (!pingResult.success) {
      server.lastFailureTime = new Date();
    }

    await server.save();

    res.json({
      message: 'Server added successfully',
      server: {
        _id: server._id,
        url: server.url,
        index: server.index,
        status: server.status,
        responseTime: server.responseTime,
      },
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
      'url index status responseTime pingCount lastPingTime createdAt lastFailureTime'
    );

    res.json({ servers });
  } catch (error) {
    console.error('Get servers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/server/edit/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const server = await Server.findOneAndUpdate(
      { _id: id, userEmail: req.user.email, isActive: true },
      { url, status: 'checking', alertSent: false },
      { new: true }
    );

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json({ message: 'Server updated successfully', server });
  } catch (error) {
    console.error('Edit server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/server/delete/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const server = await Server.findOneAndUpdate(
      { _id: id, userEmail: req.user.email },
      { isActive: false },
      { new: true }
    );

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json({ message: 'Server deleted successfully' });
  } catch (error) {
    console.error('Delete server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/server/restart/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const server = await Server.findOneAndUpdate(
      { _id: id, userEmail: req.user.email, isActive: true },
      { alertSent: false, status: 'checking' },
      { new: true }
    );

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json({ message: 'Server monitoring restarted successfully' });
  } catch (error) {
    console.error('Restart server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin route to restart all servers for a user
app.post('/admin/restart', async (req, res) => {
  try {
    const { adminKey, email } = req.body;

    if (adminKey !== ADMIN_ACCESS_KEY) {
      return res.status(401).json({ error: 'Invalid admin access key' });
    }

    await Server.updateMany(
      { userEmail: email, isActive: true },
      { alertSent: false, status: 'checking' }
    );

    res.json({ message: 'All servers monitoring restarted successfully' });
  } catch (error) {
    console.error('Admin restart error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Database connection and server monitoring
const connectToDb = () => {
  return mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
};

// Server monitoring cron job (every 5 minutes)
const startServerMonitoring = () => {
  cron.schedule('*/5 * * * *', async () => {
    console.log('Running server monitoring check...');

    try {
      const servers = await Server.find({ isActive: true });

      for (const server of servers) {
        const pingResult = await pingServer(server.url);

        // Update server stats
        server.pingCount += 1;
        server.lastPingTime = new Date();
        server.responseTime = pingResult.responseTime;

        if (pingResult.success) {
          server.status = 'online';
          server.alertSent = false; // Reset alert when server comes back online
        } else {
          server.status = 'offline';
          server.lastFailureTime = new Date();

          // Send alert email if not already sent
          if (!server.alertSent) {
            const restartUrl = `${
              process.env.FRONTEND_URL || 'http://localhost:3000'
            }/restart/${server._id}`;

            const alertHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #dc3545;">Server Monitor Alert</h2>
                <p><strong>Server Down:</strong> ${server.url}</p>
                <p><strong>Index:</strong> ${server.index}</p>
                <p><strong>Failed at:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Response time:</strong> ${
                  pingResult.responseTime
                }ms</p>
                <p><strong>Error:</strong> ${
                  pingResult.error || 'Server unreachable'
                }</p>
                
                <div style="margin: 20px 0;">
                  <a href="${restartUrl}" 
                     style="display: inline-block; background-color: #28a745; color: white; 
                            padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                    Restart Monitoring
                  </a>
                </div>
                
                <p style="color: #666; font-size: 14px;">
                  Click the restart button above to reset the alert and continue monitoring.
                </p>
              </div>
            `;

            await sendEmail(
              server.userEmail,
              `Server Monitor Alert: ${server.url} is DOWN`,
              alertHtml
            );

            server.alertSent = true;
            console.log(`Alert sent for server: ${server.url}`);
          }
        }

        await server.save();

        // Small delay between requests to avoid overwhelming
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      console.log(`Monitoring check completed for ${servers.length} servers`);
    } catch (error) {
      console.error('Server monitoring error:', error);
    }
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
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

    // Start monitoring
    startServerMonitoring();
    console.log('Server monitoring cron job started (every 5 minutes)');

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Available routes:');
      console.log('POST /auth/request - Request device verification');
      console.log('POST /auth/verify - Verify device with token');
      console.log('GET /auth/isVerified - Check if device is verified');
      console.log('POST /auth/logout - Logout and deactivate device');
      console.log('POST /server/new - Add new server to monitor');
      console.log('GET /server/data - Get all user servers');
      console.log('PUT /server/edit/:id - Edit server URL');
      console.log('DELETE /server/delete/:id - Delete server');
      console.log('POST /server/restart/:id - Restart server monitoring');
      console.log('POST /admin/restart - Admin restart all servers');
      console.log('GET /health - Health check');
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

module.exports = app;
