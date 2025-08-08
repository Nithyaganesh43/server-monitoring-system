const jwt = require('jsonwebtoken');

const generateToken = (email, deviceId, expiresIn = '30d') => {
  return jwt.sign(
    {
      email: email.toLowerCase().trim(),
      deviceId: deviceId.trim(),
      iat: Math.floor(Date.now() / 1000)
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

const generateVerificationToken = (email, deviceId) => {
  return jwt.sign(
    {
      email: email.toLowerCase().trim(),
      deviceId: deviceId.trim(),
      type: 'verification'
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
};

module.exports = {
  generateToken,
  generateVerificationToken
};