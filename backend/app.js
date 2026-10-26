// Express application — extracted from server.js (Phase 1 work area 4/5) so the
// app can be imported by supertest without side effects (no listen, no DB
// connection, no socket initialization at import time).
//
// server.js owns orchestration: connectDB -> cloudinary -> socket -> listen ->
// signal handlers -> graceful shutdown.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import mongoose from 'mongoose';

import { handleMulterError } from './middleware/multer.js';
import socketService from './services/socketService.js';
import { redactText } from './utils/redact.js';
import { buildAllowedOrigins } from './config/allowedOrigins.js';

// Routers
import productRouter from './routes/productRoute.js';
import userRouter from './routes/userRoute.js';
import cartRouter from './routes/cartRoute.js';
import orderRouter from './routes/orderRoute.js';
import analyticsRouter from './routes/analyticsRoute.js';
import categoryRouter from './routes/categoryRoute.js';
import addressRouter from './routes/addressRoute.js';

const app = express();

// ---------------------------------------------------------------------------
// Drain flag — flipped by the shutdown manager. While shutting down, new
// non-health requests are rejected with 503 so load balancers can reroute.
// Health endpoints stay open so probes observe the final state.
// ---------------------------------------------------------------------------
let shuttingDown = false;
export const setShuttingDown = (value) => {
  shuttingDown = Boolean(value);
};
// Final gate Task 2 — the readiness endpoint reads this so it can report
// 503 for the entire drain window (see /health/ready below).
export const isShuttingDown = () => shuttingDown;

app.use((req, res, next) => {
  if (shuttingDown && !req.path.startsWith('/health')) {
    return res.status(503).json({ success: false, message: 'Server is shutting down' });
  }
  next();
});

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })
);

// Rate limiting
//
// RATE_LIMIT_MAX exists so a DISPOSABLE load-test target can raise the ceiling
// without changing the production default. Leave it unset in real deployments:
// 1000 requests / 15 min / IP is the shipped policy.
const RATE_LIMIT_MAX =
  Number.isFinite(Number(process.env.RATE_LIMIT_MAX)) && Number(process.env.RATE_LIMIT_MAX) > 0
    ? Number(process.env.RATE_LIMIT_MAX)
    : 1000;

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: RATE_LIMIT_MAX,
    message: { success: false, message: 'Too many requests from this IP, try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Health probes must never be throttled — they would otherwise burn the
    // per-IP budget and get the instance killed by a load balancer.
    skip: (req) => req.path.startsWith('/health'),
  })
);

const AUTH_RATE_LIMIT_MAX =
  Number.isFinite(Number(process.env.AUTH_RATE_LIMIT_MAX)) &&
  Number(process.env.AUTH_RATE_LIMIT_MAX) > 0
    ? Number(process.env.AUTH_RATE_LIMIT_MAX)
    : 20;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_RATE_LIMIT_MAX,
  message: { success: false, message: 'Too many login attempts, try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Compression
app.use(compression());

// ✅ CORS Configuration — Phase 4 audit: the historical SKR Netlify origins
// were removed from the hardcoded list (nothing in the current frontend/admin
// references them). Production origins are environment-configured
// (FRONTEND_URL / ADMIN_URL / CORS_EXTRA_ORIGINS) and local development
// origins are preserved. The list is shared with the Socket.IO policy via
// config/allowedOrigins.js so the two can never drift apart again.
const allowedOrigins = buildAllowedOrigins(process.env);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error('❌ CORS blocked request from:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

// ---------------------------------------------------------------------------
// Body parsing + sanitization.
// `verify` keeps the exact raw bytes for the PayPal webhook route — the
// webhook signature is computed by PayPal over the bytes as sent, so the
// parsed JSON alone is not sufficient. Storing the buffer is behavior-neutral
// for every other route.
// ---------------------------------------------------------------------------
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      if (req.originalUrl === '/api/orders/paypal/webhook') {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(mongoSanitize());

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.use('/api/user', authLimiter, userRouter);
app.use('/api/product', productRouter);
app.use('/api/cart', cartRouter);
app.use('/api/address', addressRouter);
app.use('/api/orders', orderRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/category', categoryRouter);

// ---------------------------------------------------------------------------
// Health endpoints (Phase 1 work area 5) — never expose secrets.
// /health/live  : process liveness only, no dependency checks.
// /health/ready : readiness incl. required database availability.
// /health       : legacy endpoint preserved for backward compatibility.
// ---------------------------------------------------------------------------
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'live', uptime: process.uptime() });
});

app.get('/health/ready', (req, res) => {
  // Final gate Task 2 — draining for shutdown ALWAYS reports not-ready, even
  // while MongoDB is still connected, so load balancers stop routing traffic
  // for the whole graceful-shutdown window.
  if (isShuttingDown()) {
    return res.status(503).json({
      status: 'not ready',
      checks: { database: mongoose.connection.readyState === 1, shuttingDown: true },
    });
  }
  const databaseReady = mongoose.connection.readyState === 1; // 1 === connected
  const payload = {
    status: databaseReady ? 'ready' : 'not ready',
    checks: { database: databaseReady },
  };
  res.status(databaseReady ? 200 : 503).json(payload);
});

// Health check (legacy)
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Server is healthy ✅' });
});

// WebSocket info
app.get('/api/socket/status', (req, res) => {
  res.json({
    success: true,
    connectedUsers: socketService.getConnectedUsersCount(),
    status: 'WebSocket server is running',
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({ success: true, message: 'API Working 🚀' });
});

// Handle Multer errors
app.use(handleMulterError);

// Global error handler — exported so tests can exercise it directly.
// Express identifies error middleware by its 4-argument arity — the `next`
// parameter must stay in the signature even though this handler never calls it.
export const globalErrorHandler = (err, req, res, _next) => {
  // Final gate Task 5 — stacks are redacted (connection strings / bearer
  // tokens never reach the logs).
  console.error('🔥 Global Error:', redactText(err));

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid ID format' });
  }

  if (err.code === 11000) {
    return res.status(400).json({ success: false, message: 'Duplicate field value' });
  }

  // Honor explicit 4xx statuses set by body-parser / multer / cors (e.g.
  // entity.parse.failed for malformed JSON). Without this, a malformed JSON
  // body surfaced as a 500 “Server error” instead of a clean 400.
  const explicitStatus = Number(err.status || err.statusCode);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 500) {
    return res.status(explicitStatus).json({
      success: false,
      message: err.type === 'entity.parse.failed' ? 'Malformed JSON body' : (err.message || 'Bad Request'),
    });
  }

  res.status(500).json({
    success: false,
    // Production: generic message. Non-production: redacted message —
    // connection strings/tokens never leak even in developer responses.
    message:
      process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : redactText(err.message || String(err)),
  });
};

app.use(globalErrorHandler);

// 404 Fallback
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

export default app;
