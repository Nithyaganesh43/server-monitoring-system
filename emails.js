// emails.js - Email templates and utilities

const generateVerificationEmail = (verificationUrl) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Device Verification - WatchTower 24/7</title>
    </head>
    <body style="margin:0;padding:0;background:linear-gradient(135deg,#000428 0%,#004e92 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background-image:url('https://res.cloudinary.com/dflgxymvs/image/upload/v1753939083/lecrowninteriors/dnxufxylqjzxsnsa8jkg.avif');background-size:cover;background-position:center;min-height:100vh;padding:40px 20px;">
        <div style="max-width:500px;margin:0 auto;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);border-radius:16px;padding:40px;border:1px solid rgba(255,255,255,0.1);">
          <div style="text-align:center;margin-bottom:30px;">
            <h1 style="color:#00d4ff;margin:0;font-size:28px;font-weight:700;">WatchTower 24/7</h1>
            <p style="color:#a0a9c0;margin:10px 0 0;font-size:14px;">Server Monitoring Platform</p>
          </div>
          
          <div style="text-align:center;margin-bottom:30px;">
            <h2 style="color:#ffffff;margin:0 0 15px;font-size:20px;">Verify Your Device</h2>
            <p style="color:#a0a9c0;margin:0;line-height:1.5;">Click the button below to complete device verification and access your monitoring dashboard.</p>
          </div>
          
          <div style="text-align:center;margin:30px 0;">
            <a href="${verificationUrl}" style="display:inline-block;background:linear-gradient(135deg,#00d4ff 0%,#0099cc 100%);color:#ffffff;text-decoration:none;padding:15px 35px;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 4px 15px rgba(0,212,255,0.3);transition:all 0.3s ease;">
              ✅ Verify Device
            </a>
          </div>
          
          <div style="background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:8px;padding:15px;margin:20px 0;">
            <p style="color:#ffc107;margin:0;font-size:14px;text-align:center;">⏱️ This link expires in 10 minutes</p>
          </div>
          
          <div style="text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);">
            <p style="color:#6c757d;margin:0;font-size:12px;">Didn't request this? Please ignore this email.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

const generateServerDownAlert = (
  server,
  pingResult,
  restartUrl,
  failureCount
) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🚨 Server Down Alert - WatchTower 24/7</title>
    </head>
    <body style="margin:0;padding:0;background:linear-gradient(135deg,#000428 0%,#004e92 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background-image:url('https://res.cloudinary.com/dflgxymvs/image/upload/v1753939083/lecrowninteriors/dnxufxylqjzxsnsa8jkg.avif');background-size:cover;background-position:center;min-height:100vh;padding:40px 20px;">
        <div style="max-width:600px;margin:0 auto;background:rgba(0,0,0,0.9);backdrop-filter:blur(15px);border-radius:16px;border:1px solid rgba(220,53,69,0.3);overflow:hidden;">
          
          <!-- Header -->
          <div style="background:linear-gradient(135deg,#dc3545 0%,#c82333 100%);padding:25px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">🚨 SERVER DOWN ALERT</h1>
            <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">WatchTower 24/7 Monitoring</p>
          </div>
          
          <!-- Alert Content -->
          <div style="padding:30px;">
            <div style="background:rgba(220,53,69,0.1);border:1px solid rgba(220,53,69,0.3);border-radius:10px;padding:20px;margin-bottom:25px;text-align:center;">
              <h2 style="color:#ff6b7a;margin:0 0 10px;font-size:18px;">Server Failed ${failureCount} Times</h2>
              <p style="color:#ffffff;margin:0;font-size:24px;font-weight:600;word-break:break-all;">${server.url}</p>
              <p style="color:#a0a9c0;margin:10px 0 0;font-size:14px;">Index #${server.index}</p>
            </div>
            
            <!-- Server Details -->
            <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:20px;margin-bottom:25px;">
              <h3 style="color:#00d4ff;margin:0 0 15px;font-size:16px;">📊 Failure Details</h3>
              <div style="display:grid;gap:8px;">
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                  <span style="color:#a0a9c0;">Failed At:</span>
                  <span style="color:#ffffff;">${new Date().toLocaleString()}</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                  <span style="color:#a0a9c0;">Response Time:</span>
                  <span style="color:#ffffff;">${pingResult.responseTime}ms</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                  <span style="color:#a0a9c0;">Status Code:</span>
                  <span style="color:#ff6b7a;">${pingResult.statusCode || 'No Response'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                  <span style="color:#a0a9c0;">Current Uptime:</span>
                  <span style="color:#ffffff;">${(server.uptime || 0).toFixed(2)}%</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;">
                  <span style="color:#a0a9c0;">Error:</span>
                  <span style="color:#ff6b7a;text-align:right;max-width:60%;">${pingResult.errorMessage || 'Server unreachable'}</span>
                </div>
              </div>
            </div>
            
            <!-- Action Button -->
            <div style="text-align:center;margin:30px 0;">
              <a href="${restartUrl}" style="display:inline-block;background:linear-gradient(135deg,#28a745 0%,#20c997 100%);color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:10px;font-weight:600;font-size:16px;box-shadow:0 4px 20px rgba(40,167,69,0.3);transition:all 0.3s ease;">
                🔄 Resume Monitoring
              </a>
            </div>
            
            <!-- Important Notice -->
            <div style="background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:10px;padding:20px;margin:25px 0;">
              <h4 style="color:#ffc107;margin:0 0 10px;font-size:14px;font-weight:600;">⚠️ MONITORING PAUSED</h4>
              <p style="color:#ffffff;margin:0;font-size:14px;line-height:1.5;">
                Monitoring for this server has been automatically paused after 3 consecutive failures. 
                Click "Resume Monitoring" after fixing the issue to restart automated checks.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);">
              <p style="color:#6c757d;margin:0;font-size:12px;">
                Powered by <strong style="color:#00d4ff;">WatchTower 24/7</strong> Server Monitoring
              </p>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

const generateSuccessPage = (permanentToken) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Device Verified - WatchTower 24/7</title>
    </head>
    <body style="margin:0;padding:0;background:linear-gradient(135deg,#000428 0%,#004e92 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background-image:url('https://res.cloudinary.com/dflgxymvs/image/upload/v1753939083/lecrowninteriors/dnxufxylqjzxsnsa8jkg.avif');background-size:cover;background-position:center;min-height:100vh;padding:40px 20px;display:flex;align-items:center;justify-content:center;">
        <div style="max-width:450px;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);border-radius:16px;padding:40px;text-align:center;border:1px solid rgba(40,167,69,0.3);">
          <div style="margin-bottom:25px;">
            <div style="width:80px;height:80px;background:linear-gradient(135deg,#28a745 0%,#20c997 100%);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(40,167,69,0.3);">
              <span style="color:#ffffff;font-size:32px;">✅</span>
            </div>
            <h1 style="color:#28a745;margin:0 0 10px;font-size:24px;font-weight:700;">Device Verified!</h1>
            <p style="color:#a0a9c0;margin:0;font-size:16px;">Successfully authenticated</p>
          </div>
          
          <div style="background:rgba(40,167,69,0.1);border:1px solid rgba(40,167,69,0.3);border-radius:10px;padding:20px;margin:25px 0;">
            <p style="color:#ffffff;margin:0;font-size:14px;line-height:1.5;">
              Your device has been verified and you can now access the server monitoring dashboard. 
              This page will close automatically.
            </p>
          </div>
          
          <div style="margin-top:30px;">
            <p style="color:#6c757d;margin:0;font-size:12px;">
              Powered by <strong style="color:#00d4ff;">WatchTower 24/7</strong>
            </p>
          </div>
        </div>
      </div>
      
      <script>
        // Set the auth token as a cookie
        document.cookie = 'authToken=${permanentToken}; path=/; max-age=${30 * 24 * 60 * 60}; secure; samesite=none';
        
        // Auto-close after 2 seconds
        setTimeout(() => {
          window.close();
        }, 2000);
      </script>
    </body>
    </html>
  `;
};

const generateErrorPage = (title, message) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - WatchTower 24/7</title>
    </head>
    <body style="margin:0;padding:0;background:linear-gradient(135deg,#000428 0%,#004e92 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background-image:url('https://res.cloudinary.com/dflgxymvs/image/upload/v1753939083/lecrowninteriors/dnxufxylqjzxsnsa8jkg.avif');background-size:cover;background-position:center;min-height:100vh;padding:40px 20px;display:flex;align-items:center;justify-content:center;">
        <div style="max-width:450px;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);border-radius:16px;padding:40px;text-align:center;border:1px solid rgba(220,53,69,0.3);">
          <div style="margin-bottom:25px;">
            <div style="width:80px;height:80px;background:linear-gradient(135deg,#dc3545 0%,#c82333 100%);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(220,53,69,0.3);">
              <span style="color:#ffffff;font-size:32px;">❌</span>
            </div>
            <h1 style="color:#dc3545;margin:0 0 10px;font-size:24px;font-weight:700;">${title}</h1>
          </div>
          
          <div style="background:rgba(220,53,69,0.1);border:1px solid rgba(220,53,69,0.3);border-radius:10px;padding:20px;margin:25px 0;">
            <p style="color:#ffffff;margin:0;font-size:14px;line-height:1.5;">${message}</p>
          </div>
          
          <div style="margin-top:30px;">
            <p style="color:#6c757d;margin:0;font-size:12px;">
              Powered by <strong style="color:#00d4ff;">WatchTower 24/7</strong>
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

module.exports = {
  generateVerificationEmail,
  generateServerDownAlert,
  generateSuccessPage,
  generateErrorPage,
};
