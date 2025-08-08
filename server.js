require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cron = require('node-cron');

const { connectToDb } = require('./src/config/database');
const authRoutes = require('./src/routes/auth');
const serverRoutes = require('./src/routes/servers');
const { startMonitoring } = require('./src/services/monitoring');
const { rateLimiter } = require('./src/middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment validation
const required = ['JWT_SECRET', 'MONGO_URL', 'EMAIL_ID', 'EMAIL_APP_PASSWORD'];
required.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing ${key} environment variable`);
    process.exit(1);
  }
});

// Security middleware
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })
);

// Basic middleware
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'https://watchtower-24-7.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
};
app.use(cors(corsOptions));

// Rate limiting
app.use('/auth', rateLimiter(10, 5 * 60 * 1000)); // 10 requests per 5 minutes
app.use('/servers', rateLimiter(50, 5 * 60 * 1000)); // 50 requests per 5 minutes

// Health check
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Watchtower is running',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/auth', authRoutes);
app.use('/servers', serverRoutes);

// Error handling
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
connectToDb()
  .then(() => {
    startMonitoring();
    app.listen(PORT, () => {
      console.log(`Watchtower server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
