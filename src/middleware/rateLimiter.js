class SimpleRateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();

    // Cleanup every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    for (const [ip, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(time => time > cutoff);
      if (validTimestamps.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, validTimestamps);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const cutoff = now - this.windowMs;

      if (!this.requests.has(ip)) {
        this.requests.set(ip, []);
      }

      const timestamps = this.requests.get(ip).filter(time => time > cutoff);
      timestamps.push(now);
      this.requests.set(ip, timestamps);

      if (timestamps.length > this.maxRequests) {
        return res.status(429).json({
          error: 'Too many requests. Try again later.'
        });
      }

      next();
    };
  }
}

const rateLimiter = (maxRequests, windowMs) => {
  return new SimpleRateLimiter(maxRequests, windowMs).middleware();
};

module.exports = { rateLimiter };