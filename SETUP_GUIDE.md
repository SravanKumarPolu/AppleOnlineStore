# 🚀 Authentication System Setup Guide

## Quick Start

This guide will help you set up the enhanced authentication system with all the new features including password recovery, performance optimizations, and security enhancements.

## 📋 Prerequisites

- Node.js 18+ and npm
- MongoDB 5.0+
- SMTP email service (Gmail, SendGrid, etc.)
- Modern web browser

## 🔧 Backend Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

**New Dependencies Added:**
- `nodemailer` - Email service for password recovery
- `crypto` - Cryptographic functions for secure tokens

### 2. Environment Configuration

Create a `.env` file in the backend directory:

```bash
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/ecommerce

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-random

# Email Configuration (Gmail Example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password

# Application Configuration
FRONTEND_URL=http://localhost:3000
APP_NAME=E-commerce Store

# Admin Configuration (Optional)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=secure-admin-password

# Security Configuration
NODE_ENV=development
PORT=3001
```

### 3. Email Service Setup

#### **Gmail Setup (Recommended for Development)**

1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail"
3. Use the generated password in `SMTP_PASS`

#### **SendGrid Setup (Recommended for Production)**

1. Create a SendGrid account
2. Create an API key
3. Update environment variables:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

### 4. Database Setup

The system will automatically create the necessary indexes when it starts. However, you can manually create them:

```javascript
// Connect to MongoDB and run:
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "passwordResetToken": 1 });
db.users.createIndex({ "createdAt": 1 });
db.users.createIndex({ "isActive": 1 });
```

### 5. Start Backend Server

```bash
npm run server
```

## 🎨 Frontend Setup

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Environment Configuration

Create a `.env` file in the frontend directory:

```bash
# Backend API URL
VITE_BACKEND_URL=http://localhost:3001

# Application Configuration
VITE_APP_NAME=E-commerce Store
VITE_APP_VERSION=1.0.0

# Feature Flags (Optional)
VITE_ENABLE_ANALYTICS=true
VITE_ENABLE_PWA=true
```

### 3. Start Frontend Development Server

```bash
npm run dev
```

## 🧪 Testing Setup

### 1. Install Testing Dependencies

```bash
# Backend testing
cd backend
npm install --save-dev jest supertest

# Frontend testing
cd frontend
npm install --save-dev @testing-library/react @testing-library/jest-dom vitest
```

### 2. Run Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## 🔒 Security Configuration

### 1. JWT Secret Generation

Generate a secure JWT secret:

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Or use a secure password generator
```

### 2. Rate Limiting Configuration

The system includes built-in rate limiting. You can adjust it in `backend/server.js`:

```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 login attempts per windowMs
  message: {
    success: false,
    message: "Too many login attempts, please try again later."
  },
  standardHeaders: true,
  legacyHeaders: false,
});
```

### 3. CORS Configuration

Update CORS settings in `backend/server.js` for production:

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'token']
}));
```

## 📱 Mobile Testing

### 1. Responsive Design Testing

Test the authentication system on various devices:

- **Mobile**: iPhone, Android phones
- **Tablet**: iPad, Android tablets
- **Desktop**: Chrome, Firefox, Safari, Edge

### 2. Performance Testing

Use browser dev tools to test performance:

```javascript
// Test performance mode detection
console.log('Hardware Concurrency:', navigator.hardwareConcurrency);
console.log('Device Memory:', (navigator as any).deviceMemory);
console.log('Connection:', (navigator as any).connection);
```

## 🔍 Accessibility Testing

### 1. Screen Reader Testing

Test with popular screen readers:

- **Windows**: NVDA (free), JAWS
- **macOS**: VoiceOver (built-in)
- **iOS**: VoiceOver (built-in)
- **Android**: TalkBack (built-in)

### 2. Keyboard Navigation Testing

Test all functionality using only keyboard:

1. Tab through all interactive elements
2. Use Enter/Space to activate buttons
3. Use Escape to close modals
4. Test form submission with keyboard

### 3. Color Contrast Testing

Use browser dev tools or tools like:

- WebAIM Contrast Checker
- Chrome DevTools Accessibility panel
- axe DevTools browser extension

## 🚀 Production Deployment

### 1. Environment Variables

Update environment variables for production:

```bash
# Production Configuration
NODE_ENV=production
MONGODB_URI=your-production-mongodb-uri
JWT_SECRET=your-production-jwt-secret
FRONTEND_URL=https://yourdomain.com
SMTP_HOST=your-production-smtp-host
SMTP_USER=your-production-smtp-user
SMTP_PASS=your-production-smtp-password
```

### 2. SSL/HTTPS Configuration

Ensure HTTPS is enabled:

```javascript
// For Express.js with SSL
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('path/to/key.pem'),
  cert: fs.readFileSync('path/to/cert.pem')
};

https.createServer(options, app).listen(443);
```

### 3. Database Security

Configure MongoDB security:

```javascript
// Enable authentication
// Create admin user
use admin
db.createUser({
  user: "adminUser",
  pwd: "securePassword",
  roles: ["userAdminAnyDatabase", "dbAdminAnyDatabase", "readWriteAnyDatabase"]
});

// Enable SSL/TLS
mongod --sslMode requireSSL --sslPEMKeyFile /path/to/mongodb.pem
```

### 4. Monitoring Setup

Set up monitoring tools:

```bash
# Install monitoring packages
npm install --save winston morgan helmet

# Configure logging
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

## 🔧 Troubleshooting

### Common Issues

#### **Email Not Sending**

1. Check SMTP configuration:
```bash
# Test SMTP connection
node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransporter({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password'
  }
});
transporter.verify((error, success) => {
  if (error) console.log(error);
  else console.log('Server is ready to take our messages');
});
"
```

2. Check Gmail App Password setup
3. Verify firewall settings
4. Check email service logs

#### **Password Reset Not Working**

1. Check token expiration (1 hour)
2. Verify email template configuration
3. Check database indexes
4. Verify frontend URL configuration

#### **Performance Issues**

1. Check device capability detection:
```javascript
console.log('Performance Mode:', {
  hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: (navigator as any).deviceMemory,
  connection: (navigator as any).connection,
  prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
});
```

2. Monitor memory usage
3. Check animation performance
4. Verify particle count optimization

#### **Accessibility Issues**

1. Test with screen readers
2. Verify ARIA attributes
3. Check keyboard navigation
4. Test color contrast

### Debug Mode

Enable debug mode for troubleshooting:

```bash
# Backend debug
DEBUG=* npm run server

# Frontend debug
VITE_DEBUG=true npm run dev
```

## 📊 Analytics Setup

### 1. User Behavior Tracking

Set up analytics to track authentication metrics:

```javascript
// Track login attempts
const trackLoginAttempt = (success, email) => {
  analytics.track('login_attempt', {
    success,
    email: email ? 'provided' : 'not_provided',
    timestamp: new Date().toISOString()
  });
};
```

### 2. Performance Monitoring

Monitor authentication performance:

```javascript
// Track authentication performance
const trackAuthPerformance = (action, duration) => {
  analytics.track('auth_performance', {
    action,
    duration,
    timestamp: new Date().toISOString()
  });
};
```

## 🔮 Future Enhancements Setup

### 1. Multi-Factor Authentication

Prepare for 2FA implementation:

```javascript
// Add to user model
twoFactorSecret: { type: String, select: false },
twoFactorEnabled: { type: Boolean, default: false },
twoFactorBackupCodes: [{ type: String, select: false }]
```

### 2. Social Login

Prepare for OAuth integration:

```javascript
// Add OAuth fields to user model
oauthProvider: { type: String, enum: ['google', 'facebook', 'github'] },
oauthId: { type: String },
oauthEmail: { type: String }
```

### 3. Advanced Security

Prepare for advanced security features:

```javascript
// Add security fields to user model
lastPasswordChange: { type: Date },
passwordHistory: [{ type: String, select: false }],
securityQuestions: [{ question: String, answer: { type: String, select: false } }]
```

## 📞 Support

### Getting Help

1. **Check Documentation**: Review `AUTHENTICATION_FEATURES.md`
2. **Test Utilities**: Use `frontend/src/utils/testUtils.ts`
3. **Debug Mode**: Enable debug logging
4. **Community**: Check GitHub issues and discussions

### Common Commands

```bash
# Start development servers
cd backend && npm run server
cd frontend && npm run dev

# Run tests
cd backend && npm test
cd frontend && npm test

# Build for production
cd frontend && npm run build

# Check for security vulnerabilities
npm audit
npm audit fix

# Update dependencies
npm update
```

---

**Setup Complete!** 🎉

Your enhanced authentication system is now ready with:
- ✅ Secure password recovery
- ✅ Performance optimizations
- ✅ Accessibility compliance
- ✅ Modern UI/UX
- ✅ Comprehensive testing
- ✅ Production-ready security

**Next Steps:**
1. Test all features thoroughly
2. Set up monitoring and analytics
3. Deploy to production
4. Monitor performance and security
5. Plan future enhancements 