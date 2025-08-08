const axios = require('axios');
const cron = require('node-cron');
const Server = require('../models/Server');
const { sendEmail, generateServerDownAlert } = require('../utils/email');

const pingServer = async (url, timeout = 15000) => {
  const startTime = Date.now();

  try {
    const response = await axios({
      method: 'GET',
      url,
      timeout,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      headers: {
        'User-Agent': 'Watchtower-Monitor/1.0'
      }
    });

    return {
      success: true,
      responseTime: Date.now() - startTime,
      statusCode: response.status,
      errorMessage: null
    };
  } catch (error) {
    return {
      success: false,
      responseTime: Date.now() - startTime,
      statusCode: error.response?.status || null,
      errorMessage: error.code === 'ECONNABORTED' 
        ? 'Request timeout' 
        : (error.message || 'Unknown error').substring(0, 500)
    };
  }
};

const processServerBatch = async (servers) => {
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const pingResult = await pingServer(server.url);
      
      let consecutiveFailures = server.consecutiveFailures;
      let alertSent = server.alertSent;
      let shouldSendAlert = false;

      if (pingResult.success) {
        consecutiveFailures = 0;
        if (server.alertSent) {
          alertSent = false; // Reset alert when server comes back online
        }
      } else {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3 && server.alertEnabled && !server.alertSent) {
          shouldSendAlert = true;
          alertSent = true;
        }
      }

      const updateData = {
        status: pingResult.success ? 'online' : 'offline',
        responseTime: pingResult.responseTime,
        lastCheck: new Date(),
        consecutiveFailures,
        alertSent
      };

      await Server.findByIdAndUpdate(server._id, updateData);

      if (shouldSendAlert) {
        try {
          const alertHtml = generateServerDownAlert(server, pingResult.errorMessage);
          await sendEmail(
            server.userEmail,
            `🚨 Server Down Alert: ${server.url}`,
            alertHtml
          );
          console.log(`Alert sent for server: ${server.url}`);
        } catch (emailError) {
          console.error('Failed to send alert email:', emailError);
          // Reset alert flag if email fails
          await Server.findByIdAndUpdate(server._id, { alertSent: false });
        }
      }

      return { serverId: server._id, success: true };
    })
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Processed ${successful}/${servers.length} servers successfully`);
};

const startMonitoring = () => {
  console.log('Starting server monitoring...');
  
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const servers = await Server.find({}).lean();
      if (servers.length === 0) return;

      console.log(`Monitoring ${servers.length} servers...`);
      
      // Process servers in batches to avoid overwhelming the system
      const batchSize = 20;
      const batches = [];
      
      for (let i = 0; i < servers.length; i += batchSize) {
        batches.push(servers.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        await processServerBatch(batch);
        // Small delay between batches
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log('Monitoring cycle completed');
    } catch (error) {
      console.error('Monitoring error:', error);
    }
  });
};

module.exports = {
  startMonitoring,
  pingServer
};