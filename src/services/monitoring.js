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
      headers: { 'User-Agent': 'Watchtower-Monitor/1.0' },
    });
    return {
      success: true,
      responseTime: Date.now() - startTime,
      statusCode: response.status,
      errorMessage: null,
    };
  } catch (error) {
    return {
      success: false,
      responseTime: Date.now() - startTime,
      statusCode: error.response?.status || null,
      errorMessage:
        error.code === 'ECONNABORTED'
          ? 'Request timeout'
          : (error.message || 'Unknown error').substring(0, 500),
    };
  }
};

const processServerBatch = async (servers) => {
  if (!servers.length) return;

  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const pingResult = await pingServer(server.url);
      let consecutiveFailures = server.consecutiveFailures;
      let alertSent = server.alertSent;
      let shouldSendAlert = false;

      if (pingResult.success) {
        consecutiveFailures = 0;
        if (alertSent) alertSent = false;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= 3 && server.alertEnabled && !alertSent) {
          shouldSendAlert = true;
          alertSent = true;
        }
      }

      await Server.findByIdAndUpdate(server._id, {
        status: pingResult.success ? 'online' : 'offline',
        responseTime: pingResult.responseTime,
        lastCheck: new Date(),
        consecutiveFailures,
        alertSent,
      });

      if (shouldSendAlert) {
        try {
          const alertHtml = generateServerDownAlert(
            server,
            pingResult.errorMessage
          );
          await sendEmail(
            server.userEmail,
            `🚨 Server Down Alert: ${server.url}`,
            alertHtml
          );
          console.log(`Alert sent for server: ${server.url}`);
        } catch (emailError) {
          console.error(`Email failed for ${server.url}:`, emailError);
          await Server.findByIdAndUpdate(server._id, { alertSent: false });
        }
      }

      return true;
    })
  );

  console.log(
    `Processed ${results.filter((r) => r.status === 'fulfilled').length}/${
      servers.length
    } servers`
  );
};

const startMonitoring = () => {
  console.log('Starting server monitoring...');

  cron.schedule('*/5 * * * *', async () => {
    try {
      const totalServers = await Server.countDocuments();
      if (!totalServers) { 
        return;
      }

      console.log(`Monitoring ${totalServers} servers...`);
      const batchSize = 20;

      for (let skip = 0; skip < totalServers; skip += batchSize) {
        const batch = await Server.find({}).skip(skip).limit(batchSize).lean();
        await processServerBatch(batch); 
        
        if (skip + batchSize < totalServers) {
          await new Promise((res) => setTimeout(res, 500));
        }
      }

      console.log('Monitoring cycle completed.');
    } catch (error) {
      console.error('Monitoring error:', error);
    }
  });
};

module.exports = { startMonitoring, pingServer };
