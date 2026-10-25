// Jest setupFiles — executed before any test module (and its imports).
// Values are placeholders for the regression suite only; they never appear
// in any committed .env or documentation.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-regression-only';
process.env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'test-client-id';
process.env.PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'test-client-secret';
process.env.PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || 'test-webhook-id';
process.env.PAYPAL_ENV = process.env.PAYPAL_ENV || 'sandbox';
process.env.APP_NAME = process.env.APP_NAME || 'NovaCart';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
process.env.ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:5177';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.local';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';
process.env.CLOUDINARY_NAME = process.env.CLOUDINARY_NAME || 'test-cloud';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test-key';
process.env.CLOUDINARY_SECRET_KEY = process.env.CLOUDINARY_SECRET_KEY || 'test-secret';
