const validator = require('validator');

const validateUrl = (url) => {
  try {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL is required and must be a string' };
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      return { valid: false, error: 'URL must start with http:// or https://' };
    }

    const parsedUrl = new URL(trimmedUrl);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { valid: false, error: 'Invalid protocol. Only HTTP and HTTPS are allowed.' };
    }

    if (!parsedUrl.hostname) {
      return { valid: false, error: 'Invalid hostname' };
    }

    // Block localhost and private IPs
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedPatterns = ['localhost', '127.', '192.168.', '10.', '172.16.'];
    
    const isBlocked = blockedPatterns.some(pattern => 
      hostname === pattern || hostname.startsWith(pattern)
    );

    if (isBlocked) {
      return { valid: false, error: 'Private or localhost addresses are not allowed' };
    }

    if (trimmedUrl.length > 2048) {
      return { valid: false, error: 'URL is too long (max 2048 characters)' };
    }

    return { valid: true, normalizedUrl: trimmedUrl };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
};

const validateEmail = (email) => {
  if (!email || !validator.isEmail(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true, normalizedEmail: email.toLowerCase().trim() };
};

const validateDeviceId = (deviceId) => {
  if (!deviceId || typeof deviceId !== 'string') {
    return { valid: false, error: 'DeviceId is required' };
  }
  
  if (deviceId.trim().length > 500) {
    return { valid: false, error: 'DeviceId is too long' };
  }

  return { valid: true, normalizedDeviceId: deviceId.trim() };
};

module.exports = {
  validateUrl,
  validateEmail,
  validateDeviceId
};