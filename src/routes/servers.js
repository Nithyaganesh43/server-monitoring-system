const express = require('express');
const mongoose = require('mongoose');
const Server = require('../models/Server');
const { authenticateToken } = require('../middleware/auth');
const { validateUrl } = require('../utils/validation');
const { pingServer } = require('../services/monitoring');

const router = express.Router();

// Add new server
router.post('/add', authenticateToken, async (req, res) => {
  try {
    const { url, alertEnabled = true } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }

    const normalizedUrl = urlValidation.normalizedUrl;

    // Check for existing URL
    const existingServer = await Server.findOne({
      userEmail: req.user.email,
      url: normalizedUrl,
    });

    if (existingServer) {
      return res.status(400).json({
        error: 'This URL is already being monitored by you.',
      });
    }

    // Check server count limit
    const serverCount = await Server.countDocuments({
      userEmail: req.user.email,
    });

    if (serverCount >= req.user.maxServers) {
      return res.status(400).json({
        error: `Maximum server limit (${req.user.maxServers}) reached.`,
      });
    }

    // Initial ping
    const pingResult = await pingServer(normalizedUrl);

    const server = new Server({
      userEmail: req.user.email,
      url: normalizedUrl,
      alertEnabled: Boolean(alertEnabled),
      status: pingResult.success ? 'online' : 'offline',
      responseTime: pingResult.responseTime,
      lastCheck: new Date(),
      consecutiveFailures: pingResult.success ? 0 : 1,
    });

    await server.save();
 

    res.status(201).json({
      message: 'Server added successfully',
      server,
    });
  } catch (error) {
    console.error('Server creation error:', error);
    res.status(500).json({ error: 'Failed to add server. Please try again.' });
  }
});

// Get all servers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const servers = await Server.find({
      userEmail: req.user.email
    }).select(
      '_id url status responseTime lastCheck alertEnabled consecutiveFailures createdAt'
    ).sort({ createdAt: 1 });

    res.json({
      servers,
      maxServers: req.user.maxServers,
      currentCount: servers.length
    });
  } catch (error) {
    console.error('Server data fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch server data' });
  }
});

// Remove server
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid server ID format' });
    }

    const deletedServer = await Server.findOneAndDelete({
      _id: id,
      userEmail: req.user.email
    });

    if (!deletedServer) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json({
      message: 'Server removed successfully',
      server: {
        id: deletedServer._id,
        url: deletedServer.url
      }
    });
  } catch (error) {
    console.error('Server deletion error:', error);
    res.status(500).json({ error: 'Failed to remove server' });
  }
}); 

// Get server status summary
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const servers = await Server.find({
      userEmail: req.user.email
    });

    const stats = {
      total: servers.length,
      online: servers.filter(s => s.status === 'online').length,
      offline: servers.filter(s => s.status === 'offline').length,
      checking: servers.filter(s => s.status === 'checking').length
    };

    res.json({
      stats,
      servers: servers.map(server => ({
        _id: server._id,
        url: server.url,
        status: server.status,
        responseTime: server.responseTime,
        lastCheck: server.lastCheck,
        consecutiveFailures: server.consecutiveFailures
      }))
    });
  } catch (error) {
    console.error('Server status fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch server status' });
  }
});

module.exports = router;