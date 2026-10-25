# 🚀 Production Deployment Checklist

> ## ⚠️ Read first — accuracy notice (2026-10-24)
>
> This file is a **generic template**, not an as-built procedure. Only the
> **Environment Configuration** section below reflects the actual system
> (verified against code). The remaining sections reference features that
> **do not exist in this repository** — Stripe, Google/Facebook OAuth,
> Redis, AWS S3, Sentry, Google Analytics, PM2 — and should be treated as
> generic food-for-thought, not requirements.
>
> **Authoritative deployment documentation:**
>
> - [`docs/06-DEPLOYMENT.md`](docs/06-DEPLOYMENT.md) — current deployment model, the real 26 environment variables, PayPal setup, pre-production gates
> - [`docs/09-OPERATIONS.md`](docs/09-OPERATIONS.md) — health probing, shutdown behavior, incident playbook
> - [`docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md`](docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md) / [`docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`](docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md) — owner go-live gates
> - Facts always beat templates: this checklist's non-env content conflicts with the codebase in places (e.g. "run `npm run test`" — use `npm run test:security`; see `docs/07-TESTING_PLAN.md` §3). Where this file and `docs/` disagree, **`docs/` wins**.

## 📋 Pre-Deployment Checklist

### ✅ Environment Configuration
- [ ] **Environment Variables**
  - [ ] Copy `backend/env.example` to `backend/.env`
  - [ ] Copy `frontend/env.example` to `frontend/.env`
  - [ ] Set `NODE_ENV=production`
  - [ ] Set `PAYPAL_ENV=live` (the single switch shared by the capture flow AND the webhook verifier — see `backend/config/paypalEnv.js`; leaving it unset keeps ALL PayPal traffic on sandbox and logs a startup warning)
  - [ ] Set real `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (live credentials — the server refuses to boot with placeholders while `PAYPAL_ENV=live`)
  - [ ] Set the live `PAYPAL_WEBHOOK_ID` from the SAME environment as `PAYPAL_ENV`
  - [ ] Configure production database URI
  - [ ] Set secure JWT secrets (64+ characters)
  - [ ] Configure email service (SendGrid recommended)
  - [ ] Set production frontend URL
  - [ ] Configure CORS origins for production
  - [ ] Rotation required before launch? Follow `docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md`

- [ ] **Database Setup**
  - [ ] Set up production MongoDB cluster
  - [ ] Create database indexes
  - [ ] Set up database backups
  - [ ] Configure database monitoring
  - [ ] Test database connection

- [ ] **Email Service**
  - [ ] Set up SendGrid account
  - [ ] Configure SMTP settings
  - [ ] Test email delivery
  - [ ] Set up email templates
  - [ ] Configure email monitoring

### ✅ Security Configuration
- [ ] **SSL/TLS Certificate**
  - [ ] Obtain SSL certificate (Let's Encrypt or paid)
  - [ ] Configure HTTPS redirect
  - [ ] Set up HSTS headers
  - [ ] Test SSL configuration

- [ ] **Security Headers**
  - [ ] Configure CSP (Content Security Policy)
  - [ ] Set up X-Frame-Options
  - [ ] Configure X-Content-Type-Options
  - [ ] Set up Referrer-Policy
  - [ ] Configure Permissions-Policy

- [ ] **Rate Limiting**
  - [ ] Configure API rate limits
  - [ ] Set up login attempt limits
  - [ ] Configure IP blocking
  - [ ] Test rate limiting

- [ ] **Authentication**
  - [ ] Enable 2FA (if implemented)
  - [ ] Configure password policies
  - [ ] Set up session management
  - [ ] Test authentication flows

### ✅ Payment Configuration
- [ ] **PayPal Production**
  - [ ] Switch from sandbox to production
  - [ ] Configure production client ID/secret
  - [ ] Set up webhook endpoints
  - [ ] Test payment processing
  - [ ] Configure payment monitoring

- [ ] **Stripe Production** (if using)
  - [ ] Switch from test to live keys
  - [ ] Configure webhook endpoints
  - [ ] Test payment processing
  - [ ] Set up payment monitoring

### ✅ Social Login Configuration
- [ ] **Google OAuth**
  - [ ] Create production OAuth app
  - [ ] Configure authorized domains
  - [ ] Set production callback URLs
  - [ ] Test Google login

- [ ] **Facebook OAuth**
  - [ ] Create production Facebook app
  - [ ] Configure app domains
  - [ ] Set production callback URLs
  - [ ] Test Facebook login

### ✅ Analytics & Monitoring
- [ ] **Google Analytics**
  - [ ] Set up production GA4 property
  - [ ] Configure tracking code
  - [ ] Set up conversion tracking
  - [ ] Test analytics tracking

- [ ] **Error Monitoring**
  - [ ] Set up Sentry for error tracking
  - [ ] Configure error alerts
  - [ ] Test error reporting
  - [ ] Set up performance monitoring

- [ ] **Application Monitoring**
  - [ ] Set up uptime monitoring
  - [ ] Configure performance monitoring
  - [ ] Set up log aggregation
  - [ ] Configure alerting

## 🏗️ Infrastructure Setup

### ✅ Server Configuration
- [ ] **VPS/Cloud Provider**
  - [ ] Choose hosting provider (AWS, DigitalOcean, etc.)
  - [ ] Set up production server
  - [ ] Configure firewall rules
  - [ ] Set up SSH access
  - [ ] Configure server monitoring

- [ ] **Domain & DNS**
  - [ ] Register domain name
  - [ ] Configure DNS records
  - [ ] Set up subdomains (api, admin)
  - [ ] Configure CDN (Cloudflare recommended)
  - [ ] Test DNS propagation

- [ ] **Load Balancer** (if needed)
  - [ ] Set up load balancer
  - [ ] Configure health checks
  - [ ] Set up SSL termination
  - [ ] Test load balancing

### ✅ Database Infrastructure
- [ ] **MongoDB Atlas** (recommended)
  - [ ] Create production cluster
  - [ ] Configure network access
  - [ ] Set up database users
  - [ ] Configure backups
  - [ ] Set up monitoring

- [ ] **Redis** (if using)
  - [ ] Set up Redis instance
  - [ ] Configure persistence
  - [ ] Set up monitoring
  - [ ] Test Redis connection

### ✅ File Storage
- [ ] **AWS S3** (recommended)
  - [ ] Create S3 bucket
  - [ ] Configure CORS
  - [ ] Set up IAM permissions
  - [ ] Configure bucket policies
  - [ ] Test file uploads

- [ ] **CDN Configuration**
  - [ ] Set up CDN for static assets
  - [ ] Configure cache policies
  - [ ] Set up image optimization
  - [ ] Test CDN delivery

## 🚀 Application Deployment

### ✅ Backend Deployment
- [ ] **Code Preparation**
  - [ ] Run all tests: `npm run test`
  - [ ] Fix any linting issues
  - [ ] Update dependencies
  - [ ] Create production build
  - [ ] Test production build locally

- [ ] **Deployment Process**
  - [ ] Set up CI/CD pipeline
  - [ ] Configure deployment scripts
  - [ ] Set up environment variables
  - [ ] Deploy to staging first
  - [ ] Test staging environment
  - [ ] Deploy to production

- [ ] **Process Management**
  - [ ] Set up PM2 or similar
  - [ ] Configure process monitoring
  - [ ] Set up auto-restart
  - [ ] Configure log rotation
  - [ ] Test process management

### ✅ Frontend Deployment
- [ ] **Build Process**
  - [ ] Run production build: `npm run build`
  - [ ] Optimize assets
  - [ ] Test production build
  - [ ] Configure build optimization

- [ ] **Deployment**
  - [ ] Deploy to CDN/hosting
  - [ ] Configure caching
  - [ ] Set up redirects
  - [ ] Test frontend deployment

### ✅ Admin Panel Deployment
- [ ] **Admin Setup**
  - [ ] Deploy admin panel
  - [ ] Configure admin access
  - [ ] Set up admin monitoring
  - [ ] Test admin functionality

## 🔧 Post-Deployment Configuration

### ✅ Application Testing
- [ ] **Functional Testing**
  - [ ] Test user registration/login
  - [ ] Test product browsing
  - [ ] Test cart functionality
  - [ ] Test checkout process
  - [ ] Test payment processing
  - [ ] Test order management
  - [ ] Test admin functions

- [ ] **Performance Testing**
  - [ ] Test page load times
  - [ ] Test API response times
  - [ ] Test database queries
  - [ ] Test concurrent users
  - [ ] Optimize performance issues

- [ ] **Security Testing**
  - [ ] Run security scans
  - [ ] Test authentication
  - [ ] Test authorization
  - [ ] Test input validation
  - [ ] Test SQL injection protection
  - [ ] Test XSS protection

### ✅ Monitoring Setup
- [ ] **Application Monitoring**
  - [ ] Set up application logs
  - [ ] Configure error tracking
  - [ ] Set up performance monitoring
  - [ ] Configure uptime monitoring
  - [ ] Set up alerting

- [ ] **Database Monitoring**
  - [ ] Monitor database performance
  - [ ] Set up query monitoring
  - [ ] Configure backup monitoring
  - [ ] Set up disk space monitoring

- [ ] **Server Monitoring**
  - [ ] Monitor CPU usage
  - [ ] Monitor memory usage
  - [ ] Monitor disk usage
  - [ ] Monitor network usage
  - [ ] Set up server alerts

### ✅ Backup & Recovery
- [ ] **Database Backups**
  - [ ] Set up automated backups
  - [ ] Test backup restoration
  - [ ] Configure backup monitoring
  - [ ] Set up backup alerts

- [ ] **File Backups**
  - [ ] Set up file backups
  - [ ] Test file restoration
  - [ ] Configure backup monitoring

- [ ] **Disaster Recovery**
  - [ ] Create disaster recovery plan
  - [ ] Test recovery procedures
  - [ ] Document recovery steps
  - [ ] Train team on recovery

## 📊 Analytics & SEO

### ✅ Analytics Setup
- [ ] **Google Analytics**
  - [ ] Verify tracking code
  - [ ] Set up goals/conversions
  - [ ] Configure e-commerce tracking
  - [ ] Test analytics data

- [ ] **Search Console**
  - [ ] Add site to Google Search Console
  - [ ] Submit sitemap
  - [ ] Monitor search performance
  - [ ] Fix any issues

### ✅ SEO Configuration
- [ ] **Meta Tags**
  - [ ] Set up title tags
  - [ ] Configure meta descriptions
  - [ ] Set up Open Graph tags
  - [ ] Configure Twitter Cards

- [ ] **Sitemap**
  - [ ] Generate XML sitemap
  - [ ] Submit to search engines
  - [ ] Set up sitemap monitoring

- [ ] **Robots.txt**
  - [ ] Configure robots.txt
  - [ ] Test robots.txt
  - [ ] Monitor crawl errors

## 🔒 Security Hardening

### ✅ Security Measures
- [ ] **Firewall Configuration**
  - [ ] Configure server firewall
  - [ ] Set up WAF (Web Application Firewall)
  - [ ] Configure DDoS protection
  - [ ] Test firewall rules

- [ ] **Access Control**
  - [ ] Set up SSH key authentication
  - [ ] Disable password authentication
  - [ ] Configure sudo access
  - [ ] Set up user management

- [ ] **Application Security**
  - [ ] Enable security headers
  - [ ] Configure CORS properly
  - [ ] Set up input validation
  - [ ] Configure rate limiting
  - [ ] Test security measures

### ✅ Compliance
- [ ] **GDPR Compliance**
  - [ ] Set up privacy policy
  - [ ] Configure cookie consent
  - [ ] Set up data deletion
  - [ ] Configure data export

- [ ] **PCI Compliance** (if handling payments)
  - [ ] Use PCI-compliant payment processor
  - [ ] Don't store credit card data
  - [ ] Configure secure payment flow
  - [ ] Test payment security

## 📱 Mobile & PWA

### ✅ PWA Configuration
- [ ] **Service Worker**
  - [ ] Configure service worker
  - [ ] Set up offline functionality
  - [ ] Test PWA features
  - [ ] Configure app manifest

- [ ] **Mobile Optimization**
  - [ ] Test mobile responsiveness
  - [ ] Optimize mobile performance
  - [ ] Test touch interactions
  - [ ] Configure mobile-specific features

## 📈 Performance Optimization

### ✅ Performance Measures
- [ ] **Frontend Optimization**
  - [ ] Optimize images
  - [ ] Minify CSS/JS
  - [ ] Enable compression
  - [ ] Configure caching
  - [ ] Test Core Web Vitals

- [ ] **Backend Optimization**
  - [ ] Optimize database queries
  - [ ] Configure caching
  - [ ] Optimize API responses
  - [ ] Set up CDN
  - [ ] Monitor performance

## 🚨 Final Checks

### ✅ Pre-Launch Checklist
- [ ] **Final Testing**
  - [ ] Complete end-to-end testing
  - [ ] Test all user flows
  - [ ] Test payment processing
  - [ ] Test admin functions
  - [ ] Test mobile experience

- [ ] **Documentation**
  - [ ] Update deployment docs
  - [ ] Document configuration
  - [ ] Create runbooks
  - [ ] Document monitoring
  - [ ] Create troubleshooting guide

- [ ] **Team Preparation**
  - [ ] Train support team
  - [ ] Set up support channels
  - [ ] Create escalation procedures
  - [ ] Prepare launch announcement

### ✅ Launch Day
- [ ] **Launch Sequence**
  - [ ] Final backup before launch
  - [ ] Deploy to production
  - [ ] Verify all systems
  - [ ] Monitor closely for 24 hours
  - [ ] Be ready to rollback if needed

- [ ] **Post-Launch**
  - [ ] Monitor performance
  - [ ] Watch for errors
  - [ ] Monitor user feedback
  - [ ] Be ready to fix issues
  - [ ] Celebrate successful launch! 🎉

## 📞 Emergency Contacts

- **Hosting Provider Support**: [Contact Info]
- **Domain Registrar**: [Contact Info]
- **SSL Certificate Provider**: [Contact Info]
- **Payment Processor Support**: [Contact Info]
- **Database Provider Support**: [Contact Info]

## 🔄 Maintenance Schedule

- **Daily**: Monitor logs, check backups, review alerts
- **Weekly**: Review performance metrics, update dependencies
- **Monthly**: Security updates, performance optimization
- **Quarterly**: Full security audit, backup testing

---

**Remember**: This checklist should be customized based on your specific deployment requirements and infrastructure choices. Always test thoroughly in a staging environment before deploying to production. 