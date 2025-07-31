# Server Monitoring Backend System

A robust Node.js backend system for monitoring server uptime with email-based authentication and real-time alerts.

## Features

### 🔐 Authentication System
- **Email-based verification**: No passwords needed, secure email verification
- **Device-specific authentication**: Each device gets a unique temporary ID
- **JWT cookies**: 30-day auto-refresh tokens
- **Multi-device support**: Users can authenticate multiple devices

### 📊 Server Monitoring
- **Real-time ping monitoring**: Checks servers every 5 minutes
- **Response time tracking**: Monitors and logs server response times
- **Status tracking**: Online/Offline/Checking status for each server
- **Custom indexing**: User-defined server organization
- **100 server limit per user**: Scalable monitoring solution

### 📧 Smart Alert System
- **One-time alerts**: Sends email only once when server goes down
- **Restart functionality**: Users can reset alerts via email button
- **Detailed error reporting**: Includes response time and error details
- **Professional email templates**: Clean, actionable alert emails

### 🛡️ Security & Reliability
- **Input validation**: Comprehensive request validation
- **Error handling**: Robust error handling throughout
- **Graceful shutdown**: Proper cleanup on server termination
- **Admin controls**: Admin-level server management
- **CORS protection**: Configurable cross-origin policies

## Quick Start

### Prerequisites
- Node.js 16+
- MongoDB
- Gmail account with App Password

### Installation

1. **Clone and install dependencies**
```bash
npm install
```

2. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Configure Gmail App Password**
   - Go to Google Account settings
   - Enable 2-factor authentication
   - Generate an App Password for "Mail"
   - Use this password in EMAIL_APP_PASSWORD

4. **Start the server**
```bash
# Development
npm run dev

# Production
npm start
```

## API Documentation

### Authentication Endpoints

#### Request Device Verification
```http
POST /auth/request
Content-Type: application/json

{
  "email": "user@example.com",
  "deviceId": "unique-device-id-from-frontend"
}
```

#### Verify Device
```http
POST /auth/verify
Content-Type: application/json

{
  "token": "verification-token-from-email"
}
```

#### Check Verification Status
```http
GET /auth/isVerified?email=user@example.com&deviceId=device-id
```

#### Logout
```http
POST /auth/logout
Cookie: authToken=jwt_token
```

### Server Management Endpoints

#### Add New Server
```http
POST /server/new
Cookie: authToken=jwt_token
Content-Type: application/json

{
  "url": "https://example.com"
}
```

#### Get All Servers
```http
GET /server/data
Cookie: authToken=jwt_token
```

#### Edit Server
```http
PUT /server/edit/:id
Cookie: authToken=jwt_token
Content-Type: application/json

{
  "url": "https://new-url.com"
}
```

#### Delete Server
```http
DELETE /server/delete/:id
Cookie: authToken=jwt_token
```

#### Restart Server Monitoring
```http
POST /server/restart/:id
Cookie: authToken=jwt_token
```

### Admin Endpoints

#### Admin Restart All Servers
```http
POST /admin/restart
Content-Type: application/json

{
  "adminKey": "your-admin-access-key",
  "email": "user@example.com"
}
```

### Health Check
```http
GET /health
```

## Authentication Flow

### Initial Authentication
1. Frontend generates temporary `clientDeviceId`
2. User enters email and clicks "Get In"
3. Backend sends verification email with button
4. User clicks email button → redirects to frontend
5. Frontend calls `/auth/verify` with token
6. Backend sets permanent JWT cookie (30 days)

### Return User Flow
1. User returns to auth screen
2. Frontend checks `/auth/isVerified` with stored deviceId
3. If verified: automatic login
4. If not verified: shows "check email" message

## Server Monitoring Process

### Monitoring Cycle
1. **Every 5 minutes**: Cron job pings all active servers
2. **Response tracking**: Records response time and status
3. **Failure detection**: Identifies when servers go offline
4. **Alert system**: Sends email on first failure only

### Alert Email Flow
1. Server fails → Check if `alertSent` is false
2. Send failure email with "Restart Monitoring" button
3. Set `alertSent` to true (prevents spam)
4. Continue monitoring every 5 minutes
5. User clicks restart → Reset `alertSent` to false

## Database Schema

### Users Collection
```javascript
{
  email: String,
  verifiedDevices: [{
    deviceId: String,
    verifiedAt: Date,
    isActive: Boolean
  }],
  createdAt: Date
}
```

### Servers Collection
```javascript
{
  userEmail: String,
  url: String,
  index: Number,
  pingCount: Number,
  lastPingTime: Date,
  responseTime: Number,
  status: String, // 'online', 'offline', 'checking'
  alertSent: Boolean,
  createdAt: Date,
  lastFailureTime: Date,
  isActive: Boolean
}
```

### Pending Auth Collection
```javascript
{
  email: String,
  deviceId: String,
  token: String,
  expiresAt: Date // TTL index - auto expires in 10 minutes
}
```

## Configuration

### Environment Variables
- `EMAIL_ID`: Gmail address for sending emails
- `EMAIL_APP_PASSWORD`: Gmail App Password (not regular password)
- `MONGO_URL`: MongoDB connection string
- `ADMIN_ACCESS_KEY`: Secret key for admin operations
- `JWT_SECRET`: Secret key for JWT token signing
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
- `FRONTEND_URL`: Frontend URL for email links

### Security Best Practices
- Use strong, unique JWT_SECRET (minimum 32 characters)
- Keep ADMIN_ACCESS_KEY secure and rotate regularly
- Use HTTPS in production
- Enable MongoDB authentication
- Set secure cookie flags in production
- Implement rate limiting for production use

## Email Templates

### Verification Email
- Clean, professional design
- Single verification button
- 10-minute expiration notice
- Security disclaimer

### Alert Email
- Clear server failure information
- Response time and error details
- One-click restart functionality
- Timestamp and server details

## Error Handling

### Client Errors (4xx)
- `400`: Bad Request - Missing required fields
- `401`: Unauthorized - Invalid/missing token
- `404`: Not Found - Server/route not found
- `429`: Too Many Requests - Rate limit exceeded

### Server Errors (5xx)
- `500`: Internal Server Error - Database/system errors
- Graceful error responses with user-friendly messages
- Comprehensive logging for debugging

## Monitoring & Logging

### Built-in Logging
- Server startup/shutdown events
- Database connection status
- Email sending confirmations
- Monitoring cycle completions
- Error tracking with stack traces

### Health Monitoring
- `/health` endpoint for uptime checks
- Process uptime tracking
- Database connection status
- Memory usage monitoring

## Performance Considerations

### Optimization Features
- Efficient database queries with indexes
- Batch processing for monitoring checks
- Connection pooling for database
- Async/await throughout for non-blocking operations
- Minimal delay between server pings (100ms)

### Scalability
- Horizontal scaling ready
- Stateless authentication (JWT)
- Database indexes on frequently queried fields
- Efficient cron job processing

## Deployment Guide

### Production Setup
1. **Server Requirements**
   - Node.js 16+ runtime
   - MongoDB 4.4+ database
   - SSL certificate for HTTPS
   - Process manager (PM2 recommended)

2. **Environment Configuration**
```bash
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://yourdomain.com
MONGO_URL=mongodb://username:password@your-mongo-host:27017/server-monitor
EMAIL_ID=alerts@yourdomain.com
EMAIL_APP_PASSWORD=your-app-password
JWT_SECRET=your-super-long-random-secret-key
ADMIN_ACCESS_KEY=your-admin-secret-key
```

3. **Process Management with PM2**
```bash
npm install -g pm2
pm2 start server.js --name "server-monitor"
pm2 startup
pm2 save
```

4. **Reverse Proxy (Nginx)**
```nginx
server {
    listen 80;
    server_name your-api-domain.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Database Indexes
```javascript
// Recommended indexes for optimal performance
db.users.createIndex({ "email": 1 }, { unique: true })
db.users.createIndex({ "verifiedDevices.deviceId": 1 })
db.servers.createIndex({ "userEmail": 1, "isActive": 1 })
db.servers.createIndex({ "isActive": 1 })
db.pendingauths.createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 0 })
```

## Testing

### Unit Tests
```bash
npm test
```

### Manual Testing Checklist
- [ ] Email verification flow
- [ ] Device authentication
- [ ] Server CRUD operations
- [ ] Monitoring alerts
- [ ] Restart functionality
- [ ] Admin operations
- [ ] Error handling
- [ ] Cookie management

## Troubleshooting

### Common Issues

#### Email Not Sending
- Check Gmail App Password is correct
- Verify 2FA is enabled on Gmail account
- Check EMAIL_ID format
- Review firewall/network restrictions

#### Database Connection Issues
- Verify MONGO_URL format
- Check MongoDB service status
- Validate network connectivity
- Review authentication credentials

#### Authentication Problems
- Check JWT_SECRET is set
- Verify cookie settings
- Review CORS configuration
- Check token expiration

#### Monitoring Not Working
- Verify cron job is running
- Check server URLs are accessible
- Review network connectivity
- Monitor server logs for errors

### Debug Mode
```bash
NODE_ENV=development npm run dev
```

## Contributing

### Development Setup
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

### Code Style
- Use ESLint configuration
- Follow Prettier formatting
- Add JSDoc comments for functions
- Include error handling
- Write meaningful commit messages

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Check troubleshooting section
- Review server logs
- Test with sample requests
- Verify environment configuration

---

**Built with ❤️ for reliable server monitoring**

