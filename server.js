require('dotenv').config();
const express = require('express');
const { connectToDb } = require('./src/config/database');
const authRoutes = require('./src/routes/auth');
const serverRoutes = require('./src/routes/servers');
const { startMonitoring } = require('./src/services/monitoring');
const { rateLimiter } = require('./src/middleware/rateLimiter');
const PORT = process.env.PORT || 3000;
const app = express();
app.use(require('./src/routes/serverInit'));

app.use('/auth', rateLimiter(10, 5 * 60 * 1000), authRoutes);
app.use('/servers', rateLimiter(50, 5 * 60 * 1000), serverRoutes);

app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: error.message });
});

app.use('*', (req, res) => {
  res.status(200).json({ message: 'Welcome to Watchtower API' });
});

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
