import express from 'express';
import {
  trackUserActivity,
  getSalesAnalytics,
  getProductPerformance,
  getUserBehavior,
  getSearchAnalytics,
  getDashboardSummary,
  cleanupAnalytics
} from '../controllers/analyticsController.js';
import { authUser as protect, authAdmin as admin } from '../middleware/auth.js';

const router = express.Router();

// Track user activity (for frontend tracking) — shopper endpoints. Admin
// tokens are rejected here (Phase 3 fix: authUser no longer accepts
// type:'admin' tokens); activity tracking belongs to logged-in shoppers.
router.post('/track-activity', protect, trackUserActivity);

// Admin-only analytics reads. Phase 3 fix: these routes previously chained
// `protect, admin`, which REQUIRED authUser to accept admin tokens — the exact
// cross-role hole the Phase 3 audit closes. authAdmin alone enforces the same
// authorization (401 unauthenticated, 403 authenticated non-admin) without
// routing admin tokens through shopper middleware.
router.get('/dashboard-summary', admin, getDashboardSummary);
router.get('/sales', admin, getSalesAnalytics);
router.get('/products', admin, getProductPerformance);
router.get('/user-behavior', admin, getUserBehavior);
router.get('/search', admin, getSearchAnalytics);
router.post('/cleanup', admin, cleanupAnalytics);

export default router;
